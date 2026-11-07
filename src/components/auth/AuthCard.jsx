import { Link } from 'react-router-dom';

/** Contenedor de los formularios de login/registro. */
export default function AuthCard({ title, subtitle, footer, children }) {
  return (
    <div className="mx-auto mt-6 max-w-md">
      <div className="rounded-2xl border border-white/5 bg-gradient-to-br from-slate-900 to-slate-900/30 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <p className="mt-4 text-center text-sm text-slate-400">{footer}</p>}
    </div>
  );
}

export function AuthLink({ to, children }) {
  return (
    <Link to={to} className="font-medium text-amber-300 hover:text-amber-200">
      {children}
    </Link>
  );
}
