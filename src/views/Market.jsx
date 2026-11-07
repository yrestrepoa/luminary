import { useMemo, useState } from 'react';
import OfferCard from '../components/p2p/OfferCard.jsx';
import { useWallet } from '../context/WalletContext.jsx';
import { useStellar } from '../hooks/useStellar.js';
import { createTrustline, sendUSDC, fundWithFriendbot } from '../services/stellar.js';
import { freighterSigner } from '../services/wallet.js';
import { EXPLORER_TX_URL, EXPLORER_ACCOUNT_URL } from '../config/stellar.js';

const MOCK_OFFERS = [
  { id: 1, type: 'sell', merchant: 'CambiosAndes', rating: 4.9, trades: 1284, price: 4120.5, currency: 'COP', available: 2500, min: 50000, max: 5000000, paymentMethod: 'Transferencia', bank: 'Bancolombia' },
  { id: 2, type: 'sell', merchant: 'NequiPro', rating: 4.7, trades: 532, price: 4135, currency: 'COP', available: 800, min: 20000, max: 2000000, paymentMethod: 'Billetera móvil', bank: 'Nequi' },
  { id: 3, type: 'buy', merchant: 'DaviTrader', rating: 4.8, trades: 911, price: 4085.25, currency: 'COP', available: 4000, min: 100000, max: 10000000, paymentMethod: 'Transferencia', bank: 'Davivienda' },
  { id: 4, type: 'sell', merchant: 'AztecaFX', rating: 4.6, trades: 302, price: 18.42, currency: 'MXN', available: 1500, min: 200, max: 30000, paymentMethod: 'SPEI', bank: 'BBVA México' },
  { id: 5, type: 'buy', merchant: 'PampaCoin', rating: 4.5, trades: 188, price: 1185, currency: 'ARS', available: 600, min: 10000, max: 700000, paymentMethod: 'CBU / Alias', bank: 'Banco Galicia' },
  { id: 6, type: 'buy', merchant: 'LimaSwap', rating: 4.9, trades: 740, price: 3.74, currency: 'PEN', available: 1200, min: 50, max: 15000, paymentMethod: 'Yape', bank: 'BCP' },
];

const FILTERS = [
  { key: 'all', label: 'Todas' },
  { key: 'sell', label: 'Comprar USDC' },
  { key: 'buy', label: 'Vender USDC' },
];

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-slate-900/60 p-5">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

