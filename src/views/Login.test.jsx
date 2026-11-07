import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext.jsx';
import { ApiError } from '../services/api/client.js';
import Login from './Login.jsx';

function setup(login) {
  render(
    <AuthContext.Provider value={{ status: 'anonymous', login }}>
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: { pathname: '/trades/7' } } }]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/trades/7" element={<p>trade 7</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

describe('Login view', () => {
  it('logs in with the trimmed email and returns to the original page', async () => {
    const login = vi.fn().mockResolvedValue({ id: 1 });
    setup(login);
    await userEvent.type(screen.getByLabelText('Email'), '  ana@example.com ');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'supersecret1');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(login).toHaveBeenCalledWith('ana@example.com', 'supersecret1');
    expect(await screen.findByText('trade 7')).toBeInTheDocument();
  });

  it('shows the API error and per-field details accessibly', async () => {
    const login = vi
      .fn()
      .mockRejectedValue(
        new ApiError(400, 'Datos inválidos', { email: 'Email inválido', password: 'Campo requerido' })
      );
    setup(login);
    await userEvent.type(screen.getByLabelText('Email'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Datos inválidos');
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Email inválido');
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled();
  });
});
