import { Router } from 'express';
import { pool, one, withTransaction, isUniqueViolation } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../utils/validation.js';
import { HttpError, badRequest, conflict, forbidden, notFound, parseId } from '../utils/http.js';
import { toTrade } from '../utils/serializers.js';
import { verifyEscrowClosed, verifyEscrowFunded } from '../utils/escrow.js';
import { config } from '../config.js';

const router = Router();
router.use(requireAuth);

const TRADE_STATUSES = ['pending', 'funded', 'paid', 'released', 'refunded', 'cancelled', 'disputed'];
// Estados con USDC bloqueado en el contrato: se pueden cerrar on-chain (release/refund).
const ESCROWED = ['funded', 'paid', 'disputed'];

const TRADE_SELECT = `
  SELECT t.*, round(t.usdc_amount * t.fiat_price, 2) AS fiat_amount,
    o.payment_method, o.bank,
    b.display_name AS buyer_name,  b.stellar_address AS buyer_address,
    s.display_name AS seller_name, s.stellar_address AS seller_address
  FROM trades t
  JOIN offers o ON o.id = t.offer_id
  JOIN users b ON b.id = t.buyer_id
  JOIN users s ON s.id = t.seller_id`;

const findTrade = (id, db = pool) => one(`${TRADE_SELECT} WHERE t.id = $1`, [id], db);

/** Carga un trade en el que participe el usuario, o 404 (no revela trades ajenos). */
async function findOwnTrade(id, userId) {
  const trade = await findTrade(id);
  if (!trade || (trade.buyer_id !== userId && trade.seller_id !== userId)) throw notFound('Operación no encontrada');
  return trade;
}

/** GET /api/trades — mis operaciones (como comprador o vendedor). ?status= opcional. */
router.get('/', async (req, res) => {
  const q = validate(req.query).oneOf('status', TRADE_STATUSES, { optional: true }).done();
  const { rows } = await pool.query(
    `${TRADE_SELECT}
      WHERE (t.buyer_id = $1 OR t.seller_id = $1) AND ($2::text IS NULL OR t.status = $2)
      ORDER BY t.created_at DESC, t.id DESC`,
    [req.user.id, q.status ?? null]
  );
  res.json({ trades: rows.map(toTrade) });
});

router.get('/:id', async (req, res) => {
  res.json({ trade: toTrade(await findOwnTrade(parseId(req.params.id), req.user.id)) });
});

/**
 * POST /api/trades — toma una oferta. Bloquea la oferta (SELECT … FOR UPDATE),
 * descuenta `usdcAmount` del disponible en SQL y congela precio/moneda en el trade.
 */
