import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { one } from '../db/pool.js';
import { unauthorized } from '../utils/http.js';

export const USER_COLUMNS = 'id, email, display_name, stellar_address, created_at';

export function signToken(userId) {
  return jwt.sign({ sub: String(userId) }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
    algorithm: 'HS256',
  });
}

export const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'strict',
  secure: config.isProd,
  path: '/',
});

export function setAuthCookie(res, userId) {
  res.cookie(config.cookieName, signToken(userId), { ...cookieOptions(), maxAge: config.jwt.maxAgeMs });
}

export function clearAuthCookie(res) {
  res.clearCookie(config.cookieName, cookieOptions());
}

/** Resuelve el usuario del JWT (cookie) o null. */
async function userFromRequest(req) {
  const token = req.cookies?.[config.cookieName];
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  const id = Number(payload.sub);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return one(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
}

/** Exige sesión válida; deja el usuario en `req.user`. */
export async function requireAuth(req, res, next) {
  const user = await userFromRequest(req);
  if (!user) {
    clearAuthCookie(res);
    throw unauthorized();
  }
  req.user = user;
  next();
}
