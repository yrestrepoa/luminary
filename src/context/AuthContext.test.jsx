import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from './AuthContext.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { api } from '../services/api/client.js';

const json = (status, body) => new Response(body ? JSON.stringify(body) : null, { status });
const ANA = { id: 1, email: 'ana@example.com', displayName: 'Ana', stellarAddress: null };

let auth;
function Probe() {
  auth = useAuth();
  return <p>status: {auth.status}</p>;
}

describe('AuthProvider', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('restores an existing session from /auth/me', async () => {
    fetchMock.mockResolvedValue(json(200, { user: ANA }));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    expect(screen.getByText('status: loading')).toBeInTheDocument();
    await screen.findByText('status: authenticated');
    expect(auth.user).toEqual(ANA);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ method: 'GET' }));
  });

  it('becomes anonymous without a session, then logs in and out', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: 'No autenticado' }));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await screen.findByText('status: anonymous');

    fetchMock.mockResolvedValueOnce(json(200, { user: ANA }));
    await act(() => auth.login('ana@example.com', 'pw'));
    expect(screen.getByText('status: authenticated')).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await act(() => auth.logout());
    expect(screen.getByText('status: anonymous')).toBeInTheDocument();
  });

  it('clears the local session even if logout fails on the server', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { user: ANA }));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await screen.findByText('status: authenticated');
    fetchMock.mockResolvedValueOnce(json(503, { error: 'Servicio no disponible' }));
    await act(() => auth.logout().catch(() => {}));
    expect(screen.getByText('status: anonymous')).toBeInTheDocument();
  });

  it('drops the session when any API call returns 401', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { user: ANA }));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await screen.findByText('status: authenticated');
    fetchMock.mockResolvedValueOnce(json(401, { error: 'expirada' }));
    await act(() => api.get('/trades').catch(() => {}));
    await waitFor(() => expect(screen.getByText('status: anonymous')).toBeInTheDocument());
  });

  it('useAuth throws outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/AuthProvider/);
  });
});
