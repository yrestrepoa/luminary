import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { CacheRateLimitStore } from '../cache/rateLimitStore.js';
import { revocations } from '../cache/revocations.js';
import { one, isUniqueViolation, withTransaction } from '../db/pool.js';
import { requireAuth, clearAuthCookie, tokenPayload, USER_COLUMNS } from '../middleware/auth.js';
import { validate } from '../utils/validation.js';
import { badRequest, conflict, unauthorized } from '../utils/http.js';
import { toUser } from '../utils/serializers.js';

/** Estados de trade en curso: con alguno de ellos la cuenta no se puede eliminar. */
export const OPEN_TRADE_STATUSES = ['pending', 'funded', 'paid', 'disputed'];

// Confirmación de contraseña al eliminar la cuenta: como mucho 5 contraseñas erróneas por cuenta
// cada 15 min (una cookie robada no sirve para adivinar la contraseña por fuerza bruta).
const deleteAccountLimiter = rateLimit({
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' },
  windowMs: 15 * 60 * 1000,
  limit: 5,
  requestWasSuccessful: (req, res) => res.statusCode !== 401,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => String(req.user.id),
  store: new CacheRateLimitStore('rl:delete-account:'),
});

const router = Router();

/** PATCH /api/users/me — nombre visible y/o dirección Stellar (null = desvincular). */
router.patch('/me', requireAuth, async (req, res) => {
  const data = validate(req.body)
    .string('displayName', { min: 2, max: 60, optional: true })
    .stellarAddress('stellarAddress')
    .done();

  if (data.displayName === undefined && data.stellarAddress === undefined) throw badRequest('Nada que actualizar');

  let user;
  try {
    // $2/$4 indican si el campo viene en el body; así el SQL es fijo y totalmente parametrizado.
    user = await one(
      `UPDATE users
          SET display_name    = CASE WHEN $2 THEN $1 ELSE display_name END,
              stellar_address = CASE WHEN $4 THEN $3 ELSE stellar_address END
        WHERE id = $5
      RETURNING ${USER_COLUMNS}`,
      [
        data.displayName ?? null,
        data.displayName !== undefined,
        data.stellarAddress ?? null,
        data.stellarAddress !== undefined,
        req.user.id,
      ]
    );
  } catch (err) {
    // Auditoría M2: mensaje genérico, sin confirmar que la dirección pertenece a otra cuenta
    // (evita usar este endpoint para saber si una dirección on-chain es usuaria de Luminary).
    // Residual: el 409 sigue distinguiéndose de un 200; cerrarlo requiere prueba de propiedad (L2).
    if (isUniqueViolation(err, 'users_stellar_address_key')) {
      throw conflict('No se pudo vincular esa dirección Stellar');
    }
    throw err;
  }
  res.json({ user: toUser(user) });
});

/**
 * DELETE /api/users/me — elimina la cuenta propia. Body: `{ password }` (se vuelve a pedir la
 * contraseña). Regla (README → Account deletion):
 *  - 409 si es parte de algún trade en curso (pending, funded, paid, disputed): hay que
 *    cancelarlo, liberarlo o reembolsarlo antes (con fondos en escrow no se puede abandonar).
 *  - Sin ningún trade: la fila se borra (sus ofertas se borran en cascada).
 *  - Con trades cerrados: la fila se anonimiza (email, nombre, contraseña y dirección Stellar
 *    borrados, `deleted_at`), sus ofertas se cierran y el historial de la contraparte se conserva.
 * En ambos casos se revoca el JWT actual y cualquier otra sesión deja de valer (requireAuth
 * ignora filas borradas o con `deleted_at`). 204 sin cuerpo.
 */
router.delete('/me', requireAuth, deleteAccountLimiter, async (req, res) => {
  const { password } = validate(req.body).string('password', { min: 1, max: 72, trim: false }).done();
  const userId = req.user.id;

  const { password_hash: hash } = await one('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!(await bcrypt.compare(password, hash))) throw unauthorized('Contraseña incorrecta');

  await withTransaction(async (client) => {
    // Orden de bloqueos: (1) la fila del usuario, que espera a los INSERT de trades en curso que
    // lo referencian; (2) sus ofertas, que espera a POST /api/trades (SELECT … FOR UPDATE OF o).
    // Tras ambos, ningún trade nuevo puede aparecer sin que lo veamos o sin encontrar la oferta
    // cerrada.
    const user = await one('SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [userId], client);
    if (!user) throw unauthorized();
    await client.query(`UPDATE offers SET status = 'closed' WHERE user_id = $1 AND status <> 'closed'`, [userId]);

    const { rows } = await client.query(
      `SELECT status, count(*)::int AS n FROM trades
        WHERE (buyer_id = $1 OR seller_id = $1)
        GROUP BY status`,
      [userId]
    );
    const open = rows.filter((r) => OPEN_TRADE_STATUSES.includes(r.status));
    if (open.length) {
      const n = open.reduce((sum, r) => sum + r.n, 0);
      throw conflict(
        `Tienes ${n} trade(s) en curso: cancélalos, libéralos o reembolsa el escrow antes de eliminar la cuenta`
      );
    }

    if (rows.length === 0) {
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
    } else {
      await client.query(
        `UPDATE users
            SET email = 'deleted-' || id || '@deleted.invalid',
                password_hash = '!',
                display_name = 'Cuenta eliminada',
                stellar_address = NULL,
                deleted_at = now()
          WHERE id = $1`,
        [userId]
      );
    }
  });

  clearAuthCookie(res);
  const payload = tokenPayload(req);
  if (payload?.jti) await revocations.revoke(payload.jti, payload.exp);
  req.log.info({ userId }, 'account deleted');
  res.status(204).end();
});

export default router;
