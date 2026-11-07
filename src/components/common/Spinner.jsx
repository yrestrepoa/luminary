export default function Spinner({ label = 'Cargando…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-400" role="status">
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-amber-300 border-t-transparent"
      />
      {label}
    </div>
  );
}
