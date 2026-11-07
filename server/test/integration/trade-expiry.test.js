// Audit L1: los trades `pending` nunca fondeados caducan y devuelven la liquidez a la oferta,
// exactamente una vez aunque varias réplicas barran a la vez.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSellOffer, describeIntegration, fakeHash, registerUser } from '../helpers/app.js';
import { expirePendingTrades } from '../../jobs/tradeExpiry.js';
import { createPool } from '../../db/pool.js';
import { config } from '../../config.js';

const TTL = config.trades.pendingTtlMs;
const silent = { info() {}, warn() {}, error() {} };
const notFunded = async () => false;

describeIntegration('pending trade expiry (audit L1)', (ctx) => {
  let seller, buyer, wide;
  const available = async (id) => (await buyer.agent.get(`/api/offers/${id}`).expect(200)).body.offer.available;
  const take = async (offerId, usdcAmount) =>
    (await buyer.agent.post('/api/trades').send({ offerId, usdcAmount }).expect(201)).body.trade;
  const age = (ids, minutes) =>
    ctx.pool.query(`UPDATE trades SET created_at = now() - make_interval(mins => $2) WHERE id = ANY($1)`, [
      ids,
      minutes,
    ]);
  const statusOf = async (id) =>
    (await ctx.pool.query('SELECT status, cancel_reason FROM trades WHERE id = $1', [id])).rows[0];
  const run = (opts = {}) => expirePendingTrades({ pool: ctx.pool, fundedOnChain: notFunded, logger: silent, ...opts });

  beforeAll(async () => {
    seller = await registerUser(ctx.app, { name: 'Seller' });
    buyer = await registerUser(ctx.app, { name: 'Buyer' });
    // Pool propio con más conexiones para simular varias réplicas a la vez.
    wide = createPool({ ...config.db, max: 12 }, process.env.TEST_DATABASE_URL);
    await run(); // deja la BD sin pendientes caducados de otros archivos
  });
  afterAll(() => wide?.end());

  it('expires only stale pending trades and restores their liquidity', async () => {
    const offer = await createSellOffer(seller.agent, { usdc: 100, price: 1 });
    const [stale1, stale2, fresh, funded] = [
      await take(offer.id, 10),
      await take(offer.id, 15),
      await take(offer.id, 5),
      await take(offer.id, 20),
    ];
    await seller.agent.post(`/api/trades/${funded.id}/fund`).send({ txHash: fakeHash() }).expect(200);
    await age([stale1.id, stale2.id, funded.id], TTL / 60_000 + 1);
    expect(await available(offer.id)).toBe(50);

    const expired = await run();
    expect(expired.sort()).toEqual([stale1.id, stale2.id].sort());
    expect(await statusOf(stale1.id)).toEqual({ status: 'cancelled', cancel_reason: 'expired' });
    expect(await statusOf(fresh.id)).toMatchObject({ status: 'pending' });
    expect(await statusOf(funded.id)).toMatchObject({ status: 'funded' });
    expect(await available(offer.id)).toBe(75);

    // Idempotente: una segunda ronda no toca nada.
    expect(await run()).toEqual([]);
    expect(await available(offer.id)).toBe(75);

    // El trade caducado ya no puede fondearse, con un mensaje claro.
    const res = await seller.agent.post(`/api/trades/${stale1.id}/fund`).send({ txHash: fakeHash() }).expect(409);
    expect(res.body.error).toMatch(/caducó/);
    const view = (await buyer.agent.get(`/api/trades/${stale1.id}`).expect(200)).body.trade;
    expect(view).toMatchObject({ status: 'cancelled', cancelReason: 'expired', expiresAt: null });
    expect((await buyer.agent.get(`/api/trades/${fresh.id}`).expect(200)).body.trade.expiresAt).toBeTruthy();
  });

  it('does not expire a trade whose escrow exists on-chain, nor when the chain cannot be checked', async () => {
    const offer = await createSellOffer(seller.agent, { usdc: 30, price: 1 });
    const [onChain, rpcDown, clean] = [await take(offer.id, 10), await take(offer.id, 10), await take(offer.id, 10)];
    await age([onChain.id, rpcDown.id, clean.id], TTL / 60_000 + 1);
    const fundedOnChain = async (t) => {
      if (t.id === onChain.id) return true;
      if (t.id === rpcDown.id) throw new Error('RPC down');
      return false;
    };
    expect(await run({ fundedOnChain })).toEqual([clean.id]);
    expect(await statusOf(onChain.id)).toMatchObject({ status: 'pending' });
    expect(await statusOf(rpcDown.id)).toMatchObject({ status: 'pending' });
    expect(await available(offer.id)).toBe(10);
    // Limpieza: que no interfieran en las pruebas siguientes.
    await ctx.pool.query("UPDATE trades SET status = 'cancelled' WHERE id = ANY($1)", [[onChain.id, rpcDown.id]]);
  });

  it('is disabled with a TTL of 0', async () => {
    const offer = await createSellOffer(seller.agent, { usdc: 5, price: 1 });
    const t = await take(offer.id, 5);
    await age([t.id], 60 * 24);
    expect(await run({ ttlMs: 0 })).toEqual([]);
    expect(await statusOf(t.id)).toMatchObject({ status: 'pending' });
    expect(await run()).toEqual([t.id]);
  });

  it.each([
    ['with the advisory lock', true],
    ['without the lock (SQL guard alone)', false],
  ])('restores liquidity exactly once when many replicas sweep concurrently %s', async (_name, useLock) => {
    const offer = await createSellOffer(seller.agent, { usdc: 100, price: 1 });
    const trades = [];
    for (let i = 0; i < 8; i++) trades.push(await take(offer.id, 10));
    await age(
      trades.map((t) => t.id),
      TTL / 60_000 + 1
    );
    expect(await available(offer.id)).toBe(20);

    const results = await Promise.all(Array.from({ length: 10 }, () => run({ pool: wide, useLock })));
    const all = results.flat();
    expect(new Set(all).size).toBe(all.length); // ningún trade expirado dos veces
    expect(all.sort((a, b) => a - b)).toEqual(trades.map((t) => t.id).sort((a, b) => a - b));
    expect(await available(offer.id)).toBe(100);
  });

  it('never double-restores when a party cancels while the sweep runs', async () => {
    const offer = await createSellOffer(seller.agent, { usdc: 40, price: 1 });
    const trades = [];
    for (let i = 0; i < 4; i++) trades.push(await take(offer.id, 10));
    await age(
      trades.map((t) => t.id),
      TTL / 60_000 + 1
    );
    const cancels = trades.map((t) => buyer.agent.post(`/api/trades/${t.id}/cancel`));
    const [sweepA, sweepB, ...responses] = await Promise.all([
      run({ pool: wide, useLock: false }),
      run({ pool: wide, useLock: false }),
      ...cancels,
    ]);
    // Cada trade lo cerró exactamente uno: el barrido o el cancel (el otro recibe 409).
    const cancelled = responses.filter((r) => r.status === 200).length;
    expect(cancelled + sweepA.length + sweepB.length).toBe(4);
    expect(responses.every((r) => [200, 409].includes(r.status))).toBe(true);
    expect(await available(offer.id)).toBe(40);
  });
});
