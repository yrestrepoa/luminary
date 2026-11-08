import { EXPLORER_ACCOUNT_URL, EXPLORER_CONTRACT_URL, EXPLORER_TX_URL } from '../../config/stellar.js';
import { fmtDate, fmtNumber, shortenAddress } from '../../utils/format.js';

const KIND_LABEL = {
  payment: 'Pago',
  create_account: 'Cuenta creada',
  path_payment_strict_send: 'Path payment',
  path_payment_strict_receive: 'Path payment',
  account_merge: 'Merge',
};

/** Métodos del contrato luminary-escrow (contract-luminary/contracts/escrow). */
const CONTRACT_FN_LABEL = {
  create: 'Depósito en escrow',
  release: 'Liberación de USDC',
  refund: 'Reembolso de escrow',
};

const isContract = (address) => address?.startsWith('C');

/**
 * Fila de un pago reciente con enlaces a stellar.expert.
 * @param {{ tx: import('../../types/index.js').RecentPayment }} props
 */
export default function TxCard({ tx }) {
  const contractCall = tx.kind === 'invoke_host_function';
  const label = contractCall
    ? (CONTRACT_FN_LABEL[tx.contractFn] ?? 'Operación de contrato')
    : (KIND_LABEL[tx.kind] ?? tx.kind);
  const counterpartyUrl =
    (isContract(tx.counterparty) ? EXPLORER_CONTRACT_URL : EXPLORER_ACCOUNT_URL) + tx.counterparty;
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
          {label}
          {contractCall ? (tx.counterparty ? ' · ' : '') : tx.incoming ? ' de ' : ' a '}
          {tx.counterparty ? (
            <a
              href={counterpartyUrl}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-stellar-gray-muted hover:text-stellar-light"
            >
              {shortenAddress(tx.counterparty)}
            </a>
          ) : contractCall ? null : (
            '—'
          )}
        </p>
        <p className="text-xs text-stellar-gray-muted">{fmtDate(tx.createdAt)}</p>
      </div>

      <div className="shrink-0 text-right">
        <p
          className={`font-heading text-sm font-semibold tabular-nums ${tx.incoming ? 'text-stellar-teal' : 'text-stellar-light'}`}
        >
          {tx.amount != null ? (
            <>
              <span className="sr-only">{tx.incoming ? 'Recibido' : 'Enviado'}: </span>
              {`${tx.incoming ? '+' : '−'}${fmtNumber(tx.amount, 4)}`} {tx.asset}
            </>
          ) : (
            '—'
          )}
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
