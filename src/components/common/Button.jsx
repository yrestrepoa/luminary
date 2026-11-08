const VARIANTS = {
  primary: 'bg-stellar-yellow text-stellar-dark hover:bg-stellar-yellow-hover active:bg-stellar-yellow-active',
  secondary: 'border border-white/10 bg-white/5 text-stellar-light hover:bg-white/10',
  success: 'bg-stellar-teal text-stellar-dark hover:bg-stellar-teal-hover',
  danger: 'bg-stellar-danger text-stellar-dark hover:bg-stellar-danger-light',
  ghost: 'text-stellar-gray-muted hover:text-stellar-light',
};

/** Botón con las variantes visuales de la app. `loading` lo deshabilita y muestra `loadingText`. */
export default function Button({
  variant = 'primary',
  loading,
  loadingText,
  className = '',
  children,
  disabled,
  ...props
}) {
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`rounded-xl px-4 py-2 font-heading text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {loading ? (loadingText ?? 'Procesando…') : children}
    </button>
  );
}
