import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { describeIntegration } from '../helpers/app.js';
import { lifecycle } from '../../lifecycle.js';

describeIntegration('HTTP layer', (ctx) => {
  afterEach(() => {
    vi.restoreAllMocks();
    lifecycle.shuttingDown = false;
  });

  it('liveness does not touch dependencies', async () => {
    const spy = vi.spyOn(ctx.pool, 'query');
    const res = await request(ctx.app).get('/api/health/live').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('readiness reports db and cache', async () => {
    const res = await request(ctx.app).get('/api/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok', cache: process.env.TEST_REDIS_URL ? 'redis' : 'memory' });
    await request(ctx.app).get('/api/health').expect(200); // alias compatible
  });

  it('readiness is 503 when the database fails or while shutting down', async () => {
    vi.spyOn(ctx.pool, 'query').mockRejectedValueOnce(new Error('db down'));
    const res = await request(ctx.app).get('/api/health/ready').expect(503);
    expect(res.body).toMatchObject({ status: 'degraded', db: 'unavailable' });

    lifecycle.shuttingDown = true;
    expect((await request(ctx.app).get('/api/health/ready').expect(503)).body.status).toBe('shutting_down');
    await request(ctx.app).get('/api/health/live').expect(200);
  });

  it('readiness is 503 when the cache is unavailable', async () => {
    vi.spyOn(ctx.cache, 'ping').mockResolvedValueOnce(false);
    expect((await request(ctx.app).get('/api/health/ready').expect(503)).body.cache).toBe('unavailable');
  });

  it('sets security headers and a request id', async () => {
    const res = await request(ctx.app).get('/api/health/live');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain('connect-src');
    const echoed = await request(ctx.app).get('/api/health/live').set('X-Request-Id', 'edge-abc-1');
    expect(echoed.headers['x-request-id']).toBe('edge-abc-1');
  });

  it('returns JSON 404 for unknown API routes', async () => {
    expect((await request(ctx.app).get('/api/nope').expect(404)).body).toEqual({ error: 'Ruta no encontrada' });
  });

  it('rejects non-JSON mutations (415), malformed JSON (400) and oversized bodies (413)', async () => {
    await request(ctx.app).post('/api/auth/login').type('form').send('email=a&password=b').expect(415);
    const bad = await request(ctx.app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad');
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: 'JSON inválido' });
    const big = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'a@b.co', password: 'x'.repeat(30_000) });
    expect(big.status).toBe(413);
  });

  it('blocks cross-origin mutations but allows same-origin and originless clients', async () => {
    const evil = await request(ctx.app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'a@b.co', password: 'x' });
    expect(evil.status).toBe(403);
    expect(evil.body).toEqual({ error: 'Origen no permitido' });

    const agent = request(ctx.app);
    const same = await agent.post('/api/auth/login').set('Host', 'app.local').set('Origin', 'http://app.local').send({
      email: 'nobody@example.com',
      password: 'x',
    });
    expect(same.status).toBe(401);
    // GET cross-origin no se bloquea (sin cabeceras CORS el navegador no deja leer la respuesta).
    const get = await request(ctx.app).get('/api/offers').set('Origin', 'https://evil.example').expect(200);
    expect(get.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('hides internal errors: generic 500 with request id, no stack or message', async () => {
    vi.spyOn(ctx.pool, 'query').mockRejectedValueOnce(new Error('relation "secret_table" does not exist'));
    const res = await request(ctx.app).get('/api/offers').expect(500);
    expect(res.body).toEqual({ error: 'Error interno del servidor', requestId: res.headers['x-request-id'] });
    expect(res.text).not.toMatch(/secret_table|at .*\.js/);
  });
});
