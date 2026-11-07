import { beforeAll, expect, it } from 'vitest';
import request from 'supertest';
import { createSellOffer, describeIntegration, registerUser } from '../helpers/app.js';

describeIntegration('offers', (ctx) => {
  let alice, bob;
  beforeAll(async () => {
    alice = await registerUser(ctx.app, { name: 'Alice' });
    bob = await registerUser(ctx.app, { name: 'Bob' });
  });

  it('requires auth to create', async () => {
    await request(ctx.app)
      .post('/api/offers')
      .send({ type: 'sell', currency: 'COP', price: 1, usdcAmount: 1, paymentMethod: 'Nequi' })
      .expect(401);
  });

  it('creates an offer and lists it publicly with filters', async () => {
    const offer = await createSellOffer(alice.agent, { usdc: 50, price: 4100.5, min: 1000, max: 500000, bank: 'B' });
    expect(offer).toMatchObject({
      type: 'sell',
      currency: 'COP',
      price: 4100.5,
      available: 50,
      min: 1000,
      max: 500000,
      merchant: 'Alice',
      status: 'active',
      trades: 0,
    });
    await bob.agent
      .post('/api/offers')
      .send({ type: 'buy', currency: 'MXN', price: 18, usdcAmount: 5, paymentMethod: 'SPEI' })
      .expect(201);

    const all = (await request(ctx.app).get('/api/offers').expect(200)).body.offers;
    expect(all.length).toBeGreaterThanOrEqual(2);
    const sells = (await request(ctx.app).get('/api/offers?type=sell&currency=COP').expect(200)).body.offers;
    expect(sells.every((o) => o.type === 'sell' && o.currency === 'COP')).toBe(true);
    expect((await request(ctx.app).get('/api/offers?limit=1').expect(200)).body.offers).toHaveLength(1);
    expect((await request(ctx.app).get(`/api/offers/${offer.id}`).expect(200)).body.offer.id).toBe(offer.id);
  });

  it('validates input and query filters', async () => {
    const res = await alice.agent
      .post('/api/offers')
      .send({ type: 'swap', currency: 'cop', price: -1, usdcAmount: 1.123456789, paymentMethod: 'x' })
      .expect(400);
    expect(Object.keys(res.body.details).sort()).toEqual(['currency', 'paymentMethod', 'price', 'type', 'usdcAmount']);
    await alice.agent
      .post('/api/offers')
      .send({ type: 'sell', currency: 'COP', price: 1, usdcAmount: 0, paymentMethod: 'Nequi' })
      .expect(400);
    await alice.agent
      .post('/api/offers')
      .send({ type: 'sell', currency: 'COP', price: 1, usdcAmount: 1, min: 10, max: 5, paymentMethod: 'Nequi' })
      .expect(400);
    await request(ctx.app).get("/api/offers?currency=COP' OR 1=1--").expect(400);
    await request(ctx.app).get('/api/offers?limit=1000').expect(400);
    await request(ctx.app).get('/api/offers/abc').expect(404);
    await request(ctx.app).get('/api/offers/999999').expect(404);
  });

  it('lets only the owner edit, pause and close', async () => {
    const offer = await createSellOffer(alice.agent, { usdc: 10, min: 100, max: 1000 });
    await bob.agent.patch(`/api/offers/${offer.id}`).send({ status: 'paused' }).expect(403);
    await bob.agent.delete(`/api/offers/${offer.id}`).expect(403);

    await alice.agent.patch(`/api/offers/${offer.id}`).send({}).expect(400);
    await alice.agent.patch(`/api/offers/${offer.id}`).send({ min: 5000 }).expect(400); // min > max existente
    const paused = await alice.agent
      .patch(`/api/offers/${offer.id}`)
      .send({ status: 'paused', price: 4200 })
      .expect(200);
    expect(paused.body.offer).toMatchObject({ status: 'paused', price: 4200 });
    const market = (await request(ctx.app).get('/api/offers').expect(200)).body.offers;
    expect(market.some((o) => o.id === offer.id)).toBe(false);

    const mine = (await alice.agent.get('/api/offers/mine').expect(200)).body.offers;
    expect(mine.some((o) => o.id === offer.id && o.status === 'paused')).toBe(true);

    await alice.agent.delete(`/api/offers/${offer.id}`).expect(204);
    await alice.agent.patch(`/api/offers/${offer.id}`).send({ status: 'active' }).expect(409);
  });
});