router.post('/', async (req, res) => {
  const { offerId, usdcAmount } = validate(req.body)
    .number('offerId', { min: 1, integer: true })
    .number('usdcAmount', { exclusiveMin: 0, max: 1e10, decimals: 7 })
    .done();

  const tradeId = await withTransaction(async (client) => {
    const offer = await one(
      `SELECT o.*, u.stellar_address AS owner_address FROM offers o JOIN users u ON u.id = o.user_id
        WHERE o.id = $1 FOR UPDATE OF o`,
      [offerId],
      client
    );
    if (!offer) throw notFound('Oferta no encontrada');
    if (offer.status !== 'active') throw conflict('La oferta no está activa');
    if (offer.user_id === req.user.id) throw badRequest('No puedes operar con tu propia oferta');

    // 'sell': el creador vende USDC → el creador es vendedor y quien toma, comprador.
    const takerBuys = offer.type === 'sell';
    const sellerId = takerBuys ? offer.user_id : req.user.id;
    const buyerId = takerBuys ? req.user.id : offer.user_id;
    const buyerAddress = takerBuys ? req.user.stellar_address : offer.owner_address;
    if (!buyerAddress) {
      throw badRequest(
        takerBuys
          ? 'Vincula tu dirección Stellar en tu perfil para recibir USDC'
          : 'El comprador aún no vinculó una dirección Stellar'
      );
    }

    const fiat = usdcAmount * Number(offer.fiat_price);
    if (offer.min_fiat !== null && fiat < Number(offer.min_fiat)) {
      throw badRequest('Datos inválidos', {
        usdcAmount: `El monto fiat mínimo es ${offer.min_fiat} ${offer.fiat_currency}`,
      });
    }
    if (offer.max_fiat !== null && fiat > Number(offer.max_fiat)) {
      throw badRequest('Datos inválidos', {
        usdcAmount: `El monto fiat máximo es ${offer.max_fiat} ${offer.fiat_currency}`,
      });
    }

    // Comparación y resta en NUMERIC (sin errores de coma flotante).
    const updated = await one(
      'UPDATE offers SET usdc_amount = usdc_amount - $1 WHERE id = $2 AND usdc_amount >= $1 RETURNING id',
      [usdcAmount, offer.id],
      client
    );
    if (!updated) {
      throw badRequest('Datos inválidos', { usdcAmount: `Máximo disponible: ${Number(offer.usdc_amount)} USDC` });
    }

    const { id } = await one(
      `INSERT INTO trades (offer_id, buyer_id, seller_id, usdc_amount, fiat_price, fiat_currency)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [offer.id, buyerId, sellerId, usdcAmount, offer.fiat_price, offer.fiat_currency],
      client
    );
    return id;
  });

  res.status(201).json({ trade: toTrade(await findTrade(tradeId)) });
});

/**
 * Transición de estado validada: estados `from` permitidos, rol requerido y columnas extra.
 * UPDATE condicional sobre el estado actual para evitar carreras.
 * `set`: columnas extra a fijar (nombres fijos del código, valores parametrizados).
 */
async function transition(req, res, { trade, from, to, role, set = {}, onApplied }) {
  const id = trade.id;
  if (role === 'buyer' && trade.buyer_id !== req.user.id) throw forbidden('Solo el comprador puede hacer esto');
  if (role === 'seller' && trade.seller_id !== req.user.id) throw forbidden('Solo el vendedor puede hacer esto');
  if (!from.includes(trade.status)) throw conflict(`No permitido en estado "${trade.status}"`);

  const cols = Object.keys(set);
  const assignments = cols.map((c, i) => `, ${c} = $${i + 4}`).join('');
  try {
    await withTransaction(async (client) => {
      const { rowCount } = await client.query(
        `UPDATE trades SET status = $1${assignments} WHERE id = $2 AND status = ANY($3::text[])`,
        [to, id, from, ...cols.map((c) => set[c])]
      );
      if (rowCount !== 1) throw conflict('La operación cambió de estado; recarga e intenta de nuevo');
      await onApplied?.(client, trade);
    });
  } catch (err) {
    if (isUniqueViolation(err, 'trades_stellar_tx_hash_key') || isUniqueViolation(err, 'trades_escrow_tx_hash_key')) {
      throw conflict('Ese hash ya fue registrado en otra operación');
    }
    throw err;
  }

  res.json({ trade: toTrade(await findTrade(id)) });
}

const loadTrade = (req) => findOwnTrade(parseId(req.params.id), req.user.id);
const restoreOffer = (client, t) =>
  client.query('UPDATE offers SET usdc_amount = usdc_amount + $1 WHERE id = $2', [t.usdc_amount, t.offer_id]);

/**
 * POST /:id/fund — el vendedor informa el hash de la tx `create` del contrato de escrow
 * (deposita los USDC del trade). Se verifica on-chain salvo VERIFY_STELLAR_TX=false.
 */
router.post('/:id/fund', async (req, res) => {
  const { txHash } = validate(req.body).txHash('txHash').done();
  const trade = await loadTrade(req);
  if (trade.seller_id !== req.user.id) throw forbidden('Solo el vendedor puede hacer esto');
  if (trade.status === 'cancelled' && trade.cancel_reason === 'expired') {
    throw conflict('La operación caducó sin depósito; si ya depositaste on-chain, reembolsa el escrow');
  }
  if (trade.status !== 'pending') throw conflict(`No permitido en estado "${trade.status}"`);
  if (!trade.seller_address) throw badRequest('Vincula tu dirección Stellar en tu perfil antes de depositar');
  if (!trade.buyer_address) throw badRequest('El comprador no tiene dirección Stellar vinculada');

  const contractId = config.stellar.escrowContractId;
  let refundAfterLedger = null;
  if (config.stellar.verifyTx) {
    if (!contractId)
      throw new HttpError(503, 'El escrow on-chain no está configurado en el servidor (ESCROW_CONTRACT_ID)');
    ({ refundAfterLedger } = await verifyEscrowFunded({
      txHash,
      contractId,
      tokenId: config.stellar.escrowTokenId,
      seller: trade.seller_address,
      buyer: trade.buyer_address,
      tradeId: trade.id,
      amount: trade.usdc_amount,
      notBefore: trade.created_at,
    }));
  }

  await transition(req, res, {
    trade,
    from: ['pending'],
    to: 'funded',
    role: 'seller',
    set: {
      escrow_contract_id: contractId,
      escrow_tx_hash: txHash,
      escrow_seller: trade.seller_address,
      escrow_buyer: trade.buyer_address,
      escrow_refund_after_ledger: refundAfterLedger,
      funded_at: new Date(),
    },
  });
});

/** El comprador declara que envió el pago fiat (solo con el USDC ya bloqueado en escrow). */
router.post('/:id/paid', async (req, res) =>
  transition(req, res, { trade: await loadTrade(req), from: ['funded'], to: 'paid', role: 'buyer' })
);

const disputeRefundTooEarly = () =>
  conflict(
    'Operación en disputa: el vendedor solo puede reembolsarse cuando vence el plazo del contrato (~24 h desde el depósito); el comprador sí puede reembolsar antes'
  );

/** Cierre on-chain verificado: `release` (USDC → comprador) o `refund` (USDC → vendedor). */
async function closeEscrow(req, res, { fn, to, role, onApplied }) {
  const { txHash } = validate(req.body).txHash('txHash').done();
  const trade = await loadTrade(req);
  if (role === 'seller' && trade.seller_id !== req.user.id) throw forbidden('Solo el vendedor puede hacer esto');
  if (!ESCROWED.includes(trade.status)) throw conflict(`No permitido en estado "${trade.status}"`);

  // Auditoría I1: en disputa, el reembolso del VENDEDOR sigue la regla del contrato (solo tras
  // refund_after_ledger); el del comprador se permite siempre.
  const disputedRefund = fn === 'refund' && trade.status === 'disputed';
  if (config.stellar.verifyTx) {
    if (!trade.escrow_contract_id) throw conflict('Esta operación no tiene escrow on-chain registrado');
    const { args, ledger } = await verifyEscrowClosed({
      txHash,
      fn,
      contractId: trade.escrow_contract_id,
      seller: trade.escrow_seller,
      tradeId: trade.id,
      notBefore: trade.created_at,
    });
    // On-chain manda quién llamó a `refund` y en qué ledger (el contrato ya lo impide; defensa extra).
    const deadline = trade.escrow_refund_after_ledger;
    if (disputedRefund && args[0] === trade.escrow_seller && deadline !== null && ledger < deadline) {
      throw disputeRefundTooEarly();
    }
  } else if (disputedRefund && trade.seller_id === req.user.id) {
    // Sin verificación on-chain (solo desarrollo/pruebas): se replica el plazo con el reloj.
    const since = new Date(trade.funded_at ?? trade.updated_at).getTime();
    if (Date.now() < since + config.trades.sellerRefundAfterMs) throw disputeRefundTooEarly();
  }
  await transition(req, res, { trade, from: ESCROWED, to, role, set: { stellar_tx_hash: txHash }, onApplied });
}

/**
 * El vendedor informa el hash de la tx `release` (el contrato envió el USDC al comprador).
 * Se acepta desde funded/paid/disputed: el estado on-chain manda.
 */
router.post('/:id/release', (req, res) => closeEscrow(req, res, { fn: 'release', to: 'released', role: 'seller' }));

/**
 * Cualquiera de las partes informa el hash de la tx `refund` (el contrato devolvió el USDC
 * al vendedor: el comprador desistió, o el vendedor reclamó tras el plazo). El USDC vuelve a la oferta.
 */
router.post('/:id/refund', (req, res) =>
  closeEscrow(req, res, { fn: 'refund', to: 'refunded', onApplied: restoreOffer })
);

/**
 * Cancelar sin escrow: cualquiera de las partes en 'pending'. Los trades con USDC en el
 * contrato se cierran con /refund (on-chain). `paid` sin escrow (trades previos al escrow) → solo el comprador.
 */
router.post('/:id/cancel', async (req, res) => {
  const trade = await loadTrade(req);
  if (trade.escrow_tx_hash && ESCROWED.includes(trade.status)) {
    throw conflict('Los USDC están en el escrow on-chain: usa el reembolso para cancelar');
  }
  const from = trade.buyer_id === req.user.id ? ['pending', 'paid'] : ['pending'];
  await transition(req, res, { trade, from, to: 'cancelled', onApplied: restoreOffer });
});

/** Abrir disputa tras el pago (resolución manual; fuera de alcance por ahora). */
router.post('/:id/dispute', async (req, res) =>
  transition(req, res, { trade: await loadTrade(req), from: ['paid'], to: 'disputed' })
);

export default router;
