import { afterEach, describe, expect, it, vi } from 'vitest';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import {
  escrowContractIdFor,
  readEscrow,
  verifyEscrowClosed,
  verifyEscrowFunded,
  verifyInvocation,
} from '../../utils/escrow.js';
import { config } from '../../config.js';
import {
  classicEnvelope,
  createArgs,
  escrowScVal,
  invocationEnvelope,
  mockSorobanRpc,
  refundArgs,
  releaseArgs,
  successTx,
} from '../helpers/soroban.js';

const contractId = config.stellar.escrowContractId;
const tokenId = config.stellar.escrowTokenId;
const otherContract = StrKey.encodeContract(Buffer.alloc(32, 7));
const seller = Keypair.random().publicKey();
const buyer = Keypair.random().publicKey();
const tradeId = 17;
const amount = 105_000_000n; // 10.5 USDC
const hash = (c) => c.repeat(64);
const notBefore = new Date(Date.now() - 60_000);

const createTx = (over = {}) =>
  invocationEnvelope({
    contractId,
    fn: 'create',
    source: seller,
    args: createArgs({ seller, buyer, token: tokenId, amount, tradeId }),
    ...over,
  });
const fundedEscrow = (over = {}) =>
  escrowScVal({ seller, buyer, token: tokenId, amount, refundAfterLedger: 4242, tradeId, ...over });
const fundArgs = { txHash: hash('a'), contractId, tokenId, seller, buyer, tradeId, amount: '10.5', notBefore };

afterEach(() => vi.restoreAllMocks());

describe('escrowContractIdFor', () => {
  it("prefers the trade's own escrow_contract_id (survives a contract switch-over)", () => {
    expect(escrowContractIdFor({ escrow_contract_id: otherContract })).toBe(otherContract);
  });

  it('falls back to the configured ESCROW_CONTRACT_ID', () => {
    expect(escrowContractIdFor({ escrow_contract_id: null })).toBe(contractId);
    expect(escrowContractIdFor({})).toBe(contractId);
  });
});

describe('readEscrow', () => {
  it('decodes the on-chain Escrow struct', async () => {
    mockSorobanRpc({ escrow: fundedEscrow() });
    expect(await readEscrow({ contractId, seller, tradeId })).toEqual({
      seller,
      buyer,
      token: tokenId,
      amount,
      refundAfterLedger: 4242,
      status: 'funded',
    });
  });

  it('returns null when the contract reports NotFound (#2)', async () => {
    mockSorobanRpc({ escrow: null });
    expect(await readEscrow({ contractId, seller, tradeId })).toBeNull();
  });

  it('maps RPC failures and other simulation errors to 502', async () => {
    mockSorobanRpc({ escrow: new Error('ECONNRESET') });
    await expect(readEscrow({ contractId, seller, tradeId })).rejects.toMatchObject({ status: 502 });
    mockSorobanRpc({ escrow: 'HostError: Error(Budget, ExceededLimit)' });
    await expect(readEscrow({ contractId, seller, tradeId })).rejects.toMatchObject({ status: 502 });
  });
});

describe('verifyInvocation', () => {
  const base = { txHash: hash('b'), contractId, fn: 'create', seller, tradeId, notBefore };

  it('accepts a successful matching invocation', async () => {
    mockSorobanRpc({ txs: { [hash('b')]: successTx(createTx(), { ledger: 777 }) } });
    const out = await verifyInvocation(base);
    expect(out.ledger).toBe(777);
    expect(out.args[0]).toBe(seller);
  });

  it.each([
    ['unknown hash', {}, /no encontrada/],
    ['failed tx', { [hash('b')]: { status: 'FAILED' } }, /falló/],
  ])('rejects %s with 400', async (_n, txs, re) => {
    mockSorobanRpc({ txs });
    await expect(verifyInvocation(base)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(re) });
  });

  it('rejects transactions that do not invoke a contract', async () => {
    mockSorobanRpc({ txs: { [hash('b')]: successTx(classicEnvelope(seller)) } });
    await expect(verifyInvocation(base)).rejects.toThrow(/no invoca un contrato/);
  });

  it.each([
    ['another contract', { contractId: otherContract }],
    ['another function', { fn: 'release', args: releaseArgs({ seller, tradeId }) }],
    ['another seller', { args: createArgs({ seller: buyer, buyer, token: tokenId, amount, tradeId }) }],
    ['another trade id', { args: createArgs({ seller, buyer, token: tokenId, amount, tradeId: 18 }) }],
  ])('rejects an invocation for %s', async (_n, over) => {
    mockSorobanRpc({ txs: { [hash('b')]: successTx(createTx(over)) } });
    await expect(verifyInvocation(base)).rejects.toThrow(/no es un "create" del escrow/);
  });

  it('rejects transactions older than the trade (beyond clock skew)', async () => {
    const createdAt = Math.floor(notBefore.getTime() / 1000) - 600;
    mockSorobanRpc({ txs: { [hash('b')]: successTx(createTx(), { createdAt }) } });
    await expect(verifyInvocation(base)).rejects.toThrow(/anterior a la operación/);
  });

  it('maps RPC transport errors to 502', async () => {
    mockSorobanRpc({ getTxError: new Error('timeout') });
    await expect(verifyInvocation(base)).rejects.toMatchObject({ status: 502 });
  });
});