export default function Market() {
  const { address, connect, connecting, error: walletError } = useWallet();
  const { balance, loading, error: balanceError, refresh } = useStellar(address);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null); // { kind: 'ok'|'err', text, href? }
  const [dest, setDest] = useState('');
  const [amount, setAmount] = useState('');

  const offers = useMemo(
    () => (filter === 'all' ? MOCK_OFFERS : MOCK_OFFERS.filter((o) => o.type === filter)),
    [filter]
  );

  const run = async (key, fn, okText) => {
    setBusy(key);
    setNotice(null);
    try {
      const res = await fn();
      setNotice({ kind: 'ok', text: okText, href: res?.hash ? EXPLORER_TX_URL + res.hash : undefined });
      await refresh();
      return true;
    } catch (err) {
      setNotice({ kind: 'err', text: err.message });
    } finally {
      setBusy(null);
    }
  };

  const onFund = () => run('fund', () => fundWithFriendbot(address), 'Cuenta fondeada con 10.000 XLM de prueba');
  const onTrust = () => run('trust', () => createTrustline(freighterSigner(address)), 'Trustline USDC creada');
  const onSend = (e) => {
    e.preventDefault();
    run('send', () => sendUSDC(dest.trim(), amount), `Enviaste ${amount} USDC`).then((ok) => ok && setAmount(''));
  };
  const onOffer = (offer) =>
    setNotice({
      kind: 'ok',
      text: `Orden ${offer.type === 'sell' ? 'de compra' : 'de venta'} con ${offer.merchant} iniciada (demo — escrow pendiente de implementar).`,
    });

  const fmt = (v, d = 2) => Number(v).toLocaleString('es-CO', { maximumFractionDigits: d });
  const errorText = walletError || balanceError;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <section className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Mercado P2P <span className="text-amber-300">fiat ⇄ USDC</span>
        </h1>
        <p className="mt-2 max-w-2xl text-slate-400">
          Compra y vende USDC con tu moneda local, liquidado en Stellar Testnet.
        </p>
      </section>

      {errorText && (
        <div className="mb-6 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{errorText}</div>
      )}
      {notice && (
        <div
          className={`mb-6 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
            notice.kind === 'ok'
              ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
              : 'border-rose-400/20 bg-rose-400/10 text-rose-200'
          }`}
        >
          <span>
            {notice.text}{' '}
            {notice.href && (
              <a href={notice.href} target="_blank" rel="noreferrer" className="underline">Ver transacción</a>
            )}
          </span>
          <button onClick={() => setNotice(null)} className="opacity-60 hover:opacity-100" aria-label="Cerrar">✕</button>
        </div>
      )}

      {/* Dashboard */}
      {!address ? (
        <section className="mb-10 flex flex-col items-start gap-4 rounded-2xl border border-white/5 bg-gradient-to-br from-slate-900 to-slate-900/30 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Conecta tu wallet</h2>
            <p className="text-sm text-slate-400">Usa Freighter (en red Testnet) para ver tu balance y operar.</p>
          </div>
          <button
            onClick={connect}
            disabled={connecting}
            className="rounded-xl bg-gradient-to-r from-amber-300 to-orange-500 px-5 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-60"
          >
            {connecting ? 'Conectando…' : 'Conectar Freighter'}
          </button>
        </section>
      ) : (
        <section className="mb-10 grid gap-4 lg:grid-cols-3">
          <Stat
            label="Balance USDC"
            value={loading && !balance ? '…' : balance?.hasTrustline ? fmt(balance.usdc) : '—'}
            sub={balance && !balance.hasTrustline ? 'Sin trustline USDC' : 'USDC · Testnet'}
          />
          <Stat
            label="Balance XLM"
            value={loading && !balance ? '…' : balance ? fmt(balance.xlm) : '—'}
            sub={
              <a href={EXPLORER_ACCOUNT_URL + address} target="_blank" rel="noreferrer" className="font-mono hover:text-amber-200">
                {address.slice(0, 8)}…{address.slice(-8)} ↗
              </a>
            }
          />

          <div className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-slate-900/60 p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-slate-500">Acciones</p>
              <button onClick={refresh} disabled={loading} className="text-xs text-slate-400 hover:text-slate-200">
                {loading ? 'Actualizando…' : '↻ Actualizar'}
              </button>
            </div>

            {balance && !balance.funded && (
              <button onClick={onFund} disabled={!!busy} className="rounded-xl bg-sky-400 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">
                {busy === 'fund' ? 'Fondeando…' : 'Fondear con Friendbot'}
              </button>
            )}
            {balance?.funded && !balance.hasTrustline && (
              <button onClick={onTrust} disabled={!!busy} className="rounded-xl bg-amber-300 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">
                {busy === 'trust' ? 'Firmando…' : 'Habilitar USDC (trustline)'}
              </button>
            )}
            {balance?.hasTrustline && (
              <form onSubmit={onSend} className="flex flex-col gap-2">
                <input
                  value={dest}
                  onChange={(e) => setDest(e.target.value)}
                  placeholder="Destino G…"
                  required
                  className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 font-mono text-xs outline-none focus:border-amber-300/50"
                />
                <div className="flex gap-2">
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    type="number"
                    min="0.0000001"
                    step="any"
                    placeholder="Monto USDC"
                    required
                    className="w-full min-w-0 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-amber-300/50"
                  />
                  <button disabled={!!busy} className="shrink-0 rounded-lg bg-amber-300 px-4 text-sm font-semibold text-slate-950 disabled:opacity-50">
                    {busy === 'send' ? '…' : 'Enviar'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>
      )}

      {/* Ofertas */}
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Ofertas disponibles</h2>
          <div className="flex rounded-xl border border-white/5 bg-slate-900/60 p-1 text-sm">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-lg px-3 py-1.5 transition ${filter === f.key ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {offers.map((offer) => (
            <OfferCard key={offer.id} offer={offer} onAction={onOffer} disabled={!address} />
          ))}
        </div>
        {!address && <p className="mt-4 text-center text-sm text-slate-500">Conecta tu wallet para operar.</p>}
      </section>
    </main>
  );
}
