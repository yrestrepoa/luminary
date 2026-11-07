export default function Card({ title, action, className = '', children }) {
  return (
    <section className={`rounded-2xl border border-white/5 bg-slate-900/60 p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
