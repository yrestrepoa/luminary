import { lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { WalletProvider } from './context/WalletContext.jsx';
import Layout from './components/layout/Layout.jsx';
import ErrorBoundary from './components/common/ErrorBoundary.jsx';
import { GuestRoute, ProtectedRoute } from './components/auth/ProtectedRoute.jsx';
import Market from './views/Market.jsx';
import NotFound from './views/NotFound.jsx';
import { ROUTES } from './constants/routes.js';

// Vistas cargadas bajo demanda: el SDK de Stellar (~70 % del bundle) solo se descarga en las
// vistas que firman o consultan transacciones (panel, operación, perfil).
const Login = lazy(() => import('./views/Login.jsx'));
const Register = lazy(() => import('./views/Register.jsx'));
const Dashboard = lazy(() => import('./views/Dashboard.jsx'));
const CreateOffer = lazy(() => import('./views/CreateOffer.jsx'));
const MyOffers = lazy(() => import('./views/MyOffers.jsx'));
const Trade = lazy(() => import('./views/Trade.jsx'));
const Profile = lazy(() => import('./views/Profile.jsx'));

export default function App() {
  // Este límite cubre fallos fuera de las vistas (proveedores, barra de navegación); las vistas
  // tienen su propio límite y Suspense dentro de <Layout> para que la navegación siga visible.
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <WalletProvider>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Market />} />
                <Route element={<GuestRoute />}>
                  <Route path={ROUTES.login} element={<Login />} />
                  <Route path={ROUTES.register} element={<Register />} />
                </Route>
                <Route element={<ProtectedRoute />}>
                  <Route path={ROUTES.dashboard} element={<Dashboard />} />
                  <Route path={ROUTES.createOffer} element={<CreateOffer />} />
                  <Route path={ROUTES.myOffers} element={<MyOffers />} />
                  <Route path={ROUTES.trade()} element={<Trade />} />
                  <Route path={ROUTES.profile} element={<Profile />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </WalletProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
