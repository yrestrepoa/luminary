import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE, ApiError, api, qs, setUnauthorizedHandler } from './client.js';
import * as offersApi from './offers.js';
import * as tradesApi from './trades.js';

const json = (status, body) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('api client', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
  });

  it('defaults to same-origin /api', () => {
    expect(API_BASE).toBe('/api');
  });

  it('sends JSON with same-origin credentials and returns the body', async () => {
    fetchMock.mockResolvedValue(json(201, { offer: { id: 1 } }));
    expect(await offersApi.createOffer({ type: 'sell' })).toEqual({ id: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/offers');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{"type":"sell"}',
    });
  });

  it('sends an empty JSON object on body-less POSTs and no body on GET', async () => {
    fetchMock.mockResolvedValue(json(200, { trade: { id: 3 } }));
    await tradesApi.markPaid(3);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{}' });
    fetchMock.mockResolvedValue(json(200, { trades: [] }));
    await tradesApi.listTrades('funded');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/trades?status=funded');
    expect(fetchMock.mock.calls[1][1].body).toBeUndefined();
  });

  it('returns null for 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await api.delete('/offers/1')).toBeNull();
  });

  it('maps error responses to ApiError with field details', async () => {
    fetchMock.mockResolvedValue(json(400, { error: 'Datos inválidos', details: { email: 'Email inválido' } }));
    const err = await api.post('/auth/register', {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, message: 'Datos inválidos', details: { email: 'Email inválido' } });
  });

  it('falls back to a generic message for non-JSON errors', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }));
    await expect(api.get('/offers')).rejects.toMatchObject({ status: 502, message: 'Error 502' });
  });

  it('reports network failures as status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api.get('/offers')).rejects.toMatchObject({
      status: 0,
      message: 'No se pudo conectar con el servidor',
    });
  });

  it('notifies the unauthorized handler on 401', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    fetchMock.mockResolvedValue(json(401, { error: 'No autenticado' }));
    await expect(api.get('/auth/me')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});

describe('qs', () => {
  it('skips empty values and the "all" filter', () => {
    expect(qs({ type: 'sell', currency: '', limit: undefined, status: 'all', x: null })).toBe('?type=sell');
    expect(qs({})).toBe('');
    expect(qs()).toBe('');
    expect(qs({ q: 'a&b' })).toBe('?q=a%26b');
  });
});
