import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import Spinner from '../common/Spinner.jsx';
import { ROUTES } from '../../constants/routes.js';

/** Solo usuarios autenticados; si no, redirige a login recordando el destino. */
export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Spinner label="Verificando sesión…" />;
  if (status === 'anonymous') return <Navigate to={ROUTES.login} replace state={{ from: location }} />;
  return <Outlet />;
}

/** Solo visitantes (login/registro); si ya hay sesión, va al panel. */
export function GuestRoute() {
  const { status } = useAuth();
  if (status === 'loading') return <Spinner label="Verificando sesión…" />;
  if (status === 'authenticated') return <Navigate to={ROUTES.dashboard} replace />;
  return <Outlet />;
}
