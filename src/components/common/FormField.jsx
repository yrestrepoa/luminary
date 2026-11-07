export const INPUT_CLASS =
  'w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none transition focus:border-amber-300/50 disabled:opacity-60';

/**
 * Campo de formulario con etiqueta, ayuda y error.
 * Pasa cualquier prop de <input> (o usa `as="select"` con children).
 */
export default function FormField({ label, error, hint, as: Tag = 'input', className = '', children, ...props }) {
  const id = props.id ?? props.name;
  // El mensaje de error (o la ayuda) se asocia al control para lectores de pantalla.
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </label>
      <Tag
        id={id}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy}
        className={`${INPUT_CLASS} ${error ? 'border-rose-400/50' : ''}`}
        {...props}
      >
        {children}
      </Tag>
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-rose-300">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
