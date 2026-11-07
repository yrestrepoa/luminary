import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { cookieOptions, signToken, tokenPayload } from '../../middleware/auth.js';
import { config } from '../../config.js';

const req = (token) => ({ cookies: token === undefined ? {} : { [config.cookieName]: token } });

describe('JWT session tokens', () => {
  it('signs HS256 tokens with subject, random jti and 7-day expiry', () => {
    const a = tokenPayload(req(signToken(42)));
    const b = tokenPayload(req(signToken(42)));
    expect(a.sub).toBe('42');
    expect(a.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.jti).not.toBe(b.jti);
    expect(a.exp - a.iat).toBe(7 * 24 * 3600);
  });

  it('rejects missing, tampered, foreign-key, expired and alg=none tokens', () => {
    expect(tokenPayload(req())).toBeNull();
    const good = signToken(1);
    expect(tokenPayload(req(good.slice(0, -2) + 'xx'))).toBeNull();
    expect(tokenPayload(req(jwt.sign({ sub: '1' }, 'another-secret-another-secret-123456')))).toBeNull();
    const expired = jwt.sign({ sub: '1', exp: Math.floor(Date.now() / 1000) - 10 }, config.jwt.secret);
    expect(tokenPayload(req(expired))).toBeNull();
    const none = jwt.sign({ sub: '1' }, null, { algorithm: 'none' });
    expect(tokenPayload(req(none))).toBeNull();
  });

  it('uses httpOnly + SameSite=Strict cookies (Secure in production)', () => {
    expect(cookieOptions()).toEqual({ httpOnly: true, sameSite: 'strict', secure: false, path: '/' });
  });
});
