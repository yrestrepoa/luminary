/** Insignia de estado. `map`: { [status]: { label, className } } (ver constants/). */
export default function StatusBadge({ status, map }) {
  const s = map[status] ?? { label: status, className: 'bg-stellar-gray-muted/10 text-neutral-300' };
  return <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${s.className}`}>{s.label}</span>;
}
