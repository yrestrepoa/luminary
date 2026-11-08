export default function Stat({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-stellar-surface/60 p-5">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-stellar-gray-muted">{sub}</p>}
    </div>
  );
}
