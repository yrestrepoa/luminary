import { useState } from 'react';
import Stat from '../common/Stat.jsx';
import Card from '../common/Card.jsx';
import TxCard from './TxCard.jsx';
import NoticeBanner from '../common/NoticeBanner.jsx';
import { INPUT_CLASS } from '../common/FormField.jsx';
import { useWallet } from '../../hooks/useWallet.js';
import { useStellar } from '../../hooks/useStellar.js';
import { createTrustline, sendUSDC, fundWithFriendbot } from '../../services/stellar/index.js';
import { freighterSigner } from '../../services/wallet/index.js';
import { EXPLORER_TX_URL, EXPLORER_ACCOUNT_URL, IS_TESTNET } from '../../config/stellar.js';
import { fmtNumber, shortenAddress } from '../../utils/format.js';

/**
 * Balance XLM/USDC de la wallet conectada + acciones (Friendbot, trustline, envío).
 * Si no hay wallet conectada muestra el CTA para conectar Freighter.
 */
export default function WalletPanel() {
  const { address, connect, connecting, error: walletError } = useWallet();
  const {
    balance,
    payments,
    loading,
    error: balanceError,
    paymentsError,
    refresh,
  } = useStellar(address, {
    withPayments: true,
  });
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [dest, setDest] = useState('');
  const [amount, setAmount] = useState('');

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

  const errorText = walletError || balanceError;

  if (!address) {
    return (
      <section className="flex flex-col items-start gap-4 rounded-2xl border border-white/5 bg-gradient-to-br from-stellar-surface to-stellar-surface/30 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Conecta tu wallet</h2>
          <p className="text-sm text-stellar-gray-muted">
            Usa Freighter (en red Testnet) para ver tu balance y operar.
          </p>
          {walletError && <p className="mt-2 text-sm text-stellar-danger">{walletError}</p>}
        </div>
        <button
          onClick={connect}
          disabled={connecting}
          className="rounded-xl bg-stellar-yellow px-5 py-2.5 text-sm font-semibold text-stellar-dark disabled:opacity-60"
        >
          {connecting ? 'Conectando…' : 'Conectar Freighter'}
        </button>
      </section>
    );
  }

  return (
    <div>
      {errorText && (
        <div className="mb-4 rounded-xl border border-stellar-danger/20 bg-stellar-danger/10 px-4 py-3 text-sm text-stellar-danger-light">
          {errorText}
        </div>
      )}
      {notice && <NoticeBanner notice={notice} onClose={() => setNotice(null)} />}
      <section className="grid gap-4 lg:grid-cols-3">
        <Stat
          label="Balance USDC"
          value={loading && !balance ? '…' : balance?.hasTrustline ? fmtNumber(balance.usdc) : '—'}
          sub={balance && !balance.hasTrustline ? 'Sin trustline USDC' : 'USDC · Testnet'}
        />
        <Stat
          label="Balance XLM"
          value={loading && !balance ? '…' : balance ? fmtNumber(balance.xlm) : '—'}
          sub={
            <a
              href={EXPLORER_ACCOUNT_URL + address}
              target="_blank"
              rel="noreferrer"
              className="font-mono hover:text-stellar-yellow-hover"
            >
              {shortenAddress(address, 8)} ↗
            </a>
          }
        />

        <div className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-stellar-surface/60 p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Acciones</p>
            <button
              onClick={refresh}
              disabled={loading}
              className="text-xs text-stellar-gray-muted hover:text-stellar-light"
            >
              {loading ? 'Actualizando…' : '↻ Actualizar'}
            </button>
          </div>

          {IS_TESTNET && balance && !balance.funded && (
            <button
              onClick={onFund}
              disabled={!!busy}
              className="rounded-xl bg-sky-400 py-2 text-sm font-semibold text-stellar-dark disabled:opacity-50"
            >
              {busy === 'fund' ? 'Fondeando…' : 'Fondear con Friendbot'}
            </button>
          )}
          {balance?.funded && !balance.hasTrustline && (
            <button
              onClick={onTrust}
              disabled={!!busy}
              className="rounded-xl bg-stellar-yellow py-2 text-sm font-semibold text-stellar-dark disabled:opacity-50"
            >
              {busy === 'trust' ? 'Firmando…' : 'Habilitar USDC (trustline)'}
            </button>
          )}
          {balance?.hasTrustline && (
            <form onSubmit={onSend} className="flex flex-col gap-2">
              <input
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                placeholder="Destino G…"
                aria-label="Dirección Stellar de destino"
                autoComplete="off"
                spellCheck={false}
                required
                className={`${INPUT_CLASS} font-mono text-xs`}
              />
              <div className="flex gap-2">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  type="number"
                  min="0.0000001"
                  step="any"
                  placeholder="Monto USDC"
                  aria-label="Monto en USDC"
                  required
                  className={`${INPUT_CLASS} min-w-0`}
                />
                <button
                  disabled={!!busy}
                  className="shrink-0 rounded-lg bg-stellar-yellow px-4 text-sm font-semibold text-stellar-dark disabled:opacity-50"
                >
                  {busy === 'send' ? '…' : 'Enviar'}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>

      <Card title="Movimientos recientes" className="mt-4">
        {paymentsError ? (
          <p className="text-sm text-stellar-danger">No se pudieron cargar los movimientos: {paymentsError}</p>
        ) : loading && payments.length === 0 ? (
          <p className="text-sm text-stellar-gray-muted">Cargando…</p>
        ) : payments.length === 0 ? (
          <p className="text-sm text-stellar-gray-muted">Esta cuenta aún no tiene movimientos.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {payments.map((tx) => (
              <TxCard key={tx.id} tx={tx} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
