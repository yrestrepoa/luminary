export default function ErrorBanner({ children }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className="mb-6 rounded-xl border border-stellar-danger/20 bg-stellar-danger/10 px-4 py-3 text-sm text-stellar-danger-light"
    >
      {children}
    </div>
  );
}
