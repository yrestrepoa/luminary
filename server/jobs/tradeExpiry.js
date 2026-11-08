// Expiración de trades `pending` (auditoría L1): un trade tomado pero nunca fondeado reserva
// liquidez de la oferta; pasado PENDING_TRADE_TTL_MINUTES se cancela solo (cancel_reason =
// 'expired') y su USDC vuelve a la oferta.
//
// Corre como un intervalo ligero dentro de CADA proceso de la API. Con varias réplicas:
//  - pg_try_advisory_xact_lock: solo una réplica barre a la vez (las demás se saltan la ronda);
//  - aunque dos barrieran a la vez (o un usuario cancelara/fondeara en paralelo), el UPDATE es
//    condicional (`status = 'pending'`) y la restitución de la oferta se calcula SOLO con las
//    filas que ESE UPDATE cambió (RETURNING), en la misma sentencia: nunca se devuelve dos veces.
//
// Con verificación on-chain activa, antes de expirar se comprueba que el escrow NO exista en el
// contrato: si el vendedor ya depositó pero aún no registró el hash, el trade no se toca (si no,
// sus USDC quedarían en el contrato hasta el plazo de reembolso). Si el RPC falla, se reintenta
// en la siguiente ronda (nunca se expira sin poder comprobarlo).
import { config } from '../config.js';
import { logger as defaultLogger } from '../logger.js';
import { pool as defaultPool } from '../db/pool.js';
import { escrowContractIdFor, readEscrow } from '../utils/escrow.js';

export const EXPIRY_LOCK_KEY = 72_340_173; // distinto del de migraciones (72_340_172)
const BATCH = 200;

const EXPIRE_SQL = `
  WITH expired AS (
    UPDATE trades
       SET status = 'cancelled', cancel_reason = 'expired'
     WHERE id = ANY($1::bigint[])
       AND status = 'pending'
       AND created_at < now() - make_interval(secs => $2::double precision / 1000)
    RETURNING id, offer_id, usdc_amount
  ), restored AS (
    UPDATE offers o
       SET usdc_amount = o.usdc_amount + e.total
      FROM (SELECT offer_id, sum(usdc_amount) AS total FROM expired GROUP BY offer_id) e
     WHERE o.id = e.offer_id
    RETURNING o.id
  )
  SELECT (SELECT array_agg(id ORDER BY id) FROM expired) AS ids,
         (SELECT count(*) FROM restored) AS offers`;

/**
 * Una ronda de expiración. Devuelve los ids expirados (vacío si no había o si otra réplica
 * tenía el lock).
 * @param {object} [opts]
 * @param {import('pg').Pool} [opts.pool]
 * @param {number} [opts.ttlMs]
 * @param {(trade: {id: number, seller_address: string|null, escrow_contract_id: string|null}) => Promise<boolean>} [opts.fundedOnChain]
 *        true si el escrow existe on-chain (no expirar). Por defecto: Soroban RPC si VERIFY_STELLAR_TX.
 * @param {boolean} [opts.useLock] false solo en tests (para ejercitar la guarda SQL sin el lock).
 */
export async function expirePendingTrades({
  pool = defaultPool,
  ttlMs = config.trades.pendingTtlMs,
  fundedOnChain = defaultFundedOnChain,
  useLock = true,
  logger = defaultLogger,
} = {}) {
  if (!ttlMs) return [];
  const { rows: candidates } = await pool.query(
    `SELECT t.id, t.escrow_contract_id, u.stellar_address AS seller_address
       FROM trades t JOIN users u ON u.id = t.seller_id
      WHERE t.status = 'pending' AND t.created_at < now() - make_interval(secs => $1::double precision / 1000)
      ORDER BY t.created_at
      LIMIT ${BATCH}`,
    [ttlMs]
  );
  if (!candidates.length) return [];

  const ids = [];
  for (const t of candidates) {
    try {
      if (await fundedOnChain(t)) {
        logger.warn({ tradeId: t.id }, '[trades] pending trade has an on-chain escrow; not expiring');
        continue;
      }
      ids.push(t.id);
    } catch (err) {
      logger.warn({ err, tradeId: t.id }, '[trades] cannot check escrow on-chain; expiry postponed');
    }
  }
  if (!ids.length) return [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (useLock) {
      const { rows } = await client.query('SELECT pg_try_advisory_xact_lock($1) AS ok', [EXPIRY_LOCK_KEY]);
      if (!rows[0].ok) {
        await client.query('ROLLBACK');
        return [];
      }
    }
    // Bloquea las filas en orden de id: dos barridos (o un barrido y un cancel) nunca se interbloquean.
    await client.query('SELECT id FROM trades WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [ids]);
    const { rows } = await client.query(EXPIRE_SQL, [ids, ttlMs]);
    await client.query('COMMIT');
    const expired = (rows[0].ids ?? []).map(Number); // bigint[] llega como strings
    if (expired.length) {
      logger.info({ trades: expired, offers: Number(rows[0].offers) }, '[trades] expired unfunded pending trades');
    }
    return expired;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function defaultFundedOnChain(trade) {
  const contractId = escrowContractIdFor(trade);
  if (!config.stellar.verifyTx || !contractId || !trade.seller_address) return false;
  return (await readEscrow({ contractId, seller: trade.seller_address, tradeId: trade.id })) !== null;
}

/**
 * Arranca el barrido periódico (cada TRADE_EXPIRY_INTERVAL_SECONDS, con desfase aleatorio para que
 * las réplicas no coincidan). Nunca solapa dos rondas en el mismo proceso. Devuelve `stop()`.
 */
export function startTradeExpiryJob({
  intervalMs = config.trades.expiryIntervalMs,
  ttlMs = config.trades.pendingTtlMs,
  logger = defaultLogger,
  run = () => expirePendingTrades({ ttlMs, logger }),
} = {}) {
  if (!ttlMs) {
    logger.info('[trades] pending-trade expiry disabled (PENDING_TRADE_TTL_MINUTES=0)');
    return { stop: async () => {} };
  }
  let running = null;
  let stopped = false;
  const tick = () => {
    if (running || stopped) return;
    running = run()
      .catch((err) => logger.error({ err }, '[trades] pending-trade expiry failed'))
      .finally(() => {
        running = null;
      });
  };
  const first = setTimeout(tick, Math.floor(Math.random() * Math.min(intervalMs, 10_000)));
  const timer = setInterval(tick, intervalMs);
  first.unref();
  timer.unref();
  return {
    /** Detiene el intervalo y espera a la ronda en curso (antes de cerrar el pool). */
    async stop() {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
      await running;
    },
  };
}
