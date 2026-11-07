import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Spinner from '../components/common/Spinner.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import NoticeBanner from '../components/common/NoticeBanner.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import { INPUT_CLASS } from '../components/common/FormField.jsx';
import TradeSteps from '../components/trade/TradeSteps.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useWallet } from '../hooks/useWallet.js';
import { useStellar } from '../hooks/useStellar.js';
import { useAsync } from '../hooks/useAsync.js';
import { tradesApi } from '../services/api/index.js';
import { sendUSDC } from '../services/stellar/index.js';
import { EXPLORER_ACCOUNT_URL, EXPLORER_TX_URL } from '../config/stellar.js';
import { TRADE_POLL_MS, TRADE_STATUS } from '../constants/trades.js';
import { ROUTES } from '../constants/routes.js';
import { fmtDate, fmtFiat, fmtNumber, shortenAddress } from '../utils/format.js';

// Hash de un pago ya enviado pero aún no registrado en la API (evita pagar dos veces si falla el registro).
const pendingKey = (id) => `luminary:release:${id}`;

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="text-sm text-slate-400">{label}</dt>
      <dd className="text-right text-sm font-medium">{children}</dd>
    </div>
  );
}

function Address({ value }) {
  if (!value) return <span className="text-slate-500">Sin vincular</span>;
  return (
    <a href={EXPLORER_ACCOUNT_URL + value} target="_blank" rel="noreferrer" className="font-mono hover:text-amber-200">
      {shortenAddress(value, 6)} ↗
    </a>
  );
}

