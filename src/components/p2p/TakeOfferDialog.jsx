import { useState } from 'react';
import { Link } from 'react-router-dom';
import FormField from '../common/FormField.jsx';
import Button from '../common/Button.jsx';
import ErrorBanner from '../common/ErrorBanner.jsx';
import { fmtFiat, fmtNumber } from '../../utils/format.js';
import { ROUTES } from '../../constants/routes.js';

/**
 * Diálogo para tomar una oferta: el usuario elige cuántos USDC operar.
 * @param {{ offer: import('../../types/index.js').Offer, user: import('../../types/index.js').User,
 *           onConfirm: (usdcAmount: number) => Promise<void>, onClose: () => void }} props
 */
export default function TakeOfferDialog({ offer, user, onConfirm, onClose }) {
  const userBuys = offer.type === 'sell';
  const [amount, setAmount] = useState('');
  const [error, setError] = useState(null);
  const [details, setDetails] = useState({});
  const [loading, setLoading] = useState(false);

  const value = Number(amount);
  const fiat = Number.isFinite(value) ? value * offer.price : 0;
  const needsAddress = userBuys && !user.stellarAddress;

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setDetails({});
    try {
      await onConfirm(value);
    } catch (err) {
      setError(err.message);
      setDetails(err.details ?? {});
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-30 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="take-offer-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="take-offer-title" className="text-lg font-semibold">
              {userBuys ? 'Comprar' : 'Vender'} USDC a {offer.merchant}
            </h2>
            <p className="text-sm text-slate-400">
              {fmtFiat(offer.price, offer.currency)} por USDC · disponible {fmtNumber(offer.available, 7)} USDC
            </p>
          </div>
          <button onClick={onClose} className="opacity-60 hover:opacity-100" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <ErrorBanner>{error}</ErrorBanner>
        {needsAddress ? (
          <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
            Para recibir USDC necesitas vincular tu dirección Stellar.{' '}
            <Link to={ROUTES.profile} className="font-semibold underline">
              Ir a mi perfil
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <FormField
              label="Monto en USDC"
              name="usdcAmount"
              type="number"
              min="0.0000001"
              max={offer.available}
              step="any"
              required
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              error={details.usdcAmount}
              hint={
                offer.min != null || offer.max != null
                  ? `Límites: ${offer.min != null ? fmtFiat(offer.min, offer.currency) : '—'} – ${offer.max != null ? fmtFiat(offer.max, offer.currency) : '—'}`
                  : undefined
              }
            />
            <div className="flex items-center justify-between rounded-xl bg-slate-950/50 px-4 py-3 text-sm">
              <span className="text-slate-400">{userBuys ? 'Pagarás' : 'Recibirás'}</span>
              <span className="text-lg font-semibold tabular-nums">{fmtFiat(fiat, offer.currency)}</span>
            </div>
            <p className="text-xs text-slate-500">
              {userBuys
                ? `Pagarás por ${offer.paymentMethod}${offer.bank ? ` (${offer.bank})` : ''}; el vendedor libera los USDC a tu dirección vinculada.`
                : 'Recibirás el pago fiat del comprador y luego liberarás los USDC desde tu wallet Freighter.'}
            </p>
            <Button
              type="submit"
              variant={userBuys ? 'success' : 'danger'}
              loading={loading}
              loadingText="Abriendo operación…"
              className="py-2.5"
            >
              Abrir operación
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
