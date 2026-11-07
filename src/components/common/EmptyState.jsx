export default function EmptyState({ title, text, children }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center">
      <p className="font-medium">{title}</p>
      {text && <p className="mt-1 text-sm text-slate-400">{text}</p>}
      {children && <div className="mt-4 flex justify-center gap-3">{children}</div>}
    </div>
  );
}
