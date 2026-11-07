// Utilidades para tests de integración: app real + Postgres/Redis desechables.
import { afterAll, beforeAll, describe } from 'vitest';
import request from 'supertest';
import { createClient } from 'redis';
import { Keypair } from '@stellar/stellar-sdk';

export const hasServices = Boolean(process.env.TEST_DATABASE_URL);

/**
 * describe() que solo corre con TEST_DATABASE_URL definida (CI la define con service
 * containers; en local: ver "Tests" en README). Prepara la BD y limpia estado antes del archivo.
 */
export function describeIntegration(name, fn) {
  return describe.skipIf(!hasServices)(name, () => {
    const ctx = {};
    beforeAll(async () => {
      const [{ createApp }, { pool }, { cache }, { migrate }] = await Promise.all([
        import('../../app.js'),
        import('../../db/pool.js'),
        import('../../cache/index.js'),
        import('../../db/migrator.js'),
      ]);
      await migrate(pool);
      await pool.query('TRUNCATE trades, offers, users RESTART IDENTITY CASCADE');
      await flushRedis();
      await cache.init();
      Object.assign(ctx, { pool, cache, app: createApp() });
    });
    afterAll(async () => {
      await ctx.cache?.close();
      await ctx.pool?.end();
    });
    fn(ctx);
  });
}

/** Borra las claves luminary:* del Redis de pruebas (contadores de rate limit, revocaciones). */
export async function flushRedis() {
  if (!process.env.TEST_REDIS_URL) return;
  const client = createClient({ url: process.env.TEST_REDIS_URL });
  await client.connect();
  for await (const keys of client.scanIterator({ MATCH: 'luminary:*', COUNT: 500 })) {
    if (keys.length) await client.del(keys);
  }
  await client.close();
}

let seq = 0;
/** Registra un usuario y devuelve un agente supertest con su cookie de sesión. */
export async function registerUser(app, { name = 'User', address = true } = {}) {
  const agent = request.agent(app);
  const email = `user${++seq}-${Date.now()}@example.com`;
  const res = await agent
    .post('/api/auth/register')
    .send({ email, password: 'supersecret1', displayName: name })
    .expect(201);
  let user = res.body.user;
  if (address) {
    const stellarAddress = Keypair.random().publicKey();
    user = (await agent.patch('/api/users/me').send({ stellarAddress }).expect(200)).body.user;
  }
  return { agent, user, email, password: 'supersecret1' };
}

export const fakeHash = (c) =>
  c ? c.repeat(64) : [...Array(64)].map(() => '0123456789abcdef'[(Math.random() * 16) | 0]).join('');

/** Crea una oferta de venta de `usdc` USDC a `price` COP. */
export async function createSellOffer(agent, { usdc = 100, price = 4000, ...rest } = {}) {
  const res = await agent
    .post('/api/offers')
    .send({ type: 'sell', currency: 'COP', price, usdcAmount: usdc, paymentMethod: 'Nequi', ...rest })
    .expect(201);
  return res.body.offer;
}
