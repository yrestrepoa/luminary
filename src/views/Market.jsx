import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import NoticeBanner from '../components/common/NoticeBanner.jsx';
import Tabs from '../components/common/Tabs.jsx';
import Spinner from '../components/common/Spinner.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import OfferCard from '../components/p2p/OfferCard.jsx';
import TakeOfferDialog from '../components/p2p/TakeOfferDialog.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useAsync } from '../hooks/useAsync.js';
import { offersApi, tradesApi } from '../services/api/index.js';
import { OFFER_FILTERS } from '../constants/offers.js';
import { ROUTES } from '../constants/routes.js';
import { MOCK_OFFERS } from '../data/mockOffers.js';

/** Carga ofertas de la API; si no responde, usa los datos de demostración. */
async function loadOffers() {
  try {
    return { offers: await offersApi.listOffers({ limit: 100 }), demo: false };
  } catch {
    return { offers: MOCK_OFFERS, demo: true };
  }
}

export default function Market() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { data, loading } = useAsync(loadOffers, []);
  const [filter, setFilter] = useState('all');
  const [notice, setNotice] = useState(null);
  const [taking, setTaking] = useState(null);

  const offers = useMemo(() => {
    const all = data?.offers ?? [];
    return filter === 'all' ? all : all.filter((o) => o.type === filter);
  }, [data, filter]);

  const onOffer = (offer) => {
    if (offer.demo) {
      setNotice({
        kind: 'err',
        text: 'Oferta de demostración: inicia el backend (npm run dev) para operar con ofertas reales.',
      });
      return;
    }
    if (!isAuthenticated) {
      navigate(ROUTES.login, { state: { from: { pathname: ROUTES.market } } });
      return;
    }
    setTaking(offer);
  };

  const onConfirm = async (usdcAmount) => {
    const trade = await tradesApi.openTrade(taking.id, usdcAmount);
    navigate(ROUTES.trade(trade.id));
  };

  return (
    <>
      <section className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Mercado P2P <span className="text-stellar-yellow">fiat ⇄ USDC</span>
          </h1>
          <p className="mt-2 max-w-2xl text-stellar-gray-muted">
            Compra y vende USDC con tu moneda local, liquidado en Stellar Testnet.
          </p>
        </div>
        {isAuthenticated && (
          <Link
            to={ROUTES.createOffer}
            className="rounded-xl bg-stellar-yellow px-5 py-2.5 text-sm font-semibold text-stellar-dark hover:bg-stellar-yellow-hover active:bg-stellar-yellow-active"
          >
            + Publicar oferta
          </Link>
        )}
      </section>

      {data?.demo && (
        <div className="mb-6 rounded-xl border border-stellar-yellow/20 bg-stellar-yellow/10 px-4 py-3 text-sm text-stellar-cream">
          No se pudo conectar con la API: mostrando ofertas de demostración.
        </div>
      )}
      {notice && <NoticeBanner notice={notice} onClose={() => setNotice(null)} />}

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Ofertas disponibles</h2>
          <Tabs items={OFFER_FILTERS} value={filter} onChange={setFilter} label="Tipo de oferta" />
        </div>

        {loading ? (
          <Spinner label="Cargando ofertas…" />
        ) : offers.length === 0 ? (
          <EmptyState title="No hay ofertas activas" text="Sé el primero en publicar una.">
            <Link
              to={isAuthenticated ? ROUTES.createOffer : ROUTES.register}
              className="text-sm font-medium text-stellar-yellow hover:text-stellar-yellow-hover"
            >
              Publicar oferta
            </Link>
          </EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {offers.map((offer) => {
              const own = user && offer.userId === user.id;
              return (
                <OfferCard
                  key={`${offer.demo ? 'demo' : 'api'}-${offer.id}`}
                  offer={offer}
                  onAction={onOffer}
                  disabled={own}
                  actionLabel={own ? 'Tu oferta' : !isAuthenticated ? 'Inicia sesión para operar' : undefined}
                />
              );
            })}
          </div>
        )}
      </section>

      {taking && <TakeOfferDialog offer={taking} user={user} onConfirm={onConfirm} onClose={() => setTaking(null)} />}
    </>
  );
}
