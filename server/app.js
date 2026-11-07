import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { assertServerConfig, config } from './config.js';
import { logger as defaultLogger, httpLogger } from './logger.js';
import { lifecycle } from './lifecycle.js';
import { pool } from './db/pool.js';
import { cache, CacheUnavailableError } from './cache/index.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import offerRoutes from './routes/offers.js';
import tradeRoutes from './routes/trades.js';
import { HttpError } from './utils/http.js';

/** Orígenes externos a los que la SPA se conecta directamente (Horizon, Soroban RPC, Friendbot). */
function connectSources() {
  const urls = [
    config.stellar.rpcUrl,
    'https://horizon-testnet.stellar.org',
    'https://soroban-testnet.stellar.org',
    'https://friendbot.stellar.org',
    ...config.cspConnectSrc,
  ];
  return [...new Set(urls.map((u) => new URL(u).origin))];
}

/**
 * Política de origen para métodos mutantes (defensa CSRF adicional a SameSite=Strict y al
 * requisito de JSON): si el navegador envía `Origin`, debe ser el propio host, PUBLIC_ORIGIN
 * o uno de CORS_ORIGINS. Clientes sin `Origin` (curl, scripts, server-to-server) pasan.
 * Para CORS_ORIGINS además se responden las cabeceras CORS con credenciales.
 */
function originPolicy() {
  const allowed = new Set([config.publicOrigin, ...config.corsOrigins].filter(Boolean));
  const cors = new Set(config.corsOrigins);
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && cors.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Request-Id');
        res.setHeader('Access-Control-Max-Age', '600');
        return res.status(204).end();
      }
    }
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (mutating && origin && !allowed.has(origin) && origin !== `${req.protocol}://${req.get('host')}`) {
      return res.status(403).json({ error: 'Origen no permitido' });
    }
    next();
  };
}

/** Respuesta 500 genérica: nunca incluye mensaje interno ni stack; sí el id para soporte. */
const internalError = (req) => ({ error: 'Error interno del servidor', requestId: req.id });

/**
 * Crea la app Express. `logger` y `trustProxy` permiten inyectarlos en tests.
 * @param {{ logger?: import('pino').Logger, trustProxy?: boolean | number | string[] }} [opts]
 */
export function createApp({ logger = defaultLogger, trustProxy = config.trustProxy } = {}) {
  assertServerConfig(config);

  const app = express();
  app.disable('x-powered-by');
  // Proxies de confianza para req.ip / req.protocol (el rate limit por IP usa req.ip). Valor
  // validado en config.js: nunca `true`. Por defecto `false` en producción (X-Forwarded-For
  // ignorado) y 'loopback' en desarrollo. Contrato del proxy: docs/PRODUCTION.md → Reverse proxy.
  app.set('trust proxy', trustProxy);

  app.use(httpLogger(logger));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'connect-src': ["'self'", ...connectSources()],
          // Sin upgrade-insecure-requests fuera de producción (permite probar por http://).
          'upgrade-insecure-requests': config.isProd ? [] : null,
        },
      },
      // HSTS solo tiene efecto sobre HTTPS; en producción lo emite también el proxy.
      strictTransportSecurity: config.isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    })
  );
  app.use('/api', originPolicy());
  app.use(express.json({ limit: config.bodyLimit }));
  app.use(cookieParser());

  // Las mutaciones deben ser JSON: impide formularios HTML cross-site (defensa CSRF adicional a SameSite=Strict).
  app.use('/api', (req, res, next) => {
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'];
    if (mutating && hasBody && !req.is('application/json')) {
      return res.status(415).json({ error: 'Content-Type debe ser application/json' });
    }
    next();
  });

  // Liveness: el proceso responde (no consulta dependencias; un fallo de BD no debe reiniciarlo).
  app.get('/api/health/live', (req, res) => res.json({ status: 'ok' }));

  // Readiness: BD + caché disponibles y sin apagado en curso. /api/health es un alias (compatibilidad).
  const ready = async (req, res) => {
    let db = 'ok';
    try {
      await pool.query('SELECT 1');
    } catch {
      db = 'unavailable';
    }
    // cache: 'redis' | 'memory' (sin REDIS_URL) | 'unavailable' (Redis configurado pero caído).
    const cacheState = (await cache.ping()) ? cache.kind : 'unavailable';
    const ok = db === 'ok' && cacheState !== 'unavailable' && !lifecycle.shuttingDown;
    const body = { status: lifecycle.shuttingDown ? 'shutting_down' : ok ? 'ok' : 'degraded', db, cache: cacheState };
    if (!ok) req.log.warn({ health: body }, 'readiness check failed');
    res.status(ok ? 200 : 503).json(body);
  };
  app.get('/api/health/ready', ready);
  app.get('/api/health', ready);

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/offers', offerRoutes);
  app.use('/api/trades', tradeRoutes);

  app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  // SPA compilada (opcional): assets con hash cacheables 1 año, index.html sin caché.
  if (config.staticDir) {
    const dir = path.resolve(config.staticDir);
    const indexHtml = path.join(dir, 'index.html');
    if (!existsSync(indexHtml)) throw new Error(`STATIC_DIR=${dir} no contiene index.html (¿npm run build?)`);
    app.use(
      '/assets',
      express.static(path.join(dir, 'assets'), { immutable: true, maxAge: '1y', index: false, fallthrough: false })
    );
    app.use(express.static(dir, { index: false, maxAge: '1h' }));
    // Fallback del router del cliente: cualquier GET que acepte HTML devuelve index.html.
    app.use((req, res, next) => {
      if (!['GET', 'HEAD'].includes(req.method) || !req.accepts('html')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  }

  // Manejador central: respuestas controladas; los detalles internos solo van al log.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return req.socket.destroy();
    if (err instanceof HttpError) {
      if (err.status >= 500) req.log.error({ err }, 'upstream error');
      return res.status(err.status).json({ error: err.message, ...(err.details && { details: err.details }) });
    }
    if (err instanceof CacheUnavailableError) {
      req.log.error({ err }, 'cache unavailable → 503');
      return res.status(503).json({ error: 'Servicio temporalmente no disponible; intenta de nuevo en unos segundos' });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Cuerpo demasiado grande' });
    if (err.status === 404 && err.code === 'ENOENT') return res.status(404).end(); // asset inexistente
    // Otros errores 4xx de body-parser/express (p.ej. charset no soportado, petición abortada).
    if (err.expose && err.status >= 400 && err.status < 500) {
      return res.status(err.status).json({ error: 'Petición inválida' });
    }
    req.log.error({ err }, 'unhandled error');
    res.status(500).json(internalError(req));
  });

  return app;
}
