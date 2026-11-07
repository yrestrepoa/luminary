/**
 * Aviso descartable de éxito/error, con enlace opcional a la transacción.
 * @param {{ notice: import('../../types/index.js').Notice, onClose: () => void }} props
 */
export default function NoticeBanner({ notice, onClose }) {
  return (
    <div
      role={notice.kind === 'ok' ? 'status' : 'alert'}
      className={`mb-6 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
        notice.kind === 'ok'
          ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
          : 'border-rose-400/20 bg-rose-400/10 text-rose-200'
      }`}
    >
      <span>
        {notice.text}{' '}
        {notice.href && (
          <a href={notice.href} target="_blank" rel="noreferrer" className="underline">
            Ver transacción
          </a>
        )}
      </span>
      <button onClick={onClose} className="opacity-60 hover:opacity-100" aria-label="Cerrar">
        ✕
      </button>
    </div>
  );
}
