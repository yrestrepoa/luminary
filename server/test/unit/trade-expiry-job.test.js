import { afterEach, describe, expect, it, vi } from 'vitest';
import { startTradeExpiryJob } from '../../jobs/tradeExpiry.js';

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
