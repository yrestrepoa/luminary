import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheUnavailableError, createCache } from '../../cache/index.js';
import { CacheRateLimitStore } from '../../cache/rateLimitStore.js';
import { createRevocationList } from '../../cache/revocations.js';

describe('memory cache', () => {
  let cache;
  beforeEach(() => {
    vi.useFakeTimers();
    cache = createCache('');
  });
  afterEach(async () => {
    await cache.close();
    vi.useRealTimers();
  });

  it('stores values with TTL', async () => {
    expect(cache.kind).toBe('memory');
    await cache.init();
    await cache.set('k', 1, 1000);
    expect(await cache.get('k')).toBe('1');
    expect(await cache.exists('k')).toBe(true);
    vi.advanceTimersByTime(1001);
    expect(await cache.get('k')).toBeNull();
    expect(await cache.exists('k')).toBe(false);
  });

  it('increments within a window and resets after it', async () => {
    expect(await cache.incr('c', 1000)).toEqual({ count: 1, ttlMs: 1000 });
    vi.advanceTimersByTime(400);
    expect(await cache.incr('c', 1000)).toEqual({ count: 2, ttlMs: 600 });
    await cache.decr('c');
    await cache.decr('c');
    await cache.decr('c'); // no baja de 0
    expect(await cache.get('c')).toBe('0');
    vi.advanceTimersByTime(601);
    expect((await cache.incr('c', 1000)).count).toBe(1);
  });

  it('deletes keys and answers ping', async () => {
    await cache.set('d', 'x', 1000);
    await cache.del('d');
    expect(await cache.get('d')).toBeNull();
    expect(await cache.ping()).toBe(true);
  });

  it('sweeps expired entries periodically', async () => {
    await cache.set('old', 'x', 10);
    vi.advanceTimersByTime(61_000); // barrido cada 60 s
    expect(await cache.exists('old')).toBe(false);
  });
});

describe('redis cache when Redis is unreachable', () => {
  it('fails closed with CacheUnavailableError and ping=false', async () => {
    const cache = createCache('redis://user:pw@127.0.0.1:1');
    expect(cache.kind).toBe('redis');
    await expect(cache.get('x')).rejects.toBeInstanceOf(CacheUnavailableError);
    await expect(cache.incr('x', 1000)).rejects.toMatchObject({ status: 503 });
    expect(await cache.ping()).toBe(false);
    await cache.close();
  });
});

describe('CacheRateLimitStore', () => {
  it('counts hits per key with a reset time and supports decrement/reset', async () => {
    const cache = createCache('');
    const store = new CacheRateLimitStore('rl:test:', cache);
    store.init({ windowMs: 60_000 });
    const a = await store.increment('1.2.3.4');
    const b = await store.increment('1.2.3.4');
    expect(a.totalHits).toBe(1);
    expect(b.totalHits).toBe(2);
    expect(b.resetTime.getTime()).toBeGreaterThan(Date.now());
    await store.decrement('1.2.3.4');
    expect((await store.increment('1.2.3.4')).totalHits).toBe(2);
    await store.resetKey('1.2.3.4');
    expect((await store.increment('1.2.3.4')).totalHits).toBe(1);
    expect(store.localKeys).toBe(false);
    await cache.close();
  });
});

describe('revocation list', () => {
  it('revokes a jti until the token expires', async () => {
    vi.useFakeTimers();
    const cache = createCache('');
    const list = createRevocationList(cache);
    const exp = Math.floor(Date.now() / 1000) + 60;
    await list.revoke('jti-1', exp);
    expect(await list.isRevoked('jti-1')).toBe(true);
    expect(await list.isRevoked('jti-2')).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(await list.isRevoked('jti-1')).toBe(false);
    await cache.close();
    vi.useRealTimers();
  });

  it('ignores already-expired tokens and missing jti', async () => {
    const cache = createCache('');
    const set = vi.spyOn(cache, 'set');
    const list = createRevocationList(cache);
    await list.revoke('old', Math.floor(Date.now() / 1000) - 1);
    await list.revoke(undefined, Math.floor(Date.now() / 1000) + 60);
    expect(set).not.toHaveBeenCalled();
    await cache.close();
  });
});
