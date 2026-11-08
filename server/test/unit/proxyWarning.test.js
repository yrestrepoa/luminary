import { describe, expect, it, vi } from 'vitest';
import { forwardedForWarning } from '../../middleware/proxyWarning.js';

const req = (headers = {}) => ({ headers, socket: { remoteAddress: '10.0.0.7' } });

describe('forwardedForWarning', () => {
  it('warns once, on the first request that carries X-Forwarded-For', () => {
    const logger = { warn: vi.fn() };
    const mw = forwardedForWarning(logger);
    const next = vi.fn();

    mw(req(), {}, next);
    expect(logger.warn).not.toHaveBeenCalled();

    mw(req({ 'x-forwarded-for': '203.0.113.9' }), {}, next);
    mw(req({ 'x-forwarded-for': '198.51.100.1' }), {}, next);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith({ socketIp: '10.0.0.7' }, expect.stringMatching(/TRUST_PROXY=1/));
    expect(next).toHaveBeenCalledTimes(3);
  });
});
