import { Router } from 'express';
import { one, isUniqueViolation } from '../db/pool.js';
import { requireAuth, USER_COLUMNS } from '../middleware/auth.js';
import { validate } from '../utils/validation.js';
import { badRequest, conflict } from '../utils/http.js';
import { toUser } from '../utils/serializers.js';

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
    if (isUniqueViolation(err, 'users_stellar_address_key')) {
      throw conflict('Esa dirección Stellar ya está vinculada a otra cuenta');
    }
    throw err;
  }
  res.json({ user: toUser(user) });
});

export default router;
