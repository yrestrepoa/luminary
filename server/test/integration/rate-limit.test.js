// Audit M1: el rate limit de login no debe poder saltarse falseando X-Forwarded-For.
// Dos límites independientes (fallos por IP y por cuenta) y TRUST_PROXY validado.
import { afterAll, beforeAll, expect, it } from 'vitest';
import request from 'supertest';
import { describeIntegration, registerUser } from '../helpers/app.js';
import { LOGIN_LIMIT_PER_ACCOUNT, LOGIN_LIMIT_PER_IP, accountKey } from '../../routes/auth.js';

const LOOPBACK_KEYS = ['127.0.0.1', '::ffff:127.0.0.1', '::1'].map((ip) => `rl:login:${ip}`);
let ipSeq = 0;
/** IP de documentación (RFC 5737) distinta en cada llamada: simula un atacante que rota XFF. */
const nextIp = () => `198.51.${100 + (++ipSeq >> 8)}.${ipSeq & 255}`;

describeIntegration('login rate limits (audit M1)', (ctx) => {
  let victim, other;
  const resetLoopback = () => Promise.all(LOOPBACK_KEYS.map((k) => ctx.cache.del(k)));

  beforeAll(async () => {
    victim = await registerUser(ctx.app, { name: 'Victim', address: false });
    other = await registerUser(ctx.app, { name: 'Other', address: false });
  });
  afterAll(resetLoopback);

  const login = (app, { email, password, xff }) => {
    const req = request(app).post('/api/auth/login');
    if (xff) req.set('X-Forwarded-For', xff);
    return req.send({ email, password });
  };

  it('locks one account after N failures even when every request spoofs a new X-Forwarded-For', async () => {
    // Variantes de mayúsculas/espacios: el límite es por email normalizado.
    const variants = (i) => (i % 2 ? victim.email.toUpperCase() : ` ${victim.email} `);
    for (let i = 0; i < LOGIN_LIMIT_PER_ACCOUNT; i++) {
      await login(ctx.app, { email: variants(i), password: 'wrong-guess', xff: nextIp() }).expect(401);
    }
    // Ni con otra IP ni con la contraseña correcta: la cuenta está limitada durante la ventana.
    const limited = await login(ctx.app, { email: victim.email, password: 'wrong-guess', xff: nextIp() }).expect(429);
    expect(limited.body.error).toMatch(/Demasiados intentos/);
    await login(ctx.app, { email: victim.email, password: victim.password, xff: nextIp() }).expect(429);
    // Otras cuentas no se ven afectadas.
    await login(ctx.app, { email: other.email, password: other.password, xff: nextIp() }).expect(200);
  });

  it('keys the account limiter on a hash of the normalised email (no PII in the store)', () => {
    expect(accountKey({ email: ' Ana@Example.COM ' })).toBe(accountKey({ email: 'ana@example.com' }));
    expect(accountKey({ email: 'ana@example.com' })).toMatch(/^[0-9a-f]{64}$/);
    expect(accountKey({})).toBeNull();
    expect(accountKey({ email: 42 })).toBeNull();
    expect(accountKey({ email: 'x'.repeat(300) })).toBeNull();
  });

  it('with TRUST_PROXY=false (production default) a rotating X-Forwarded-For is ignored', async () => {
    await resetLoopback();
    const { createApp } = await import('../../app.js');
    const app = createApp({ trustProxy: false });
    // Fallos contra cuentas distintas (no toca el límite por cuenta) y XFF distinto cada vez.
    for (let i = 0; i < LOGIN_LIMIT_PER_IP; i++) {
      await login(app, { email: `nobody${i}@example.com`, password: 'x', xff: nextIp() }).expect(401);
    }
    await login(app, { email: other.email, password: other.password, xff: nextIp() }).expect(429);
    await resetLoopback();
  });

  it('with TRUST_PROXY=1 only the hop appended by the proxy counts, not client-supplied entries', async () => {
    const { createApp } = await import('../../app.js');
    const app = createApp({ trustProxy: 1 });
    const realClient = nextIp();
    // El cliente antepone valores falsos; el proxy de confianza añade la IP real al final.
    for (let i = 0; i < LOGIN_LIMIT_PER_IP; i++) {
      await login(app, {
        email: `ghost${i}@example.com`,
        password: 'x',
        xff: `${nextIp()}, ${nextIp()}, ${realClient}`,
      }).expect(401);
    }
    await login(app, { email: other.email, password: other.password, xff: `${nextIp()}, ${realClient}` }).expect(429);
    // Otro cliente real (otro último salto) sigue pudiendo entrar.
    await login(app, { email: other.email, password: other.password, xff: `${realClient}, ${nextIp()}` }).expect(200);
  });
});
