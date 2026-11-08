import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import FormField from '../components/common/FormField.jsx';
import Button from '../components/common/Button.jsx';
import ErrorBanner from '../components/common/ErrorBanner.jsx';
import OfferCard from '../components/p2p/OfferCard.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useWallet } from '../hooks/useWallet.js';
import { useStellar } from '../hooks/useStellar.js';
import { offersApi } from '../services/api/index.js';
import { FIAT_CURRENCIES } from '../constants/offers.js';
import { ROUTES } from '../constants/routes.js';
import { fmtNumber } from '../utils/format.js';

const INITIAL = {
  type: 'sell',
  currency: 'COP',
  price: '',
  usdcAmount: '',
  min: '',
  max: '',
  paymentMethod: '',
  bank: '',
};
const toNum = (v) => (v === '' ? undefined : Number(v));

export default function CreateOffer() {
  const { user } = useAuth();
  const { address } = useWallet();
  const { balance } = useStellar(address);
  const navigate = useNavigate();
  const [form, setForm] = useState(INITIAL);
  const [error, setError] = useState(null);
  const [details, setDetails] = useState({});
  const [loading, setLoading] = useState(false);

  const set = (name, value) => setForm((f) => ({ ...f, [name]: value }));
  const onChange = (e) => set(e.target.name, e.target.value);

  const sells = form.type === 'sell';
  const usdcBalance = balance?.hasTrustline ? Number(balance.usdc) : null;
  const overBalance = sells && usdcBalance != null && Number(form.usdcAmount) > usdcBalance;

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setDetails({});
    try {
      await offersApi.createOffer({
        type: form.type,
        currency: form.currency,
        price: toNum(form.price),
        usdcAmount: toNum(form.usdcAmount),
        min: toNum(form.min),
        max: toNum(form.max),
        paymentMethod: form.paymentMethod.trim(),
        bank: form.bank.trim() || undefined,
      });
      navigate(ROUTES.myOffers, { state: { created: true } });
    } catch (err) {
      setError(err.message);
      setDetails(err.details ?? {});
      setLoading(false);
    }
  };

  const preview = {
    id: 0,
    type: form.type,
    merchant: user.displayName,
    rating: null,
    trades: 0,
    price: Number(form.price) || 0,
    currency: form.currency,
    available: Number(form.usdcAmount) || 0,
    min: toNum(form.min) ?? null,
    max: toNum(form.max) ?? null,
    paymentMethod: form.paymentMethod || '—',
    bank: form.bank,
  };

  return (
    <>
      <PageHeader
        title="Publicar oferta"
        subtitle="Define precio, cantidad y método de pago. Podrás pausarla o cerrarla cuando quieras."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <ErrorBanner>{error}</ErrorBanner>
          <form onSubmit={onSubmit} className="flex flex-col gap-5">
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-stellar-gray-muted">Quiero</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  {
                    key: 'sell',
                    label: 'Vender USDC',
                    active: 'border-stellar-danger/50 bg-stellar-danger/10 text-stellar-danger-light',
                  },
                  {
                    key: 'buy',
                    label: 'Comprar USDC',
                    active: 'border-stellar-teal/50 bg-stellar-teal/10 text-stellar-teal-light',
                  },
                ].map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={form.type === t.key}
                    onClick={() => set('type', t.key)}
                    className={`rounded-xl border py-2.5 text-sm font-semibold transition ${form.type === t.key ? t.active : 'border-white/10 text-stellar-gray-muted hover:text-stellar-light'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {!sells && !user.stellarAddress && (
              <div className="rounded-xl border border-stellar-yellow/20 bg-stellar-yellow/10 p-3 text-sm text-stellar-cream">
                Para comprar USDC necesitas una dirección Stellar vinculada.{' '}
                <Link to={ROUTES.profile} className="font-semibold underline">
                  Vincular
                </Link>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="Moneda fiat"
                name="currency"
                as="select"
                value={form.currency}
                onChange={onChange}
                error={details.currency}
              >
                {FIAT_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.label}
                  </option>
                ))}
              </FormField>
              <FormField
                label={`Precio por 1 USDC (${form.currency})`}
                name="price"
                type="number"
                min="0"
                step="0.0001"
                required
                value={form.price}
                onChange={onChange}
                error={details.price}
              />
              <FormField
                label="Cantidad de USDC"
                name="usdcAmount"
                type="number"
                min="0"
                step="0.0000001"
                required
                value={form.usdcAmount}
                onChange={onChange}
                error={details.usdcAmount}
                hint={
                  overBalance
                    ? `⚠ Supera tu balance actual (${fmtNumber(usdcBalance, 7)} USDC)`
                    : sells && usdcBalance != null
                      ? `Balance en wallet: ${fmtNumber(usdcBalance, 7)} USDC`
                      : undefined
                }
              />
              <div className="grid grid-cols-2 gap-2">
                <FormField
                  label="Mín. fiat"
                  name="min"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.min}
                  onChange={onChange}
                  error={details.min}
                />
                <FormField
                  label="Máx. fiat"
                  name="max"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.max}
                  onChange={onChange}
                  error={details.max}
                />
              </div>
              <FormField
                label="Método de pago"
                name="paymentMethod"
                required
                maxLength={60}
                placeholder="Transferencia, Nequi, SPEI…"
                value={form.paymentMethod}
                onChange={onChange}
                error={details.paymentMethod}
              />
              <FormField
                label="Banco (opcional)"
                name="bank"
                maxLength={60}
                value={form.bank}
                onChange={onChange}
                error={details.bank}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
                Cancelar
              </Button>
              <Button type="submit" loading={loading} loadingText="Publicando…">
                Publicar oferta
              </Button>
            </div>
          </form>
        </Card>

        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Vista previa</p>
          <OfferCard offer={preview} disabled actionLabel="Así la verán otros" />
        </div>
      </div>
    </>
  );
}
