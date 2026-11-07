export default function PageHeader({ title, subtitle, action }) {
  return (
    <section className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </section>
  );
}
