/** Insignia de estado. `map`: { [status]: { label, className } } (ver constants/). */
export default function StatusBadge({ status, map }) {
  const s = map[status] ?? { label: status, className: 'bg-slate-400/10 text-slate-300' };
  return <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${s.className}`}>{s.label}</span>;
}
