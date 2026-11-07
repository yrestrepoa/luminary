import { expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describeIntegration, registerUser } from '../helpers/app.js';
import { config } from '../../config.js';
import { CacheUnavailableError } from '../../cache/index.js';

const cookieOf = (res) => res.headers['set-cookie']?.find((c) => c.startsWith(`${config.cookieName}=`));

describeIntegration('auth', (ctx) => {
  it('registers with a hardened session cookie and never returns the hash', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/register')
      .send({ email: '  Ana+Test@Example.COM ', password: 'supersecret1', displayName: 'Ana' })
      .expect(201);
    expect(res.body.user).toMatchObject({ email: 'ana+test@example.com', displayName: 'Ana', stellarAddress: null });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    const cookie = cookieOf(res);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\//);
    const { rows } = await ctx.pool.query("SELECT password_hash FROM users WHERE email = 'ana+test@example.com'");
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$12\$/); // bcrypt, 12 rounds
  });

  it('rejects duplicate emails case-insensitively and invalid input', async () => {
    await request(ctx.app)
      .post('/api/auth/register')
      .send({ email: 'ANA+test@example.com', password: 'supersecret1', displayName: 'Dup' })
      .expect(409);
    const bad = await request(ctx.app)
      .post('/api/auth/register')
      .send({ email: 'x', password: 'short', displayName: 'A' })
      .expect(400);
    expect(Object.keys(bad.body.details).sort()).toEqual(['displayName', 'email', 'password']);
    const long = await request(ctx.app)
      .post('/api/auth/register')
      .send({ email: 'u@example.com', password: 'ñ'.repeat(40), displayName: 'Multi' })
      .expect(400);
    expect(long.body.details.password).toMatch(/72 bytes/);
  });

  it('logs in, reads /me and logs out', async () => {
    const { agent, email, password } = await registerUser(ctx.app, { name: 'Bea', address: false });
    await agent.post('/api/auth/logout').expect(204);
    await agent.get('/api/auth/me').expect(401);
    await agent.post('/api/auth/login').send({ email: email.toUpperCase(), password: 'wrong-password' }).expect(401);
    await agent.post('/api/auth/login').send({ email: email.toUpperCase(), password }).expect(200);
    expect((await agent.get('/api/auth/me').expect(200)).body.user.displayName).toBe('Bea');
  });

  it('revokes the token server-side on logout (replayed cookie → 401)', async () => {
    const res = await request(ctx.app)
      .post('/api/auth/register')
      .send({ email: 'replay@example.com', password: 'supersecret1', displayName: 'Rep' })
      .expect(201);
    const cookie = cookieOf(res).split(';')[0];
    await request(ctx.app).get('/api/auth/me').set('Cookie', cookie).expect(200);
    const out = await request(ctx.app).post('/api/auth/logout').set('Cookie', cookie).expect(204);
    expect(cookieOf(out)).toMatch(/Expires=Thu, 01 Jan 1970/);
    await request(ctx.app).get('/api/auth/me').set('Cookie', cookie).expect(401);
    await request(ctx.app)
      .post('/api/offers')
      .set('Cookie', cookie)
      .send({ type: 'sell', currency: 'COP', price: 1, usdcAmount: 1, paymentMethod: 'Nequi' })
      .expect(401);
  });

  it('rejects tokens without jti, with bad subject, forged or for deleted users', async () => {
    const sign = (payload, secret = config.jwt.secret) => `${config.cookieName}=${jwt.sign(payload, secret)}`;
    const { user } = await registerUser(ctx.app, { address: false });
    for (const cookie of [
      sign({ sub: String(user.id) }), // sin jti (pre-revocación)
      sign({ sub: 'abc', jti: 'x' }),
      sign({ sub: String(user.id), jti: 'x' }, 'forged-secret-forged-secret-forged-secret'),
      sign({ sub: '999999', jti: 'x' }),
    ]) {
      const res = await request(ctx.app).get('/api/auth/me').set('Cookie', cookie).expect(401);
      expect(cookieOf(res)).toMatch(/Expires=Thu, 01 Jan 1970/); // limpia la cookie inválida
    }
    await request(ctx.app)
      .get('/api/auth/me')
      .set('Cookie', sign({ sub: String(user.id), jti: 'fresh' }))
      .expect(200);
  });

  it('fails closed with 503 when the revocation store is down', async () => {
    const { agent } = await registerUser(ctx.app, { address: false });
    const spy = vi.spyOn(ctx.cache, 'exists').mockRejectedValue(new CacheUnavailableError(new Error('down')));
    const res = await agent.get('/api/auth/me').expect(503);
    expect(res.body.error).toMatch(/temporalmente no disponible/);
    spy.mockRestore();
  });

  it('rate-limits failed logins per client IP (10 per 15 min); successful logins do not count', async () => {
    const { email, password } = await registerUser(ctx.app, { address: false });
    // Desde loopback (proxy de confianza por defecto) se respeta X-Forwarded-For: cada "cliente" tiene su cupo.
    const login = (ip, pw, as = email) =>
      request(ctx.app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ email: as, password: pw });
    for (let i = 0; i < 3; i++) await login('203.0.113.7', password).expect(200);
    // Fallos contra cuentas distintas: solo cuenta el límite por IP (el de cuenta se prueba en rate-limit.test.js).
    for (let i = 0; i < 10; i++) await login('203.0.113.7', 'nope-nope', `ghost${i}@example.com`).expect(401);
    const limited = await login('203.0.113.7', password).expect(429);
    expect(limited.body.error).toMatch(/Demasiados intentos/);
    expect(limited.headers.ratelimit).toBeDefined();
    await login('198.51.100.9', password).expect(200); // otro cliente no está limitado
  });
});