describe('verifyEscrowFunded', () => {
  it('returns refundAfterLedger when tx and on-chain state match', async () => {
    mockSorobanRpc({ txs: { [hash('a')]: successTx(createTx()) }, escrow: fundedEscrow() });
    expect(await verifyEscrowFunded(fundArgs)).toEqual({ refundAfterLedger: 4242 });
  });

  it('rejects a missing escrow', async () => {
    mockSorobanRpc({ txs: { [hash('a')]: successTx(createTx()) }, escrow: null });
    await expect(verifyEscrowFunded(fundArgs)).rejects.toThrow(/no existe on-chain/);
  });

  it('lists every mismatching field', async () => {
    mockSorobanRpc({
      txs: { [hash('a')]: successTx(createTx()) },
      escrow: fundedEscrow({ buyer: seller, token: otherContract, amount: 1n }),
    });
    await expect(verifyEscrowFunded(fundArgs)).rejects.toThrow(/comprador, token, monto/);
  });

  it('rejects an escrow that is no longer funded', async () => {
    mockSorobanRpc({ txs: { [hash('a')]: successTx(createTx()) }, escrow: fundedEscrow({ status: 'released' }) });
    await expect(verifyEscrowFunded(fundArgs)).rejects.toThrow(/ya no está fondeado/);
  });
});

describe('verifyEscrowClosed', () => {
  it('accepts a release when the escrow is released', async () => {
    const env = invocationEnvelope({
      contractId,
      fn: 'release',
      source: seller,
      args: releaseArgs({ seller, tradeId }),
    });
    mockSorobanRpc({ txs: { [hash('c')]: successTx(env) }, escrow: fundedEscrow({ status: 'released' }) });
    await expect(
      verifyEscrowClosed({ txHash: hash('c'), contractId, fn: 'release', seller, tradeId, notBefore })
    ).resolves.toMatchObject({ ledger: 500, args: [seller, BigInt(tradeId)] });
  });

  it('accepts a buyer refund (seller is the 2nd argument)', async () => {
    const env = invocationEnvelope({
      contractId,
      fn: 'refund',
      source: buyer,
      args: refundArgs({ caller: buyer, seller, tradeId }),
    });
    mockSorobanRpc({ txs: { [hash('d')]: successTx(env) }, escrow: fundedEscrow({ status: 'refunded' }) });
    await expect(
      verifyEscrowClosed({ txHash: hash('d'), contractId, fn: 'refund', seller, tradeId, notBefore })
    ).resolves.toMatchObject({ ledger: 500, args: [expect.any(String), seller, BigInt(tradeId)] });
  });

  it('rejects when on-chain state does not match the claimed outcome', async () => {
    const env = invocationEnvelope({
      contractId,
      fn: 'release',
      source: seller,
      args: releaseArgs({ seller, tradeId }),
    });
    mockSorobanRpc({ txs: { [hash('c')]: successTx(env) }, escrow: fundedEscrow({ status: 'funded' }) });
    await expect(
      verifyEscrowClosed({ txHash: hash('c'), contractId, fn: 'release', seller, tradeId, notBefore })
    ).rejects.toThrow(/no está liberado \(estado: funded\)/);
    mockSorobanRpc({ txs: { [hash('c')]: successTx(env) }, escrow: null });
    await expect(
      verifyEscrowClosed({ txHash: hash('c'), contractId, fn: 'release', seller, tradeId, notBefore })
    ).rejects.toThrow(/inexistente/);
  });
});
