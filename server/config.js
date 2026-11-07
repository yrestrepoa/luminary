import 'dotenv/config';

/** Lee una variable de entorno obligatoria (falla al arrancar si falta). */
function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Falta la variable de entorno ${name} (ver .env.example)`);
  }
  return value;
}

const NODE_ENV = process.env.NODE_ENV ?? 'development';

export const config = {
  env: NODE_ENV,
  isProd: NODE_ENV === 'production',
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 4000),
  // DATABASE_URL tiene prioridad; si no está, `pg` usa PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.
  databaseUrl: process.env.DATABASE_URL || undefined,
  // Redis para rate limit y revocación de tokens. Vacío → memoria del proceso (solo desarrollo).
  redisUrl: process.env.REDIS_URL || undefined,
  jwt: {
    get secret() {
      const s = required('JWT_SECRET');
      if (s.length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres');
      return s;
    },
    expiresIn: '7d',
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  },
  cookieName: 'luminary_token',
  stellar: {
    horizonUrl: process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org',
    usdcCode: 'USDC',
    usdcIssuer: process.env.USDC_ISSUER ?? 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    // Verifica en Horizon el pago USDC antes de marcar un trade como liberado.
    verifyTx: (process.env.VERIFY_STELLAR_TX ?? 'true') !== 'false',
  },
};
