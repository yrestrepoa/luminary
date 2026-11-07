import { Link } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader.jsx';
import Stat from '../components/common/Stat.jsx';
import Card from '../components/common/Card.jsx';
import Spinner from '../components/common/Spinner.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import ErrorBanner from '../components/common/ErrorBanner.jsx';
import WalletPanel from '../components/wallet/WalletPanel.jsx';
import TradeList from '../components/trade/TradeList.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useWallet } from '../hooks/useWallet.js';
import { useAsync } from '../hooks/useAsync.js';
import { offersApi, tradesApi } from '../services/api/index.js';
import { ROUTES } from '../constants/routes.js';
import { fmtNumber } from '../utils/format.js';

const loadActivity = () => Promise.all([offersApi.listMyOffers(), tradesApi.listTrades()]).then(([offers, trades]) => ({ offers, trades }));

export default function Dashboard() {
  const { user } = useAuth();
  const { address } = useWallet();
  const { data, loading, error } = useAsync(loadActivity, []);

  const offers = data?.offers ?? [];
  const trades = data?.trades ?? [];
  const open = trades.filter((t) => ['pending', 'paid', 'disputed'].includes(t.status));
  const completed = trades.filter((t) => t.status === 'released');
  const volume = completed.reduce((sum, t) => sum + t.usdcAmount, 0);
  const walletMismatch = address && user.stellarAddress && address !== user.stellarAddress;

  return (
    <>
      <PageHeader
        title={`Hola, ${user.displayName}`}
        subtitle="Tu wallet y tu actividad en Luminary."
        action={
          <div className="flex gap-2">
            <Link to={ROUTES.market} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10">
              Ir al mercado
            </Link>
            <Link to={ROUTES.createOffer} className="rounded-xl bg-gradient-to-r from-amber-300 to-orange-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-orange-500/20 hover:brightness-110">
              + Publicar oferta
            </Link>
          </div>
        }
      />

      {!user.stellarAddress && (
        <div className="mb-6 rounded-xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
          Aún no vinculaste una dirección Stellar: la necesitas para recibir USDC.{' '}
          <Link to={ROUTES.profile} className="font-semibold underline">Vincular ahora</Link>
        </div>
      )}
      {walletMismatch && (
        <div className="mb-6 rounded-xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
          La wallet conectada en Freighter no coincide con la dirección vinculada a tu cuenta.
        </div>
      )}

      <section className="mb-10">
        <h2 className="mb-4 text-xl font-semibold">Wallet</h2>
        <WalletPanel />
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold">Mi actividad</h2>
        <ErrorBanner>{error?.message}</ErrorBanner>
        {loading ? (
          <Spinner />
        ) : (
          <>
            <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Ofertas activas" value={offers.filter((o) => o.status === 'active').length} sub={`${offers.length} en total`} />
              <Stat label="Operaciones abiertas" value={open.length} sub="Pendientes, pagadas o en disputa" />
              <Stat label="Completadas" value={completed.length} />
              <Stat label="Volumen" value={fmtNumber(volume)} sub="USDC liquidados" />
            </div>

            <Card
              title="Operaciones recientes"
              action={
                <Link to={`${ROUTES.myOffers}?tab=history`} className="text-sm text-amber-300 hover:text-amber-200">
                  Ver historial →
                </Link>
              }
            >
              {trades.length === 0 ? (
                <EmptyState title="Sin operaciones todavía" text="Toma una oferta en el mercado o publica la tuya." />
              ) : (
                <TradeList trades={trades.slice(0, 5)} userId={user.id} />
              )}
            </Card>
          </>
        )}
      </section>
    </>
  );
}
