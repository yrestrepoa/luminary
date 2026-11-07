import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader.jsx';
import Tabs from '../components/common/Tabs.jsx';
import Spinner from '../components/common/Spinner.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import ErrorBanner from '../components/common/ErrorBanner.jsx';
import NoticeBanner from '../components/common/NoticeBanner.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import Button from '../components/common/Button.jsx';
import TradeList from '../components/trade/TradeList.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useAsync } from '../hooks/useAsync.js';
import { offersApi, tradesApi } from '../services/api/index.js';
import { OFFER_STATUS } from '../constants/offers.js';
import { TRADE_FILTERS } from '../constants/trades.js';
import { ROUTES } from '../constants/routes.js';
import { fmtDate, fmtFiat, fmtNumber } from '../utils/format.js';

const TABS = [
  { key: 'offers', label: 'Mis ofertas' },
  { key: 'history', label: 'Historial de operaciones' },
];

function OffersTab() {
  const location = useLocation();
  const { data: offers, loading, error, reload } = useAsync(offersApi.listMyOffers, []);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(location.state?.created ? { kind: 'ok', text: 'Oferta publicada' } : null);

  const act = async (offer, fn, text) => {
    setBusy(offer.id);
    setNotice(null);
    try {
      await fn();
      setNotice({ kind: 'ok', text });
      await reload({ silent: true });
    } catch (err) {
      setNotice({ kind: 'err', text: err.message });
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Spinner />;
  return (
    <>
      <ErrorBanner>{error?.message}</ErrorBanner>
      {notice && <NoticeBanner notice={notice} onClose={() => setNotice(null)} />}
      {!offers?.length ? (
        <EmptyState title="No has publicado ofertas" text="Publica una oferta para comprar o vender USDC.">
          <Link to={ROUTES.createOffer} className="text-sm font-medium text-amber-300 hover:text-amber-200">
            Publicar oferta
          </Link>
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/5 bg-slate-900/60">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr className="border-b border-white/5">
                <th className="px-5 py-3 font-medium">Tipo</th>
                <th className="px-5 py-3 font-medium">Precio</th>
                <th className="px-5 py-3 font-medium">Disponible</th>
                <th className="px-5 py-3 font-medium">Pago</th>
                <th className="px-5 py-3 font-medium">Estado</th>
                <th className="px-5 py-3 font-medium">Creada</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {offers.map((o) => (
                <tr key={o.id}>
                  <td className="px-5 py-3">
                    <span className={o.type === 'sell' ? 'text-rose-300' : 'text-emerald-300'}>
                      {o.type === 'sell' ? 'Venta' : 'Compra'}
                    </span>
                  </td>
                  <td className="px-5 py-3 tabular-nums">{fmtFiat(o.price, o.currency)}</td>
                  <td className="px-5 py-3 tabular-nums">{fmtNumber(o.available, 7)} USDC</td>
                  <td className="px-5 py-3">
                    {o.paymentMethod}
                    {o.bank && <span className="text-slate-500"> · {o.bank}</span>}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={o.status} map={OFFER_STATUS} />
                  </td>
                  <td className="px-5 py-3 text-slate-400">{fmtDate(o.createdAt)}</td>
                  <td className="px-5 py-3">
                    {o.status !== 'closed' && (
                      <div className="flex justify-end gap-1">
                        {o.status === 'active' ? (
                          <Button
                            variant="ghost"
                            disabled={busy === o.id}
                            onClick={() =>
                              act(o, () => offersApi.updateOffer(o.id, { status: 'paused' }), 'Oferta pausada')
                            }
                          >
                            Pausar
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            disabled={busy === o.id}
                            onClick={() =>
                              act(o, () => offersApi.updateOffer(o.id, { status: 'active' }), 'Oferta reactivada')
                            }
                          >
                            Activar
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          className="hover:!text-rose-300"
                          disabled={busy === o.id}
                          onClick={() =>
                            window.confirm('¿Cerrar esta oferta? No se puede reabrir.') &&
                            act(o, () => offersApi.closeOffer(o.id), 'Oferta cerrada')
                          }
                        >
                          Cerrar
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function HistoryTab() {
  const { user } = useAuth();
  const [status, setStatus] = useState('all');
  const { data: trades, loading, error } = useAsync(() => tradesApi.listTrades(status), [status]);

  return (
    <>
      <div className="mb-4">
        <Tabs items={TRADE_FILTERS} value={status} onChange={setStatus} label="Estado de la operación" />
      </div>
      <ErrorBanner>{error?.message}</ErrorBanner>
      {loading ? (
        <Spinner />
      ) : !trades?.length ? (
        <EmptyState
          title="Sin operaciones"
          text={status === 'all' ? 'Aún no has operado.' : 'No hay operaciones con este estado.'}
        />
      ) : (
        <TradeList trades={trades} userId={user.id} />
      )}
    </>
  );
}

export default function MyOffers() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'history' ? 'history' : 'offers';

  return (
    <>
      <PageHeader
        title="Mis ofertas e historial"
        action={
          <Link
            to={ROUTES.createOffer}
            className="rounded-xl bg-gradient-to-r from-amber-300 to-orange-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-orange-500/20 hover:brightness-110"
          >
            + Publicar oferta
          </Link>
        }
      />
      <div className="mb-6">
        <Tabs
          items={TABS}
          value={tab}
          onChange={(key) => setParams(key === 'history' ? { tab: key } : {})}
          label="Sección"
        />
      </div>
      {tab === 'offers' ? <OffersTab /> : <HistoryTab />}
    </>
  );
}
