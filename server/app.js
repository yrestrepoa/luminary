import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pool } from './db/pool.js';
import { cache, CacheUnavailableError } from './cache/index.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import offerRoutes from './routes/offers.js';
import tradeRoutes from './routes/trades.js';
import { HttpError } from './utils/http.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback'); // Vite proxy / reverse proxy local → IP real para el rate limit
  app.use(helmet());
  app.use(express.json({ limit: '20kb' }));
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

  app.get('/api/health', async (req, res) => {
    let db = 'ok';
    try {
      await pool.query('SELECT 1');
    } catch {
      db = 'unavailable';
    }
    // cache: 'redis' | 'memory' (sin REDIS_URL) | 'unavailable' (Redis configurado pero caído).
    const cacheState = (await cache.ping()) ? cache.kind : 'unavailable';
    const ok = db === 'ok' && cacheState !== 'unavailable';
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', db, cache: cacheState });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/offers', offerRoutes);
  app.use('/api/trades', tradeRoutes);

  app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...(err.details && { details: err.details }) });
    }
    if (err instanceof CacheUnavailableError) {
      console.error(`[cache] ${err.cause?.message ?? err.message} → 503`);
      return res.status(503).json({ error: 'Servicio temporalmente no disponible; intenta de nuevo en unos segundos' });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Cuerpo demasiado grande' });
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  return app;
}
