// Punto de entrada de la API: valida la configuración, conecta dependencias, sirve HTTP y
// se apaga de forma ordenada (SIGTERM/SIGINT): deja de aceptar conexiones, marca readiness
// como 503, drena las peticiones en curso (hasta SHUTDOWN_TIMEOUT_MS) y cierra Postgres y Redis.
import { lifecycle } from './lifecycle.js';

let config, logger;
try {
  const mod = await import('./config.js');
  config = mod.config;
  mod.assertServerConfig(config); // fail fast: JWT_SECRET débil, requisitos de producción…
  ({ logger } = await import('./logger.js'));
} catch (err) {
  if (err.name !== 'ConfigError') throw err;
  // Sin config válida no hay logger configurado: una línea JSON compatible con el resto de logs.
  console.error(
    JSON.stringify({ level: 'fatal', time: new Date().toISOString(), problems: err.problems, msg: err.message })
  );
  process.exit(1);
}

const { createApp } = await import('./app.js');
const { pool } = await import('./db/pool.js');
const { cache } = await import('./cache/index.js');
const { startTradeExpiryJob } = await import('./jobs/tradeExpiry.js');

if (config.isProd && !config.trustProxyExplicit) {
  logger.warn(
    'TRUST_PROXY no definido: X-Forwarded-For se ignora y el rate limit por IP usa la IP del socket. ' +
      'Detrás de un proxy inverso fija TRUST_PROXY (p.ej. 1) — ver docs/PRODUCTION.md.'
  );
}

// Con REDIS_URL: intenta conectar (timeout corto). Si Redis no está, la API arranca igual
// pero las rutas que dependen de él responden 503 hasta que reconecte (fail-closed).
await cache.init();

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  const { port } = server.address();
  logger.info({ host: config.host, port }, `Luminary API escuchando en http://${config.host}:${port}`);
});
// Cancela trades `pending` nunca fondeados pasado PENDING_TRADE_TTL_MINUTES (seguro con varias réplicas).
const tradeExpiry = startTradeExpiryJob();

// Timeouts HTTP: cortan clientes lentos (slowloris) y alinean keep-alive con el proxy
// (el keep-alive del proxy hacia la API debe ser MENOR que keepAliveTimeout).
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 65_000;

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) {
    logger.warn({ signal }, 'second signal: forcing exit');
    process.exit(1);
  }
  shuttingDown = true;
  lifecycle.shuttingDown = true;
  const started = Date.now();
  logger.info({ signal, timeoutMs: config.shutdownTimeoutMs }, 'shutdown: draining connections');

  const force = setTimeout(() => {
    logger.warn('shutdown: timeout reached, closing remaining connections');
    server.closeAllConnections();
  }, config.shutdownTimeoutMs);
  force.unref();

  // close(): deja de aceptar conexiones y resuelve cuando terminan las peticiones en curso.
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeIdleConnections();
  });
  clearTimeout(force);
  await tradeExpiry.stop().catch((err) => logger.error({ err }, 'shutdown: trade expiry stop failed'));
  const results = await Promise.allSettled([pool.end(), cache.close()]);
  for (const r of results) if (r.status === 'rejected') logger.error({ err: r.reason }, 'shutdown: close failed');
  logger.info({ ms: Date.now() - started }, 'shutdown complete');
  logger.flush?.();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception: exiting');
  logger.flush?.();
  process.exit(1);
});
