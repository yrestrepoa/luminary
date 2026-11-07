const VARIANTS = {
  primary:
    'bg-gradient-to-r from-amber-300 to-orange-500 text-slate-950 shadow-lg shadow-orange-500/20 hover:brightness-110',
  secondary: 'border border-white/10 bg-white/5 text-slate-100 hover:bg-white/10',
  success: 'bg-emerald-400 text-slate-950 hover:bg-emerald-300',
  danger: 'bg-rose-400 text-slate-950 hover:bg-rose-300',
  ghost: 'text-slate-400 hover:text-slate-200',
};

/** Botón con las variantes visuales de la app. `loading` lo deshabilita y muestra `loadingText`. */
export default function Button({ variant = 'primary', loading, loadingText, className = '', children, disabled, ...props }) {
  return (
    <button
      disabled={disabled || loading}
      className={`rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {loading ? (loadingText ?? 'Procesando…') : children}
    </button>
  );
}
