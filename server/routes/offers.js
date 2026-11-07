import { Router } from 'express';
import { pool, one } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../utils/validation.js';
import { badRequest, conflict, forbidden, notFound, parseId } from '../utils/http.js';
import { toOffer } from '../utils/serializers.js';

const router = Router();

const OFFER_SELECT = `
  SELECT o.*, u.display_name AS merchant,
    (SELECT count(*) FROM trades t
      WHERE t.status = 'released' AND (t.seller_id = o.user_id OR t.buyer_id = o.user_id)) AS completed_trades
  FROM offers o
  JOIN users u ON u.id = o.user_id`;

const findOffer = (id) => one(`${OFFER_SELECT} WHERE o.id = $1`, [id]);

/** Campos editables comunes a crear/actualizar (decimales = escala de cada columna). */
function offerFields(v, { optional }) {
  return v
    .number('price', { exclusiveMin: 0, max: 1e12, decimals: 4, optional })
    .number('usdcAmount', { min: 0, max: 1e10, decimals: 7, optional })
    .number('min', { min: 0, max: 1e14, decimals: 2, optional: true })
    .number('max', { min: 0, max: 1e14, decimals: 2, optional: true })
    .string('paymentMethod', { min: 2, max: 60, optional })
    .string('bank', { max: 60, optional: true });
}

/** GET /api/offers — ofertas activas (público). Filtros: type, currency, limit. */
router.get('/', async (req, res) => {
  const q = validate(req.query)
    .oneOf('type', ['buy', 'sell'], { optional: true })
    .currency('currency', { optional: true })
    .number('limit', { min: 1, max: 100, integer: true, optional: true })
    .done();

  const { rows } = await pool.query(
    `${OFFER_SELECT}
      WHERE o.status = 'active' AND o.usdc_amount > 0
        AND ($1::text IS NULL OR o.type = $1)
        AND ($2::text IS NULL OR o.fiat_currency = $2)
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT $3`,
    [q.type ?? null, q.currency ?? null, q.limit ?? 50]
  );
  res.json({ offers: rows.map(toOffer) });
});

/** GET /api/offers/mine — todas mis ofertas (cualquier estado). */
router.get('/mine', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`${OFFER_SELECT} WHERE o.user_id = $1 ORDER BY o.created_at DESC, o.id DESC`, [
    req.user.id,
  ]);
  res.json({ offers: rows.map(toOffer) });
});

router.get('/:id', async (req, res) => {
  const offer = await findOffer(parseId(req.params.id));
  if (!offer) throw notFound('Oferta no encontrada');
  res.json({ offer: toOffer(offer) });
});

router.post('/', requireAuth, async (req, res) => {
  const v = validate(req.body).oneOf('type', ['buy', 'sell']).currency('currency');
  const d = offerFields(v, { optional: false }).done();
  if (d.usdcAmount <= 0) throw badRequest('Datos inválidos', { usdcAmount: 'Debe ser mayor que 0' });
  if (d.min != null && d.max != null && d.min > d.max) {
    throw badRequest('Datos inválidos', { min: 'El mínimo no puede superar el máximo' });
  }

  const { id } = await one(
    `INSERT INTO offers (user_id, type, fiat_currency, fiat_price, usdc_amount, min_fiat, max_fiat, payment_method, bank)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [req.user.id, d.type, d.currency, d.price, d.usdcAmount, d.min ?? null, d.max ?? null, d.paymentMethod, d.bank ?? '']
  );
  res.status(201).json({ offer: toOffer(await findOffer(id)) });
});

// Lista blanca campo de la API → columna.
const COLUMN_MAP = {
  price: 'fiat_price',
  usdcAmount: 'usdc_amount',
  min: 'min_fiat',
  max: 'max_fiat',
  paymentMethod: 'payment_method',
  bank: 'bank',
  status: 'status',
};

/** PATCH /api/offers/:id — editar/pausar/reactivar una oferta propia. */
router.patch('/:id', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  const v = validate(req.body).oneOf('status', ['active', 'paused', 'closed'], { optional: true });
  const d = offerFields(v, { optional: true }).done();

  const offer = await findOffer(id);
  if (!offer) throw notFound('Oferta no encontrada');
  if (offer.user_id !== req.user.id) throw forbidden();
  if (offer.status === 'closed') throw conflict('La oferta está cerrada');

  const min = d.min ?? (offer.min_fiat === null ? null : Number(offer.min_fiat));
  const max = d.max ?? (offer.max_fiat === null ? null : Number(offer.max_fiat));
  if (min != null && max != null && min > max) {
    throw badRequest('Datos inválidos', { min: 'El mínimo no puede superar el máximo' });
  }

  const keys = Object.keys(d).filter((k) => k in COLUMN_MAP);
  if (!keys.length) throw badRequest('Nada que actualizar');
  // Nombres de columna desde COLUMN_MAP (lista blanca); valores siempre parametrizados.
  const sets = keys.map((k, i) => `${COLUMN_MAP[k]} = $${i + 1}`).join(', ');
  await pool.query(`UPDATE offers SET ${sets} WHERE id = $${keys.length + 1}`, [...keys.map((k) => d[k]), id]);
  res.json({ offer: toOffer(await findOffer(id)) });
});

/** DELETE /api/offers/:id — cierre lógico (las operaciones existentes se conservan). */
router.delete('/:id', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  const offer = await findOffer(id);
  if (!offer) throw notFound('Oferta no encontrada');
  if (offer.user_id !== req.user.id) throw forbidden();
  await pool.query("UPDATE offers SET status = 'closed' WHERE id = $1", [id]);
  res.status(204).end();
});

export default router;
