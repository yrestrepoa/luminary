import { config } from './config.js';
import { createApp } from './app.js';
import { pool } from './db/pool.js';
import { cache } from './cache/index.js';

// Falla rápido si falta JWT_SECRET o es demasiado corto.
void config.jwt.secret;

// Con REDIS_URL: intenta conectar (timeout corto). Si Redis no está, la API arranca igual
// pero las rutas que dependen de él responden 503 hasta que reconecte (fail-closed).
await cache.init();

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  console.log(`Luminary API escuchando en http://${config.host}:${config.port} (${config.env})`);
});

function shutdown() {
  server.close(() => Promise.allSettled([pool.end(), cache.close()]).finally(() => process.exit(0)));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