export default function Trade() {
  const { id } = useParams();
  const { user } = useAuth();
  const { address, connect, connecting } = useWallet();
  const { data: trade, loading, error, reload, setData } = useAsync(() => tradesApi.getTrade(id), [id]);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [manualHash, setManualHash] = useState('');
  const [pendingHash, setPendingHash] = useState(() => localStorage.getItem(pendingKey(id)));

  const isOpen = trade && ['pending', 'paid'].includes(trade.status);
  const role = trade ? (trade.buyer.id === user.id ? 'buyer' : 'seller') : null;
  const { balance } = useStellar(role === 'seller' && trade?.status === 'paid' ? address : null);

  // Refresco periódico mientras la operación esté abierta (la contraparte puede actuar).
  useEffect(() => {
    if (!isOpen) return undefined;
    const t = setInterval(() => reload({ silent: true }), TRADE_POLL_MS);
    return () => clearInterval(t);
  }, [isOpen, reload]);

  useEffect(() => {
    if (trade && trade.status !== 'paid') {
      localStorage.removeItem(pendingKey(id));
      setPendingHash(null);
    }
  }, [trade, id]);

  if (loading) return <Spinner label="Cargando operación…" />;
  if (error || !trade) {
    return (
      <EmptyState title="Operación no encontrada" text={error?.message}>
        <Link to={ROUTES.myOffers + '?tab=history'} className="text-sm font-medium text-amber-300 hover:text-amber-200">Ver mis operaciones</Link>
      </EmptyState>
    );
  }

  const counterpart = role === 'buyer' ? trade.seller : trade.buyer;
  const sellerAddress = trade.seller.stellarAddress;
  const walletOk = address && address === sellerAddress;
  const insufficient = balance?.hasTrustline && Number(balance.usdc) < trade.usdcAmount;

  const act = async (key, fn, okText) => {
    setBusy(key);
    setNotice(null);
    try {
      const updated = await fn();
      if (updated) setData(updated);
      if (okText) setNotice({ kind: 'ok', text: okText, href: updated?.stellarTxHash ? EXPLORER_TX_URL + updated.stellarTxHash : undefined });
    } catch (err) {
      setNotice({ kind: 'err', text: err.message });
    } finally {
      setBusy(null);
    }
  };

  const register = (hash) => tradesApi.releaseTrade(trade.id, hash);

  /** Vendedor: firma el pago USDC con Freighter y registra el hash en la API. */
  const onRelease = () =>
    act(
      'release',
      async () => {
        if (!window.confirm(`Enviarás ${fmtNumber(trade.usdcAmount, 7)} USDC a ${trade.buyer.displayName}. ¿Confirmas que recibiste ${fmtFiat(trade.fiatAmount, trade.currency)}?`)) return null;
        const res = await sendUSDC(trade.buyer.stellarAddress, trade.usdcAmount);
        localStorage.setItem(pendingKey(trade.id), res.hash);
        setPendingHash(res.hash);
        return register(res.hash);
      },
      'USDC liberados al comprador'
    );

  const onConfirmCancel = () =>
    window.confirm('¿Cancelar la operación? Los USDC reservados vuelven a la oferta.') &&
    act('cancel', () => tradesApi.cancelTrade(trade.id), 'Operación cancelada');

  return (
    <>
      <PageHeader
        title={`Operación #${trade.id}`}
        subtitle={`${role === 'buyer' ? 'Compras' : 'Vendes'} ${fmtNumber(trade.usdcAmount, 7)} USDC a ${counterpart.displayName}`}
        action={<StatusBadge status={trade.status} map={TRADE_STATUS} />}
      />
      {notice && <NoticeBanner notice={notice} onClose={() => setNotice(null)} />}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-6">
          <Card>
            <TradeSteps status={trade.status} />
          </Card>

          <Card title="Siguiente paso">
            {/* ---------------- Comprador ---------------- */}
            {role === 'buyer' && trade.status === 'pending' && (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-slate-300">
                  Envía <strong className="text-white">{fmtFiat(trade.fiatAmount, trade.currency)}</strong> a {trade.seller.displayName} por{' '}
                  <strong className="text-white">{trade.paymentMethod}</strong>
                  {trade.bank && <> ({trade.bank})</>}. Coordina los datos de pago con la contraparte y, cuando hayas pagado, márcalo aquí.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="success" loading={busy === 'paid'} onClick={() => window.confirm('¿Confirmas que ya enviaste el pago fiat?') && act('paid', () => tradesApi.markPaid(trade.id), 'Pago marcado como enviado')}>
                    Ya realicé el pago
                  </Button>
                  <Button variant="secondary" loading={busy === 'cancel'} onClick={onConfirmCancel}>Cancelar</Button>
                </div>
              </div>
            )}
            {role === 'buyer' && trade.status === 'paid' && (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-slate-300">
                  Esperando que {trade.seller.displayName} confirme tu pago y libere los USDC a <Address value={trade.buyer.stellarAddress} />.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" loading={busy === 'dispute'} onClick={() => window.confirm('¿Abrir una disputa?') && act('dispute', () => tradesApi.disputeTrade(trade.id), 'Disputa abierta')}>
                    Abrir disputa
                  </Button>
                  <Button variant="ghost" loading={busy === 'cancel'} onClick={onConfirmCancel}>Cancelar operación</Button>
                </div>
              </div>
            )}

            {/* ---------------- Vendedor ---------------- */}
            {role === 'seller' && trade.status === 'pending' && (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-slate-300">
                  Esperando que {trade.buyer.displayName} envíe <strong className="text-white">{fmtFiat(trade.fiatAmount, trade.currency)}</strong> por {trade.paymentMethod}.
                  Los {fmtNumber(trade.usdcAmount, 7)} USDC quedan reservados de tu oferta mientras tanto.
                </p>
                <div>
                  <Button variant="secondary" loading={busy === 'cancel'} onClick={onConfirmCancel}>Cancelar</Button>
                </div>
              </div>
            )}
            {role === 'seller' && trade.status === 'paid' && (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-slate-300">
                  {trade.buyer.displayName} indica que pagó <strong className="text-white">{fmtFiat(trade.fiatAmount, trade.currency)}</strong>.
                  Verifica que el dinero llegó a tu cuenta y libera los USDC desde tu wallet.
                </p>

                {!sellerAddress ? (
                  <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
                    Vincula tu dirección Stellar en tu <Link to={ROUTES.profile} className="font-semibold underline">perfil</Link> para liberar.
                  </div>
                ) : !address ? (
                  <div>
                    <Button onClick={connect} loading={connecting} loadingText="Conectando…">Conectar Freighter</Button>
                  </div>
                ) : !walletOk ? (
                  <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
                    Freighter está conectada a {shortenAddress(address, 6)}, pero tu cuenta tiene vinculada {shortenAddress(sellerAddress, 6)}. Cambia de cuenta en Freighter.
                  </div>
                ) : pendingHash ? (
                  <div className="rounded-xl border border-sky-400/20 bg-sky-400/10 p-3 text-sm text-sky-100">
                    Ya enviaste el pago (
                    <a href={EXPLORER_TX_URL + pendingHash} target="_blank" rel="noreferrer" className="font-mono underline">{shortenAddress(pendingHash, 6)}</a>
                    ) pero no se pudo registrar. No vuelvas a pagar:
                    <div className="mt-3">
                      <Button loading={busy === 'retry'} onClick={() => act('retry', () => register(pendingHash), 'USDC liberados al comprador')}>Reintentar registro</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {insufficient && <p className="text-sm text-rose-300">Tu balance USDC ({fmtNumber(balance.usdc, 7)}) no alcanza.</p>}
                    <div className="flex flex-wrap gap-2">
                      <Button variant="success" loading={busy === 'release'} loadingText="Firmando en Freighter…" disabled={insufficient} onClick={onRelease}>
                        Enviar {fmtNumber(trade.usdcAmount, 7)} USDC y liberar
                      </Button>
                      <Button variant="secondary" loading={busy === 'dispute'} onClick={() => window.confirm('¿Abrir una disputa?') && act('dispute', () => tradesApi.disputeTrade(trade.id), 'Disputa abierta')}>
                        No recibí el pago
                      </Button>
                    </div>
                  </div>
                )}

                {sellerAddress && !pendingHash && (
                  <details className="text-sm text-slate-400">
                    <summary className="cursor-pointer hover:text-slate-200">¿Ya enviaste los USDC por otro medio? Registra el hash</summary>
                    <form
                      className="mt-3 flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        act('manual', () => register(manualHash.trim().toLowerCase()), 'USDC liberados al comprador');
                      }}
                    >
                      <input value={manualHash} onChange={(e) => setManualHash(e.target.value)} placeholder="Hash de la transacción (64 hex)" pattern="[a-fA-F0-9]{64}" required className={`${INPUT_CLASS} font-mono text-xs`} />
                      <Button type="submit" variant="secondary" loading={busy === 'manual'} className="shrink-0">Registrar</Button>
                    </form>
                  </details>
                )}
              </div>
            )}

            {/* ---------------- Estados finales ---------------- */}
            {trade.status === 'released' && (
              <p className="text-sm text-emerald-200">
                Operación completada. Los USDC fueron enviados a {trade.buyer.displayName}.{' '}
                {trade.stellarTxHash && (
                  <a href={EXPLORER_TX_URL + trade.stellarTxHash} target="_blank" rel="noreferrer" className="underline">Ver transacción ↗</a>
                )}
              </p>
            )}
            {trade.status === 'cancelled' && <p className="text-sm text-slate-400">Operación cancelada. Los USDC reservados volvieron a la oferta.</p>}
            {trade.status === 'disputed' && (
              <p className="text-sm text-rose-200">Operación en disputa. Un moderador revisará el caso (la resolución de disputas aún es manual).</p>
            )}
          </Card>

          <p className="text-xs text-slate-500">
            Flujo tipo escrow: los USDC quedan reservados en la oferta al abrir la operación y el vendedor los libera on-chain
            tras confirmar el pago fiat; el servidor verifica la transacción en Horizon antes de marcarla como completada.
          </p>
        </div>

        <Card title="Detalles">
          <dl className="divide-y divide-white/5">
            <Row label="Monto">{fmtNumber(trade.usdcAmount, 7)} USDC</Row>
            <Row label="Precio">{fmtFiat(trade.price, trade.currency)} / USDC</Row>
            <Row label="Total fiat"><span className="text-lg">{fmtFiat(trade.fiatAmount, trade.currency)}</span></Row>
            <Row label="Método de pago">{trade.paymentMethod}{trade.bank && <span className="block text-xs text-slate-400">{trade.bank}</span>}</Row>
            <Row label="Comprador">{trade.buyer.displayName}{role === 'buyer' && ' (tú)'}<span className="block text-xs"><Address value={trade.buyer.stellarAddress} /></span></Row>
            <Row label="Vendedor">{trade.seller.displayName}{role === 'seller' && ' (tú)'}<span className="block text-xs"><Address value={trade.seller.stellarAddress} /></span></Row>
            <Row label="Abierta">{fmtDate(trade.createdAt)}</Row>
            <Row label="Actualizada">{fmtDate(trade.updatedAt)}</Row>
            {trade.stellarTxHash && (
              <Row label="Transacción">
                <a href={EXPLORER_TX_URL + trade.stellarTxHash} target="_blank" rel="noreferrer" className="font-mono hover:text-amber-200">{shortenAddress(trade.stellarTxHash, 6)} ↗</a>
              </Row>
            )}
          </dl>
        </Card>
      </div>
    </>
  );
}
