export default function Stat({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-slate-900/60 p-5">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}
