import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, requestId, serializeError } from '../../logger.js';

function capture() {
  const lines = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  return { lines, log: createLogger({ level: 'info', destination: stream }) };
}

describe('logger', () => {
  it('emits JSON with level label, ISO time and service', () => {
    const { lines, log } = capture();
    log.info({ a: 1 }, 'hello');
    expect(lines[0]).toMatchObject({ level: 'info', service: 'luminary-api', a: 1, msg: 'hello' });
    expect(new Date(lines[0].time).toISOString()).toBe(lines[0].time);
  });

  it('redacts secrets and credentials', () => {
    const { lines, log } = capture();
    log.info({
      password: 'hunter2',
      user: { password_hash: '$2b$...', token: 'jwt', email: 'kept@example.com' },
      req: { headers: { cookie: 'luminary_token=abc', authorization: 'Bearer x' } },
      res: { headers: { 'set-cookie': 'luminary_token=abc' } },
    });
    const out = JSON.stringify(lines[0]);
    for (const secret of ['hunter2', '$2b$', 'luminary_token=abc', 'Bearer x', '"jwt"']) {
      expect(out).not.toContain(secret);
    }
    expect(lines[0].password).toBe('[redacted]');
  });

  it('serializes errors without arbitrary properties (pg `detail` may hold PII)', () => {
    const err = Object.assign(new Error('duplicate key'), { code: '23505', detail: 'Key (email)=(ana@x.co)' });
    const s = serializeError(err);
    expect(s).toMatchObject({ type: 'Error', message: 'duplicate key', code: '23505' });
    expect(s.stack).toBeTypeOf('string');
    expect(JSON.stringify(s)).not.toContain('ana@x.co');
    expect(serializeError(new Error('outer', { cause: new Error('inner') })).cause.message).toBe('inner');
    expect(serializeError('plain')).toEqual({ message: 'plain' });
  });
});

describe('requestId', () => {
  const res = () => {
    const headers = {};
    return { headers, setHeader: (k, v) => (headers[k] = v) };
  };

  it('reuses a safe incoming X-Request-Id', () => {
    const r = res();
    expect(requestId({ headers: { 'x-request-id': 'abc-123.def' } }, r)).toBe('abc-123.def');
    expect(r.headers['X-Request-Id']).toBe('abc-123.def');
  });

  it('replaces unsafe or missing ids with a UUID', () => {
    for (const incoming of [undefined, 'bad id with spaces', 'x'.repeat(65), '<script>']) {
      const r = res();
      const id = requestId({ headers: { 'x-request-id': incoming } }, r);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(r.headers['X-Request-Id']).toBe(id);
    }
  });
});
