import { config } from './config.js';
import { createApp } from './app.js';
import { pool } from './db/pool.js';

// Falla rápido si falta JWT_SECRET o es demasiado corto.
void config.jwt.secret;

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  console.log(`Luminary API escuchando en http://${config.host}:${config.port} (${config.env})`);
});

function shutdown() {
  server.close(() => pool.end().finally(() => process.exit(0)));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
