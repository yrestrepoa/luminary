import { Link } from 'react-router-dom';
import StatusBadge from '../common/StatusBadge.jsx';
import { TRADE_STATUS } from '../../constants/trades.js';
import { ROUTES } from '../../constants/routes.js';
import { fmtDate, fmtFiat, fmtNumber } from '../../utils/format.js';

/**
 * Lista compacta de operaciones, vista desde `userId`.
 * @param {{ trades: import('../../types/index.js').Trade[], userId: number }} props
 */
export default function TradeList({ trades, userId }) {
  return (
    <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/5 bg-slate-900/60">
      {trades.map((t) => {
        const iBuy = t.buyer.id === userId;
        const counterpart = iBuy ? t.seller : t.buyer;
        return (
          <li key={t.id}>
            <Link to={ROUTES.trade(t.id)} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:bg-white/5">
              <div className="flex items-center gap-3">
                <span
                  className={`grid h-9 w-9 place-items-center rounded-full text-xs font-semibold ${iBuy ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'}`}
                >
                  {iBuy ? 'C' : 'V'}
                </span>
                <div>
                  <p className="text-sm font-medium">
                    {iBuy ? 'Compra' : 'Venta'} de {fmtNumber(t.usdcAmount, 7)} USDC
                  </p>
                  <p className="text-xs text-slate-400">
                    #{t.id} · con {counterpart.displayName} · {fmtDate(t.createdAt)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm tabular-nums text-slate-300">{fmtFiat(t.fiatAmount, t.currency)}</span>
                <StatusBadge status={t.status} map={TRADE_STATUS} />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
