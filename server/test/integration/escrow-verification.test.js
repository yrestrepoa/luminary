// Trades con verificación on-chain ACTIVADA contra un Soroban RPC simulado (XDR real).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSellOffer, describeIntegration, fakeHash, registerUser } from '../helpers/app.js';
import {
  createArgs,
  escrowScVal,
  invocationEnvelope,
  mockSorobanRpc,
  refundArgs,
  releaseArgs,
  successTx,
} from '../helpers/soroban.js';
import { config } from '../../config.js';

describeIntegration('escrow verification (mocked Soroban RPC)', (ctx) => {
  let seller, buyer, trade;
  const contractId = config.stellar.escrowContractId;
  const tokenId = config.stellar.escrowTokenId;

  beforeAll(async () => {
    config.stellar.verifyTx = true;
    seller = await registerUser(ctx.app, { name: 'Seller' });
    buyer = await registerUser(ctx.app, { name: 'Buyer' });
  });
  afterAll(() => {
    config.stellar.verifyTx = false;
    config.stellar.escrowContractId = contractId;
  });
  afterEach(() => vi.restoreAllMocks());

  const open = async (usdc = 2) => {
    const offer = await createSellOffer(seller.agent, { usdc: 10, price: 1 });
    return (await buyer.agent.post('/api/trades').send({ offerId: offer.id, usdcAmount: usdc }).expect(201)).body.trade;
  };
  const escrowFor = (t, over = {}) =>
    escrowScVal({
      seller: seller.user.stellarAddress,
      buyer: buyer.user.stellarAddress,
      token: tokenId,
      amount: BigInt(t.escrow.amountStroops),
      refundAfterLedger: 98765,
      tradeId: t.id,
      ...over,
    });
  const createEnv = (t, over = {}) =>
    invocationEnvelope({
      contractId,
      fn: 'create',
      source: seller.user.stellarAddress,
      args: createArgs({
        seller: seller.user.stellarAddress,
        buyer: buyer.user.stellarAddress,
        token: tokenId,
        amount: BigInt(t.escrow.amountStroops),
        tradeId: t.id,
      }),
      ...over,
    });

  it('funds only after verifying the create tx and the on-chain escrow', async () => {
    trade = await open();
    const hash = fakeHash();
    const rpc = mockSorobanRpc({ txs: { [hash]: successTx(createEnv(trade)) }, escrow: escrowFor(trade) });
    const res = await seller.agent.post(`/api/trades/${trade.id}/fund`).send({ txHash: hash }).expect(200);
    expect(res.body.trade).toMatchObject({
      status: 'funded',
      escrow: { contractId, fundTxHash: hash, refundAfterLedger: 98765 },
    });
    expect(rpc.getTransaction).toHaveBeenCalledWith(hash);
    expect(rpc.simulateTransaction).toHaveBeenCalledTimes(1);
  });

  it('rejects a create tx for another trade and leaves the trade pending', async () => {
    const t = await open();
    const hash = fakeHash();
    const wrong = createEnv(t, {
      args: createArgs({
        seller: seller.user.stellarAddress,
        buyer: buyer.user.stellarAddress,
        token: tokenId,
        amount: BigInt(t.escrow.amountStroops),
        tradeId: t.id + 1000,
      }),
    });
    mockSorobanRpc({ txs: { [hash]: successTx(wrong) }, escrow: escrowFor(t) });
    const res = await seller.agent.post(`/api/trades/${t.id}/fund`).send({ txHash: hash }).expect(400);
    expect(res.body.error).toMatch(/no es un "create"/);
    expect((await seller.agent.get(`/api/trades/${t.id}`).expect(200)).body.trade.status).toBe('pending');
  });

  it('rejects an on-chain amount mismatch', async () => {
    const t = await open();
    const hash = fakeHash();
    mockSorobanRpc({ txs: { [hash]: successTx(createEnv(t)) }, escrow: escrowFor(t, { amount: 1n }) });
    const res = await seller.agent.post(`/api/trades/${t.id}/fund`).send({ txHash: hash }).expect(400);
    expect(res.body.error).toMatch(/monto/);
  });

  it('returns 502 when Soroban RPC is unreachable', async () => {
    const t = await open();
    mockSorobanRpc({ getTxError: new Error('ECONNREFUSED') });
    const res = await seller.agent.post(`/api/trades/${t.id}/fund`).send({ txHash: fakeHash() }).expect(502);
    expect(res.body.error).toMatch(/Soroban RPC/);
  });

  it('returns 503 when the escrow contract is not configured', async () => {
    const t = await open();
    config.stellar.escrowContractId = null;
    try {
      await seller.agent.post(`/api/trades/${t.id}/fund`).send({ txHash: fakeHash() }).expect(503);
    } finally {
      config.stellar.escrowContractId = contractId;
    }
  });

  it('releases only when the release tx is verified and the escrow is released', async () => {
    await buyer.agent.post(`/api/trades/${trade.id}/paid`).expect(200);
    const hash = fakeHash();
    const env = invocationEnvelope({
      contractId,
      fn: 'release',
      source: seller.user.stellarAddress,
      args: releaseArgs({ seller: seller.user.stellarAddress, tradeId: trade.id }),
    });
    mockSorobanRpc({ txs: { [hash]: successTx(env) }, escrow: escrowFor(trade, { status: 'funded' }) });
    await seller.agent.post(`/api/trades/${trade.id}/release`).send({ txHash: hash }).expect(400);

    vi.restoreAllMocks();
    mockSorobanRpc({ txs: { [hash]: successTx(env) }, escrow: escrowFor(trade, { status: 'released' }) });
    const res = await seller.agent.post(`/api/trades/${trade.id}/release`).send({ txHash: hash }).expect(200);
    expect(res.body.trade).toMatchObject({ status: 'released', stellarTxHash: hash });
  });

  it('accepts a verified buyer refund and restores availability', async () => {
    const t = await open(3);
    const fundHash = fakeHash();
    mockSorobanRpc({ txs: { [fundHash]: successTx(createEnv(t)) }, escrow: escrowFor(t) });
    await seller.agent.post(`/api/trades/${t.id}/fund`).send({ txHash: fundHash }).expect(200);
    vi.restoreAllMocks();

    const hash = fakeHash();
    const env = invocationEnvelope({
      contractId,
      fn: 'refund',
      source: buyer.user.stellarAddress,
      args: refundArgs({ caller: buyer.user.stellarAddress, seller: seller.user.stellarAddress, tradeId: t.id }),
    });
    mockSorobanRpc({ txs: { [hash]: successTx(env) }, escrow: escrowFor(t, { status: 'refunded' }) });
    const res = await buyer.agent.post(`/api/trades/${t.id}/refund`).send({ txHash: hash }).expect(200);
    expect(res.body.trade.status).toBe('refunded');
    const offer = (await buyer.agent.get(`/api/offers/${t.offerId}`).expect(200)).body.offer;
    expect(offer.available).toBe(10);
  });

  describe('disputed trades (audit I1)', () => {
    const disputed = async () => {
      const t = await open(1);
      const fundHash = fakeHash();
      mockSorobanRpc({ txs: { [fundHash]: successTx(createEnv(t)) }, escrow: escrowFor(t) });
      await seller.agent.post(`/api/trades/${t.id}/fund`).send({ txHash: fundHash }).expect(200);
      vi.restoreAllMocks();
      await buyer.agent.post(`/api/trades/${t.id}/paid`).expect(200);
      await buyer.agent.post(`/api/trades/${t.id}/dispute`).expect(200);
      return t;
    };
    const refundBy = (t, caller, ledger) => {
      const hash = fakeHash();
      const env = invocationEnvelope({
        contractId,
        fn: 'refund',
        source: caller,
        args: refundArgs({ caller, seller: seller.user.stellarAddress, tradeId: t.id }),
      });
      mockSorobanRpc({ txs: { [hash]: successTx(env, { ledger }) }, escrow: escrowFor(t, { status: 'refunded' }) });
      return hash;
    };

    it('rejects a seller refund executed before refund_after_ledger', async () => {
      const t = await disputed();
      const hash = refundBy(t, seller.user.stellarAddress, 98764); // refundAfterLedger = 98765
      const res = await seller.agent.post(`/api/trades/${t.id}/refund`).send({ txHash: hash }).expect(409);
      expect(res.body.error).toMatch(/plazo del contrato/);
    });

    it('accepts a seller refund executed at/after refund_after_ledger', async () => {
      const t = await disputed();
      const hash = refundBy(t, seller.user.stellarAddress, 98765);
      const res = await seller.agent.post(`/api/trades/${t.id}/refund`).send({ txHash: hash }).expect(200);
      expect(res.body.trade.status).toBe('refunded');
    });

    it('accepts an early refund made on-chain by the buyer, whoever reports it', async () => {
      const t = await disputed();
      const hash = refundBy(t, buyer.user.stellarAddress, 600);
      const res = await seller.agent.post(`/api/trades/${t.id}/refund`).send({ txHash: hash }).expect(200);
      expect(res.body.trade.status).toBe('refunded');
    });
  });
});
