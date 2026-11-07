import { fmtFiat } from '../../utils/format.js';

/**
 * offer: import('../../types/index.js').Offer
 * type 'sell' = el comerciante vende USDC (el usuario compra).
 */
export default function OfferCard({ offer, onAction, disabled }) {
  const userBuys = offer.type === 'sell';

  return (
    <article className="group flex flex-col gap-4 rounded-2xl border border-white/5 bg-slate-900/60 p-5 transition hover:border-amber-300/30 hover:bg-slate-900">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-slate-800 text-sm font-semibold text-amber-200">
            {offer.merchant.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="font-medium">{offer.merchant}</p>
            <p className="text-xs text-slate-400">
              ★ {offer.rating.toFixed(1)} · {offer.trades} operaciones
            </p>
          </div>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            userBuys ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'
          }`}
        >
          {userBuys ? 'Vende USDC' : 'Compra USDC'}
        </span>
      </header>

      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Precio por 1 USDC</p>
          <p className="text-2xl font-semibold tabular-nums">{fmtFiat(offer.price, offer.currency)}</p>
        </div>
        <p className="text-right text-xs text-slate-400">
          Disponible
          <span className="block text-sm font-medium tabular-nums text-slate-200">
            {offer.available.toLocaleString('es-CO')} USDC
          </span>
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 rounded-xl bg-slate-950/50 p-3 text-sm">
        <div>
          <dt className="text-xs text-slate-500">Método de pago</dt>
          <dd className="font-medium">{offer.paymentMethod}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Banco</dt>
          <dd className="font-medium">{offer.bank}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-slate-500">Límites</dt>
          <dd className="tabular-nums">
            {fmtFiat(offer.min, offer.currency)} – {fmtFiat(offer.max, offer.currency)}
          </dd>
        </div>
      </dl>

      <button
        onClick={() => onAction?.(offer)}
        disabled={disabled}
        className={`mt-auto rounded-xl py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
          userBuys
            ? 'bg-emerald-400 text-slate-950 hover:bg-emerald-300'
            : 'bg-rose-400 text-slate-950 hover:bg-rose-300'
        }`}
      >
        {userBuys ? 'Comprar USDC' : 'Vender USDC'}
      </button>
    </article>
  );
}
