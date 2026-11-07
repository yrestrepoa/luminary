import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext.jsx';
import { GuestRoute, ProtectedRoute } from './ProtectedRoute.jsx';

function LoginPage() {
  const location = useLocation();
  return <p>login page (from: {location.state?.from?.pathname ?? '-'})</p>;
}

function renderAt(path, status) {
  return render(
    <AuthContext.Provider value={{ status, user: null, isAuthenticated: status === 'authenticated' }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<p>private dashboard</p>} />
          </Route>
          <Route element={<GuestRoute />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}

describe('ProtectedRoute', () => {
  it('shows a spinner while the session is being checked', () => {
    renderAt('/dashboard', 'loading');
    expect(screen.getByRole('status')).toHaveTextContent('Verificando sesión');
    expect(screen.queryByText('private dashboard')).not.toBeInTheDocument();
  });

  it('redirects anonymous users to login, remembering the destination', () => {
    renderAt('/dashboard', 'anonymous');
    expect(screen.getByText('login page (from: /dashboard)')).toBeInTheDocument();
  });

  it('renders the page for authenticated users', () => {
    renderAt('/dashboard', 'authenticated');
    expect(screen.getByText('private dashboard')).toBeInTheDocument();
  });
});

describe('GuestRoute', () => {
  it('sends authenticated users to the dashboard', () => {
    renderAt('/login', 'authenticated');
    expect(screen.getByText('private dashboard')).toBeInTheDocument();
  });

  it('shows the guest page to anonymous users', () => {
    renderAt('/login', 'anonymous');
    expect(screen.getByText(/login page/)).toBeInTheDocument();
  });
});
