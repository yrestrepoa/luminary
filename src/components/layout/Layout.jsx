import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar.jsx';
import ErrorBoundary from '../common/ErrorBoundary.jsx';
import Spinner from '../common/Spinner.jsx';

export default function Layout() {
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen bg-stellar-dark text-stellar-light antialiased">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-stellar-yellow focus:px-3 focus:py-2 focus:text-stellar-dark"
      >
        Saltar al contenido
      </a>
      <Navbar />
      <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 outline-none">
        {/* Al cambiar de ruta se reintenta el render tras un error. */}
        <ErrorBoundary resetKey={pathname}>
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
