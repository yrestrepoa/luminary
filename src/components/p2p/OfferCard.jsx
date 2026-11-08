import { fmtFiat } from '../../utils/format.js';

/**
 * offer: import('../../types/index.js').Offer
 * type 'sell' = el comerciante vende USDC (el usuario compra).
 */
export default function OfferCard({ offer, onAction, disabled, actionLabel }) {
  const userBuys = offer.type === 'sell';
  const merchant = offer.merchant ?? 'Usuario';

  return (
    <article className="group flex flex-col gap-4 rounded-2xl border border-white/5 bg-stellar-surface/60 p-5 transition hover:border-stellar-yellow/30 hover:bg-stellar-surface">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-stellar-gray text-sm font-semibold text-stellar-yellow-hover">
            {merchant.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="font-medium">{merchant}</p>
            <p className="text-xs text-stellar-gray-muted">
              {offer.rating != null && <>★ {offer.rating.toFixed(1)} · </>}
              {offer.trades} operaciones{offer.demo && ' · demo'}
            </p>
          </div>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            userBuys ? 'bg-stellar-teal/10 text-stellar-teal-hover' : 'bg-stellar-danger/10 text-stellar-danger'
          }`}
        >
          {userBuys ? 'Vende USDC' : 'Compra USDC'}
        </span>
      </header>

      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-neutral-500">Precio por 1 USDC</p>
          <p className="text-2xl font-semibold tabular-nums">{fmtFiat(offer.price, offer.currency)}</p>
        </div>
        <p className="text-right text-xs text-stellar-gray-muted">
          Disponible
          <span className="block text-sm font-medium tabular-nums text-stellar-light">
            {offer.available.toLocaleString('es-CO')} USDC
          </span>
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 rounded-xl bg-stellar-dark/50 p-3 text-sm">
        <div>
          <dt className="text-xs text-neutral-500">Método de pago</dt>
          <dd className="font-medium">{offer.paymentMethod}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Banco</dt>
          <dd className="font-medium">{offer.bank || '—'}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-neutral-500">Límites</dt>
          <dd className="tabular-nums">
            {offer.min == null && offer.max == null
              ? 'Sin límites'
              : `${offer.min != null ? fmtFiat(offer.min, offer.currency) : '—'} – ${offer.max != null ? fmtFiat(offer.max, offer.currency) : '—'}`}
          </dd>
        </div>
      </dl>

      <button
        onClick={() => onAction?.(offer)}
        disabled={disabled}
        className={`mt-auto rounded-xl py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
          userBuys
            ? 'bg-stellar-teal text-stellar-dark hover:bg-stellar-teal-hover'
            : 'bg-stellar-danger text-stellar-dark hover:bg-stellar-danger-light'
        }`}
      >
        {actionLabel ?? (userBuys ? 'Comprar USDC' : 'Vender USDC')}
      </button>
    </article>
  );
}
