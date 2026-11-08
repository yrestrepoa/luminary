// DELETE /api/users/me: confirmación de contraseña, trades en curso, borrado vs anonimización
// y revocación de sesiones.
import { expect, it } from 'vitest';
import request from 'supertest';
import { createSellOffer, describeIntegration, registerUser } from '../helpers/app.js';

describeIntegration('users: account deletion', (ctx) => {
  const login = (u) => request(ctx.app).post('/api/auth/login').send({ email: u.email, password: u.password });

  it('requires a session and the current password', async () => {
    await request(ctx.app).delete('/api/users/me').send({ password: 'supersecret1' }).expect(401);
    const u = await registerUser(ctx.app, { name: 'Pwd' });
    await u.agent.delete('/api/users/me').send({}).expect(400);
    await u.agent.delete('/api/users/me').send({ password: 'wrong-password' }).expect(401);
    await u.agent.get('/api/auth/me').expect(200); // una contraseña errónea no cierra la sesión
  });

  it('rate-limits wrong password confirmations per account', async () => {
    const u = await registerUser(ctx.app, { name: 'Brute' });
    for (let i = 0; i < 5; i++)
      await u.agent
        .delete('/api/users/me')
        .send({ password: `nope-${i}` })
        .expect(401);
    await u.agent.delete('/api/users/me').send({ password: u.password }).expect(429);
  });

  it('hard-deletes an account without trades, its offers, and every session', async () => {
    const u = await registerUser(ctx.app, { name: 'NoTrades' });
    const offer = await createSellOffer(u.agent, { usdc: 5 });
    const otherSession = request.agent(ctx.app);
    await otherSession.post('/api/auth/login').send({ email: u.email, password: u.password }).expect(200);

    const res = await u.agent.delete('/api/users/me').send({ password: u.password }).expect(204);
    expect(res.headers['set-cookie']?.join(';')).toMatch(/Expires=Thu, 01 Jan 1970/);

    await u.agent.get('/api/auth/me').expect(401);
    await otherSession.get('/api/auth/me').expect(401);
    await login(u).expect(401);
    expect((await ctx.pool.query('SELECT 1 FROM users WHERE id = $1', [u.user.id])).rowCount).toBe(0);
    await request(ctx.app).get(`/api/offers/${offer.id}`).expect(404);
    // El email queda libre para una cuenta nueva.
    await request(ctx.app)
      .post('/api/auth/register')
      .send({ email: u.email, password: 'supersecret2', displayName: 'Again' })
      .expect(201);
  });

  it('refuses while a trade is open, then anonymizes once it is closed', async () => {
    const seller = await registerUser(ctx.app, { name: 'Seller' });
    const buyer = await registerUser(ctx.app, { name: 'Buyer' });
    const offer = await createSellOffer(seller.agent, { usdc: 20, price: 1 });
    const t = (await buyer.agent.post('/api/trades').send({ offerId: offer.id, usdcAmount: 5 }).expect(201)).body.trade;

    // Trade `pending`: ninguna de las partes puede irse; nada cambia (la transacción se revierte).
    const refused = await seller.agent.delete('/api/users/me').send({ password: seller.password }).expect(409);
    expect(refused.body.error).toMatch(/1 trade\(s\) en curso/);
    await buyer.agent.delete('/api/users/me').send({ password: buyer.password }).expect(409);
    await seller.agent.get('/api/auth/me').expect(200);
    expect((await seller.agent.get(`/api/offers/${offer.id}`).expect(200)).body.offer.status).toBe('active');

    await buyer.agent.post(`/api/trades/${t.id}/cancel`).expect(200);
    await seller.agent.delete('/api/users/me').send({ password: seller.password }).expect(204);

    await seller.agent.get('/api/auth/me').expect(401);
    await login(seller).expect(401);
    const { rows } = await ctx.pool.query(
      'SELECT email, display_name, stellar_address, password_hash, deleted_at FROM users WHERE id = $1',
      [seller.user.id]
    );
    expect(rows[0]).toMatchObject({
      email: `deleted-${seller.user.id}@deleted.invalid`,
      display_name: 'Cuenta eliminada',
      stellar_address: null,
      password_hash: '!',
    });
    expect(rows[0].deleted_at).toBeInstanceOf(Date);

    // La oferta queda cerrada y fuera del mercado; la contraparte conserva su historial.
    expect((await buyer.agent.get(`/api/offers/${offer.id}`).expect(200)).body.offer.status).toBe('closed');
    await buyer.agent.post('/api/trades').send({ offerId: offer.id, usdcAmount: 1 }).expect(409);
    const trade = (await buyer.agent.get(`/api/trades/${t.id}`).expect(200)).body.trade;
    expect(trade).toMatchObject({ status: 'cancelled', seller: { id: seller.user.id } });

    // Email y dirección Stellar quedan libres.
    await request(ctx.app)
      .post('/api/auth/register')
      .send({ email: seller.email, password: 'supersecret2', displayName: 'Seller again' })
      .expect(201);
  });
});
