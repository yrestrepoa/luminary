import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useWallet } from '../../hooks/useWallet.js';
import { useAuth } from '../../hooks/useAuth.js';
import { shortenAddress } from '../../utils/format.js';
import { ROUTES } from '../../constants/routes.js';

const PUBLIC_LINKS = [{ to: ROUTES.market, label: 'Mercado', end: true }];
const PRIVATE_LINKS = [
  { to: ROUTES.dashboard, label: 'Panel' },
  { to: ROUTES.myOffers, label: 'Mis ofertas' },
  { to: ROUTES.createOffer, label: 'Publicar' },
];

const linkClass = ({ isActive }) =>
  `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition ${isActive ? 'bg-white/10 text-white' : 'text-stellar-gray-muted hover:text-stellar-light'}`;

export default function Navbar() {
  const { address, connecting, connect, disconnect } = useWallet();
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  const links = isAuthenticated ? [...PUBLIC_LINKS, ...PRIVATE_LINKS] : PUBLIC_LINKS;

  const onLogout = async () => {
    await logout();
    navigate(ROUTES.market);
  };

  return (
    <header className="sticky top-0 z-20 border-b border-white/5 bg-stellar-dark/80 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <div className="flex min-w-0 items-center gap-6">
          <Link to={ROUTES.market} className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-stellar-yellow">
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-stellar-dark" fill="currentColor" aria-hidden>
                <path d="M12 2l2.4 7.6H22l-6.2 4.5 2.4 7.6L12 17.2l-6.2 4.5 2.4-7.6L2 9.6h7.6z" />
              </svg>
            </div>
            <span className="text-lg font-semibold tracking-tight">Luminary</span>
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
                {l.label}
              </NavLink>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 rounded-full border border-stellar-teal/20 bg-stellar-teal/10 px-3 py-1 text-xs font-medium text-stellar-teal-hover lg:inline-flex">
            <span className="h-2 w-2 animate-pulse rounded-full bg-stellar-teal" />
            Stellar Testnet
          </span>

          {address ? (
            <button
              onClick={disconnect}
              title="Desconectar wallet"
              className="hidden rounded-xl border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm hover:bg-white/10 sm:block"
            >
              {shortenAddress(address)}
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={connecting}
              className="hidden rounded-xl border border-stellar-yellow/30 px-3 py-2 text-sm font-medium text-stellar-yellow-hover transition hover:bg-stellar-yellow/10 disabled:opacity-60 sm:block"
            >
              {connecting ? 'Conectando…' : 'Conectar Wallet'}
            </button>
          )}

          {isAuthenticated ? (
            <div className="flex items-center gap-2">
              <NavLink
                to={ROUTES.profile}
                title="Perfil"
                className={({ isActive }) =>
                  `grid h-9 w-9 place-items-center rounded-full text-sm font-semibold ${isActive ? 'bg-stellar-yellow text-stellar-dark' : 'bg-stellar-gray text-stellar-yellow-hover hover:bg-stellar-gray-light'}`
                }
              >
                {user.displayName.slice(0, 2).toUpperCase()}
              </NavLink>
              <button onClick={onLogout} className="text-sm text-stellar-gray-muted hover:text-stellar-light">
                Salir
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link to={ROUTES.login} className="px-2 text-sm text-neutral-300 hover:text-white">
                Entrar
              </Link>
              <Link
                to={ROUTES.register}
                className="rounded-xl bg-stellar-yellow px-4 py-2 text-sm font-semibold text-stellar-dark transition hover:bg-stellar-yellow-hover active:bg-stellar-yellow-active"
              >
                Crear cuenta
              </Link>
            </div>
          )}
        </div>
      </nav>

      {/* Navegación móvil */}
      <div className="flex gap-1 overflow-x-auto border-t border-white/5 px-4 py-2 md:hidden">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
            {l.label}
          </NavLink>
        ))}
      </div>
    </header>
  );
}
