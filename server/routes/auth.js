import { createHash } from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { CacheRateLimitStore } from '../cache/rateLimitStore.js';
import { one, isUniqueViolation } from '../db/pool.js';
import { requireAuth, setAuthCookie, clearAuthCookie, tokenPayload, USER_COLUMNS } from '../middleware/auth.js';
import { revocations } from '../cache/revocations.js';
import { validate } from '../utils/validation.js';
import { conflict, unauthorized } from '../utils/http.js';
import { toUser } from '../utils/serializers.js';

const BCRYPT_ROUNDS = 12;
// Hash ficticio para igualar tiempos cuando el email no existe (evita enumeración por timing).
const DUMMY_HASH = bcrypt.hashSync('luminary-timing-equalizer', BCRYPT_ROUNDS);

const limiterOpts = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' },
};
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_LIMIT_PER_IP = 10;
export const LOGIN_LIMIT_PER_ACCOUNT = 10;

/**
 * Clave del limitador por cuenta: SHA-256 del email normalizado (minúsculas, sin espacios), para
 * no guardar emails en claro en Redis. Sin email (cuerpo inválido) → null y no cuenta.
 */
export function accountKey(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > 255) return null;
  return createHash('sha256').update(email).digest('hex');
}

// Contadores en Redis (compartidos entre procesos) o en memoria si no hay REDIS_URL.
// Login: dos límites independientes sobre intentos FALLIDOS (los exitosos no cuentan):
//  - por IP (req.ip, que depende de TRUST_PROXY): frena a un atacante probando muchas cuentas;
//  - por cuenta (email): frena la fuerza bruta contra UNA cuenta aunque el atacante rote IPs
//    (o falsee X-Forwarded-For). Contrapartida: un atacante puede bloquear el login de una
//    cuenta concreta durante la ventana; se acepta frente al riesgo de adivinar la contraseña.
const loginIpLimiter = rateLimit({
  ...limiterOpts,
  windowMs: LOGIN_WINDOW_MS,
  limit: LOGIN_LIMIT_PER_IP,
  skipSuccessfulRequests: true,
  store: new CacheRateLimitStore('rl:login:'),
});
const loginAccountLimiter = rateLimit({
  ...limiterOpts,
  windowMs: LOGIN_WINDOW_MS,
  limit: LOGIN_LIMIT_PER_ACCOUNT,
  skipSuccessfulRequests: true,
  skip: (req) => accountKey(req.body) === null,
  keyGenerator: (req) => accountKey(req.body),
  store: new CacheRateLimitStore('rl:login-account:'),
});
const registerLimiter = rateLimit({
  ...limiterOpts,
  windowMs: 60 * 60 * 1000,
  limit: 20,
  store: new CacheRateLimitStore('rl:register:'),
});

const router = Router();

router.post('/register', registerLimiter, async (req, res) => {
  const { email, password, displayName } = validate(req.body)
    .email('email')
    // bcrypt solo usa los primeros 72 bytes.
    .string('password', { min: 8, max: 72, trim: false })
    .check(Buffer.byteLength(String(req.body?.password ?? '')) <= 72, 'password', 'Máximo 72 bytes')
    .string('displayName', { min: 2, max: 60 })
    .done();

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  let user;
  try {
    user = await one(
      `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING ${USER_COLUMNS}`,
      [email, hash, displayName]
    );
  } catch (err) {
    if (isUniqueViolation(err, 'users_email_lower_key')) throw conflict('Ya existe una cuenta con ese email');
    throw err;
  }

  setAuthCookie(res, user.id);
  res.status(201).json({ user: toUser(user) });
});

router.post('/login', loginIpLimiter, loginAccountLimiter, async (req, res) => {
  const { email, password } = validate(req.body)
    .email('email')
    .string('password', { min: 1, max: 72, trim: false })
    .done();

  const user = await one(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE lower(email) = $1`, [email]);
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Email o contraseña incorrectos');

  setAuthCookie(res, user.id);
  res.json({ user: toUser(user) });
});

/**
 * Cierra sesión: revoca el `jti` del token hasta su expiración (así una copia robada de la
 * cookie deja de servir) y borra la cookie. Si Redis no responde, la cookie se borra igual
 * pero se responde 503 para que el cliente sepa que el token sigue siendo válido en servidor.
 */
router.post('/logout', async (req, res) => {
  clearAuthCookie(res);
  const payload = tokenPayload(req);
  if (payload?.jti) await revocations.revoke(payload.jti, payload.exp);
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: toUser(req.user) });
});

export default router;
