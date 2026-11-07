// Flujo de trades con VERIFY_STELLAR_TX=false (hashes ficticios). La verificación on-chain
// se prueba en escrow-verification.test.js con un Soroban RPC simulado.
import { beforeAll, expect, it } from 'vitest';
import { createSellOffer, describeIntegration, fakeHash, registerUser } from '../helpers/app.js';

describeIntegration('trades', (ctx) => {
  let seller, buyer, outsider, noAddress;
  const available = async (id) => (await buyer.agent.get(`/api/offers/${id}`).expect(200)).body.offer.available;

  beforeAll(async () => {
    seller = await registerUser(ctx.app, { name: 'Seller' });
    buyer = await registerUser(ctx.app, { name: 'Buyer' });
    outsider = await registerUser(ctx.app, { name: 'Outsider' });
    noAddress = await registerUser(ctx.app, { name: 'NoAddr', address: false });
  });

  it('opens a trade, freezing price and decrementing availability in NUMERIC', async () => {
    const offer = await createSellOffer(seller.agent, { usdc: 100, price: 4100.5, min: 10_000, max: 1_000_000 });
    const res = await buyer.agent.post('/api/trades').send({ offerId: offer.id, usdcAmount: 10.5 }).expect(201);
    expect(res.body.trade).toMatchObject({
      status: 'pending',
      usdcAmount: 10.5,
      price: 4100.5,
      fiatAmount: 43055.25,
      buyer: { id: buyer.user.id },
      seller: { id: seller.user.id },
      escrow: { amountStroops: '105000000', tradeId: String(res.body.trade.id), fundTxHash: null },
    });
    expect(await available(offer.id)).toBe(89.5);
  });

  it('enforces offer rules when opening', async () => {
    const offer = await createSellOffer(seller.agent, { usdc: 20, price: 4000, min: 10_000, max: 60_000 });
    await seller.agent.post('/api/trades').send({ offerId: offer.id, usdcAmount: 5 }).expect(400); // propia
    await noAddress.agent.post('/api/trades').send({ offerId: offer.id, usdcAmount: 5 }).expect(400); // sin dirección
    await buyer.agent.post('/api/trades').send({ offerId: offer.id, usdcAmount: 1 }).expect(400); // < min fiat
    await buyer.agent.post('/api/trades').send({ offerId: offer.id, usdcAmount: 16 }).expect(400); // > max fiat
    await buyer.agent.post('/api/trades').send({ offerId: offer.id, usdcAmount: 25 }).expect(400); // > disponible
    await buyer.agent.post('/api/trades').send({ offerId: 999999, usdcAmount: 5 }).expect(404);
    await seller.agent.patch(`/api/offers/${offer.id}`).send({ status: 'paused' }).expect(200);
    await buyer.agent.post('/api/trades').send({ offerId: offer.id, usdcAmount: 5 }).expect(409);
  });

  it('never oversells under concurrent takes (row lock + conditional update)', async () => {
    const offer = await createSellOffer(seller.agent, { usdc: 10, price: 1 });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => buyer.agent.post('/api/trades').send({ offerId: offer.id, usdcAmount: 3 }))
    );
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(3);
    expect(results.filter((r) => r.status === 400)).toHaveLength(2);
    expect(await available(offer.id)).toBe(1);
  });

  it('runs the happy path: fund → paid → release, with role checks', async () => {
    const offer = await createSellOffer(seller.agent, { usdc: 50, price: 1 });
    const t = (await buyer.agent.post('/api/trades').send({ offerId: offer.id, usdcAmount: 5 }).expect(201)).body.trade;

    await buyer.agent.post(`/api/trades/${t.id}/paid`).expect(409); // aún sin escrow
    await buyer.agent.post(`/api/trades/${t.id}/fund`).send({ txHash: fakeHash() }).expect(403);
    await seller.agent.post(`/api/trades/${t.id}/fund`).send({ txHash: 'nothex' }).expect(400);
    const fundHash = fakeHash();
    const funded = await seller.agent.post(`/api/trades/${t.id}/fund`).send({ txHash: fundHash }).expect(200);
    expect(funded.body.trade).toMatchObject({
      status: 'funded',
      escrow: { fundTxHash: fundHash, seller: seller.user.stellarAddress, buyer: buyer.user.stellarAddress },
    });
    await seller.agent.post(`/api/trades/${t.id}/fund`).send({ txHash: fakeHash() }).expect(409);
    await seller.agent.post(`/api/trades/${t.id}/cancel`).expect(409); // USDC en escrow

    await seller.agent.post(`/api/trades/${t.id}/paid`).expect(403);
    expect((await buyer.agent.post(`/api/trades/${t.id}/paid`).expect(200)).body.trade.status).toBe('paid');
    await buyer.agent.post(`/api/trades/${t.id}/release`).send({ txHash: fakeHash() }).expect(403);
    const closeHash = fakeHash();
    const released = await seller.agent.post(`/api/trades/${t.id}/release`).send({ txHash: closeHash }).expect(200);
    expect(released.body.trade).toMatchObject({ status: 'released', stellarTxHash: closeHash });

    await seller.agent.post(`/api/trades/${t.id}/cancel`).expect(409);
    await buyer.agent.post(`/api/trades/${t.id}/refund`).send({ txHash: fakeHash() }).expect(409);
    expect(
      (await seller.agent.get('/api/offers/mine').expect(200)).body.offers.find((o) => o.id === offer.id).trades
    ).toBe(1);
  });

  it('refund and cancel return the USDC to the offer', async () => {
    const offer = await createSellOffer(seller.agent, { usdc: 30, price: 1 });
    const t1 = (await buyer.agent.post('/api/trades').send({ offerId: offer.id, usdcAmount: 10 }).expect(201)).body
      .trade;
    await buyer.agent.post(`/api/trades/${t1.id}/refund`).send({ txHash: fakeHash() }).expect(409); // sin escrow
    await seller.agent.post(`/api/trades/${t1.id}/fund`).send({ txHash: fakeHash() }).expect(200);
    const refunded = await buyer.agent.post(`/api/trades/${t1.id}/refund`).send({ txHash: fakeHash() }).expect(200);
    expect(refunded.body.trade.status).toBe('refunded');
    expect(await available(offer.id)).toBe(30);

    const t2 = (await buyer.agent.post('/api/trades').send({ offerId: offer.id, usdcAmount: 7 }).expect(201)).body
      .trade;
    expect(await available(offer.id)).toBe(23);
    expect((await seller.agent.post(`/api/trades/${t2.id}/cancel`).expect(200)).body.trade.status).toBe('cancelled');
    expect(await available(offer.id)).toBe(30);
  });

  it('rejects reusing a transaction hash across trades', async () => {
    const offer = await createSellOffer(seller.agent, { usdc: 30, price: 1 });
    const hash = fakeHash();
    const a = (await buyer.agent.post('/api/trades').send({ offerId: offer.id, usdcAmount: 1 }).expect(201)).body.trade;
    const b = (await buyer.agent.post('/api/trades').send({ offerId: offer.id, usdcAmount: 1 }).expect(201)).body.trade;
    await seller.agent.post(`/api/trades/${a.id}/fund`).send({ txHash: hash }).expect(200);
    const dup = await seller.agent.post(`/api/trades/${b.id}/fund`).send({ txHash: hash }).expect(409);
    expect(dup.body.error).toMatch(/hash ya fue registrado/);
  });

  it('allows a dispute only after payment', async () => {
    const offer = await createSellOffer(seller.agent, { usdc: 5, price: 1 });
    const t = (await buyer.agent.post('/api/trades').send({ offerId: offer.id, usdcAmount: 1 }).expect(201)).body.trade;
    await buyer.agent.post(`/api/trades/${t.id}/dispute`).expect(409);
    await seller.agent.post(`/api/trades/${t.id}/fund`).send({ txHash: fakeHash() }).expect(200);
    await buyer.agent.post(`/api/trades/${t.id}/paid`).expect(200);
    expect((await seller.agent.post(`/api/trades/${t.id}/dispute`).expect(200)).body.trade.status).toBe('disputed');
    // Desde disputa, el escrow aún se puede cerrar on-chain.
    expect(
      (await buyer.agent.post(`/api/trades/${t.id}/refund`).send({ txHash: fakeHash() }).expect(200)).body.trade.status
    ).toBe('refunded');
  });

  it('blocks the seller refund of a disputed trade until the contract timeout (audit I1)', async () => {
    const offer = await createSellOffer(seller.agent, { usdc: 5, price: 1 });
    const t = (await buyer.agent.post('/api/trades').send({ offerId: offer.id, usdcAmount: 2 }).expect(201)).body.trade;
    const funded = (await seller.agent.post(`/api/trades/${t.id}/fund`).send({ txHash: fakeHash() }).expect(200)).body
      .trade;
    expect(funded.fundedAt).toBeTruthy();
    await buyer.agent.post(`/api/trades/${t.id}/paid`).expect(200);
    await buyer.agent.post(`/api/trades/${t.id}/dispute`).expect(200);

    const early = await seller.agent.post(`/api/trades/${t.id}/refund`).send({ txHash: fakeHash() }).expect(409);
    expect(early.body.error).toMatch(/plazo del contrato/);
    expect((await seller.agent.get(`/api/trades/${t.id}`).expect(200)).body.trade.status).toBe('disputed');

    // Vencido el plazo (~24 h desde el depósito) el vendedor ya puede reembolsarse, como on-chain.
    await ctx.pool.query("UPDATE trades SET funded_at = now() - interval '25 hours' WHERE id = $1", [t.id]);
    const late = await seller.agent.post(`/api/trades/${t.id}/refund`).send({ txHash: fakeHash() }).expect(200);
    expect(late.body.trade.status).toBe('refunded');
    expect(await available(offer.id)).toBe(5);
  });

  it("hides other users' trades and filters by status", async () => {
    const list = (await buyer.agent.get('/api/trades').expect(200)).body.trades;
    expect(list.length).toBeGreaterThan(0);
    await outsider.agent.get(`/api/trades/${list[0].id}`).expect(404);
    expect((await outsider.agent.get('/api/trades').expect(200)).body.trades).toEqual([]);
    const refunded = (await buyer.agent.get('/api/trades?status=refunded').expect(200)).body.trades;
    expect(refunded.length).toBeGreaterThan(0);
    expect(refunded.every((t) => t.status === 'refunded')).toBe(true);
    await buyer.agent.get('/api/trades?status=bogus').expect(400);
  });
});
