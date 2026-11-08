import { EXPLORER_ACCOUNT_URL, EXPLORER_TX_URL } from '../../config/stellar.js';
import { fmtDate, fmtNumber, shortenAddress } from '../../utils/format.js';

const KIND_LABEL = {
  payment: 'Pago',
  create_account: 'Cuenta creada',
  path_payment_strict_send: 'Path payment',
  path_payment_strict_receive: 'Path payment',
  account_merge: 'Merge',
};

/**
 * Fila de un pago reciente con enlaces a stellar.expert.
 * @param {{ tx: import('../../types/index.js').RecentPayment }} props
 */
export default function TxCard({ tx }) {
  const label = KIND_LABEL[tx.kind] ?? tx.kind;
  return (
    <li className="flex items-center gap-4 rounded-xl border border-white/5 bg-stellar-surface px-4 py-3">
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold ${
          tx.incoming ? 'bg-stellar-teal/15 text-stellar-teal' : 'bg-stellar-cream/10 text-stellar-cream'
        }`}
        aria-hidden
      >
        {tx.incoming ? '↓' : '↑'}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          {label} {tx.incoming ? 'de' : 'a'}{' '}
          {tx.counterparty ? (
            <a
              href={EXPLORER_ACCOUNT_URL + tx.counterparty}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-stellar-gray-muted hover:text-stellar-light"
            >
              {shortenAddress(tx.counterparty)}
            </a>
          ) : (
            '—'
          )}
        </p>
        <p className="text-xs text-stellar-gray-muted">{fmtDate(tx.createdAt)}</p>
      </div>

      <div className="shrink-0 text-right">
        <p
          className={`font-heading text-sm font-semibold tabular-nums ${tx.incoming ? 'text-stellar-teal' : 'text-stellar-light'}`}
        >
          <span className="sr-only">{tx.incoming ? 'Recibido' : 'Enviado'}: </span>
          {tx.amount != null ? `${tx.incoming ? '+' : '−'}${fmtNumber(tx.amount, 4)}` : '—'} {tx.asset}
        </p>
        <a
          href={EXPLORER_TX_URL + tx.hash}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-stellar-yellow hover:text-stellar-yellow-hover"
        >
          Ver transacción ↗
        </a>
      </div>
    </li>
  );
}
