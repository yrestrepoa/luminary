import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { one } from '../db/pool.js';
import { revocations } from '../cache/revocations.js';
import { unauthorized } from '../utils/http.js';

export const USER_COLUMNS = 'id, email, display_name, stellar_address, created_at';

/** JWT con `jti` aleatorio: permite revocar un token concreto (logout) antes de que expire. */
export function signToken(userId) {
  return jwt.sign({ sub: String(userId) }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
    algorithm: 'HS256',
    jwtid: randomUUID(),
  });
}

export const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'strict',
  secure: config.cookieSecure,
  path: '/',
});

export function setAuthCookie(res, userId) {
  res.cookie(config.cookieName, signToken(userId), { ...cookieOptions(), maxAge: config.jwt.maxAgeMs });
}

export function clearAuthCookie(res) {
  res.clearCookie(config.cookieName, cookieOptions());
}

/** Payload del JWT de la cookie si la firma y la expiración son válidas (sin consultar revocación), o null. */
export function tokenPayload(req) {
  const token = req.cookies?.[config.cookieName];
  if (!token) return null;
  try {
    return jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}

/**
 * Resuelve el usuario del JWT (cookie) o null. Rechaza tokens sin `jti` (emitidos antes
 * de la revocación) y tokens revocados. Si Redis no responde, isRevoked() lanza → 503.
 */
async function userFromRequest(req) {
  const payload = tokenPayload(req);
  if (!payload || typeof payload.jti !== 'string') return null;
  const id = Number(payload.sub);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  if (await revocations.isRevoked(payload.jti)) return null;
  // Cuentas eliminadas (anonimizadas, ver DELETE /api/users/me): ninguna sesión vale.
  return one(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]);
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
