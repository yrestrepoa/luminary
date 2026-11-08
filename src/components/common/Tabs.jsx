/** Selector segmentado (botones conmutables). items: [{ key, label }] */
export default function Tabs({ items, value, onChange, label = 'Filtro' }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap rounded-xl border border-white/5 bg-stellar-surface/60 p-1 text-sm"
    >
      {items.map((t) => (
        <button
          key={t.key}
          type="button"
          aria-pressed={value === t.key}
          onClick={() => onChange(t.key)}
          className={`rounded-lg px-3 py-1.5 transition ${value === t.key ? 'bg-white/10 text-white' : 'text-stellar-gray-muted hover:text-stellar-light'}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
