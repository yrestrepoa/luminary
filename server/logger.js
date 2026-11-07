// Logging estructurado (JSON, una línea por evento) con pino.
//
// Nunca se registran cuerpos de petición/respuesta, cookies, cabeceras de autorización ni
// contraseñas/tokens: los serializers solo emiten campos de una lista blanca y `redact`
// cubre cualquier campo sensible que llegue por error en un objeto registrado a mano.
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';

export const REDACT_PATHS = [
  'password',
  'password_hash',
  'passwordHash',
  'token',
  'jwt',
  'secret',
  'cookie',
  'authorization',
  '*.password',
  '*.password_hash',
  '*.passwordHash',
  '*.token',
  '*.secret',
  '*.cookie',
  '*.authorization',
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
];

/** Error → objeto de log sin propiedades arbitrarias (p.ej. `detail` de pg puede contener emails). */
export function serializeError(err) {
  if (!(err instanceof Error)) return { message: String(err) };
  const out = { type: err.name, message: err.message, stack: err.stack };
  if (err.code !== undefined) out.code = err.code;
  if (err.status !== undefined) out.status = err.status;
  if (err.cause) out.cause = serializeError(err.cause);
  return out;
}

export function createLogger({ level = config.logLevel, destination } = {}) {
  return pino(
    {
      level,
      base: { service: 'luminary-api', env: config.env },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      serializers: { err: serializeError, error: serializeError },
      formatters: { level: (label) => ({ level: label }) },
    },
    destination
  );
}

export const logger = createLogger();

const REQUEST_ID_RE = /^[\w.-]{1,64}$/;

/** Reutiliza X-Request-Id entrante si es seguro (lo pone un proxy) o genera uno nuevo. */
export function requestId(req, res) {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

/** Middleware de log de acceso: una línea por petición con id, método, ruta, estado y duración. */
export function httpLogger(log = logger) {
  return pinoHttp({
    logger: log,
    genReqId: requestId,
    // Ruta sin query string (puede contener datos del usuario).
    serializers: {
      req: (req) => ({
        id: req.id,
        method: req.method,
        url: req.url?.split('?')[0],
        ip: req.raw?.ip ?? req.remoteAddress,
      }),
      res: (res) => ({ statusCode: res.statusCode }),
      err: serializeError,
    },
    customLogLevel: (req, res, err) =>
      err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    // Los health checks se consultan cada pocos segundos: solo se registran si fallan.
    autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') },
    customSuccessMessage: (req, res) => `${req.method} ${(req.originalUrl ?? req.url).split('?')[0]} ${res.statusCode}`,
    customErrorMessage: (req, res) => `${req.method} ${(req.originalUrl ?? req.url).split('?')[0]} ${res.statusCode}`,
    quietReqLogger: true,
  });
}
