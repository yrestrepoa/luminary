import { Link } from 'react-router-dom';

/** Contenedor de los formularios de login/registro. */
export default function AuthCard({ title, subtitle, footer, children }) {
  return (
    <div className="mx-auto mt-6 max-w-md">
      <div className="rounded-2xl border border-white/5 bg-gradient-to-br from-stellar-surface to-stellar-surface/30 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stellar-gray-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <p className="mt-4 text-center text-sm text-stellar-gray-muted">{footer}</p>}
    </div>
  );
}

export function AuthLink({ to, children }) {
  return (
    <Link to={to} className="font-medium text-stellar-yellow hover:text-stellar-yellow-hover">
      {children}
    </Link>
  );
}
