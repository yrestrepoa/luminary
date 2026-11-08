import { afterEach, describe, expect, it, vi } from 'vitest';
import { Address, Keypair, StrKey } from '@stellar/stellar-sdk';
import { config } from '../../config.js';
import { defaultFundedOnChain, startTradeExpiryJob } from '../../jobs/tradeExpiry.js';
import { escrowScVal, mockSorobanRpc } from '../helpers/soroban.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('startTradeExpiryJob', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('runs periodically, never overlaps rounds and waits for the current one on stop', async () => {
    vi.useFakeTimers();
    let release;
    const run = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const job = startTradeExpiryJob({ intervalMs: 1000, ttlMs: 60_000, logger, run });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1); // la ronda sigue en curso: no se lanza otra
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);

    let stopped = false;
    const stopping = job.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false); // espera a la ronda en curso
    release();
    await stopping;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('logs failures and keeps running', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue([]);
    const job = startTradeExpiryJob({ intervalMs: 1000, ttlMs: 60_000, logger, run });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(logger.error).toHaveBeenCalledWith(expect.anything(), '[trades] pending-trade expiry failed');
    expect(run.mock.calls.length).toBeGreaterThan(2);
    await job.stop();
  });

  it('does nothing when the TTL is 0', async () => {
    const run = vi.fn();
    const job = startTradeExpiryJob({ intervalMs: 1000, ttlMs: 0, logger, run });
    await job.stop();
    expect(run).not.toHaveBeenCalled();
  });
});

describe('defaultFundedOnChain', () => {
  const seller = Keypair.random().publicKey();
  const buyer = Keypair.random().publicKey();
  const oldContract = StrKey.encodeContract(Buffer.alloc(32, 9));
  const tokenContract = StrKey.encodeContract(Buffer.alloc(32, 3));
  const verifyTx = config.stellar.verifyTx;
  const simulatedContract = (simulateTransaction) => {
    const [tx] = simulateTransaction.mock.calls[0];
    return Address.fromScAddress(tx.operations[0].func.invokeContract.contractAddress).toString();
  };

  afterEach(() => {
    config.stellar.verifyTx = verifyTx;
    vi.restoreAllMocks();
  });

  it("checks the trade's own escrow_contract_id when it has one", async () => {
    config.stellar.verifyTx = true;
    const escrow = escrowScVal({ seller, buyer, token: tokenContract, amount: 1n, tradeId: 5 });
    const { simulateTransaction } = mockSorobanRpc({ escrow });
    const trade = { id: 5, seller_address: seller, escrow_contract_id: oldContract };
    expect(await defaultFundedOnChain(trade)).toBe(true);
    expect(simulatedContract(simulateTransaction)).toBe(oldContract);
  });

  it('falls back to the configured contract and reports a missing escrow', async () => {
    config.stellar.verifyTx = true;
    const { simulateTransaction } = mockSorobanRpc({ escrow: null });
    expect(await defaultFundedOnChain({ id: 5, seller_address: seller, escrow_contract_id: null })).toBe(false);
    expect(simulatedContract(simulateTransaction)).toBe(config.stellar.escrowContractId);
  });

  it('does not query the chain when verification is off', async () => {
    config.stellar.verifyTx = false;
    const { simulateTransaction } = mockSorobanRpc({ escrow: null });
    expect(await defaultFundedOnChain({ id: 5, seller_address: seller, escrow_contract_id: oldContract })).toBe(false);
    expect(simulateTransaction).not.toHaveBeenCalled();
  });
});
