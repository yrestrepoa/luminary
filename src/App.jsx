import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { WalletProvider } from './context/WalletContext.jsx';
import Layout from './components/layout/Layout.jsx';
import { GuestRoute, ProtectedRoute } from './components/auth/ProtectedRoute.jsx';
import Market from './views/Market.jsx';
import Login from './views/Login.jsx';
import Register from './views/Register.jsx';
import Dashboard from './views/Dashboard.jsx';
import CreateOffer from './views/CreateOffer.jsx';
import MyOffers from './views/MyOffers.jsx';
import Trade from './views/Trade.jsx';
import Profile from './views/Profile.jsx';
import NotFound from './views/NotFound.jsx';
import { ROUTES } from './constants/routes.js';

export default function App() {
  return (
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
  );
}
