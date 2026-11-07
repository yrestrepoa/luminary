export default function ErrorBanner({ children }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className="mb-6 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200"
    >
      {children}
    </div>
  );
}
