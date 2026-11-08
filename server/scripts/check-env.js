// Comprobación previa de `npm run dev` (script `predev`): valida la configuración de la API
// antes de lanzar API + Vite. Sin ella, si falta .env o JWT_SECRET es el de ejemplo, la API
// muere al arrancar pero `node --watch` sigue vivo ("Waiting for file changes"), concurrently
// no corta Vite y el proxy /api solo muestra `connect ECONNREFUSED 127.0.0.1:4000`.
import { existsSync } from 'node:fs';

try {
  const { config, assertServerConfig } = await import('../config.js');
  assertServerConfig(config);
} catch (err) {
  if (err.name !== 'ConfigError') throw err;
  const hint = existsSync('.env')
    ? 'Corrige .env (ver .env.example y README → "Configure the environment").'
    : 'No existe .env: ejecuta `cp .env.example .env` y define JWT_SECRET (openssl rand -hex 48).';
  console.error(`\n✖ La API no puede arrancar. ${err.message}\n\n  ${hint}\n`);
  process.exit(1);
}
