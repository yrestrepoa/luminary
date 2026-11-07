import { useCallback, useEffect, useState } from 'react';
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
import { checkBalance, fundEscrow, latestLedger, refundEscrow, releaseEscrow } from '../services/stellar/index.js';
import { freighterSigner } from '../services/wallet/index.js';
import { EXPLORER_ACCOUNT_URL, EXPLORER_CONTRACT_URL, EXPLORER_TX_URL } from '../config/stellar.js';
import { ESCROWED_STATUSES, TRADE_POLL_MS, TRADE_STATUS } from '../constants/trades.js';
import { ROUTES } from '../constants/routes.js';
import { fmtDate, fmtFiat, fmtNumber, shortenAddress } from '../utils/format.js';

// Tx de escrow ya enviada pero aún no registrada en la API ({ action, hash }): evita repetirla si falla el registro.
const pendingKey = (id) => `luminary:escrow:${id}`;
const SECONDS_PER_LEDGER = 5;

const ACTIONS = {
  fund: { register: tradesApi.fundTrade, ok: 'USDC depositados en escrow', label: 'depósito en escrow' },
  release: { register: tradesApi.releaseTrade, ok: 'USDC liberados al comprador', label: 'liberación' },
  refund: { register: tradesApi.refundTrade, ok: 'USDC devueltos al vendedor', label: 'reembolso' },
};

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

function TxLink({ hash }) {
  return (
    <a href={EXPLORER_TX_URL + hash} target="_blank" rel="noreferrer" className="font-mono hover:text-amber-200">
      {shortenAddress(hash, 6)} ↗
    </a>
  );
}

const Warn = ({ children }) => (
  <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">{children}</div>
);

/** Muestra `children` solo si Freighter está conectada a `required` (la cuenta que debe firmar). */
function WalletGate({ required, children }) {
  const { address, connect, connecting } = useWallet();
  if (!required) {
    return (
      <Warn>
        Vincula tu dirección Stellar en tu{' '}
        <Link to={ROUTES.profile} className="font-semibold underline">
          perfil
        </Link>{' '}
        para continuar.
      </Warn>
    );
  }
  if (!address) {
    return (
      <div>
        <Button onClick={connect} loading={connecting} loadingText="Conectando…">
          Conectar Freighter
        </Button>
      </div>
    );
  }
  if (address !== required) {
    return (
      <Warn>
        Freighter está conectada a {shortenAddress(address, 6)}, pero esta acción debe firmarla{' '}
        {shortenAddress(required, 6)}. Cambia de cuenta en Freighter.
      </Warn>
    );
  }
  return children;
}

export default function Trade() {
  const { id } = useParams();
  const { user } = useAuth();
  const { address } = useWallet();
  const { data: trade, loading, error, reload, setData } = useAsync(() => tradesApi.getTrade(id), [id]);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [manualHash, setManualHash] = useState('');
  const [pendingTx, setPendingTx] = useState(() => JSON.parse(localStorage.getItem(pendingKey(id)) ?? 'null'));
  const [buyerTrustline, setBuyerTrustline] = useState(null);
  const [ledger, setLedger] = useState(null);

  const isOpen = trade && ['pending', ...ESCROWED_STATUSES].includes(trade.status);
  const escrowed = trade && ESCROWED_STATUSES.includes(trade.status);
  const role = trade ? (trade.buyer.id === user.id ? 'buyer' : 'seller') : null;
  const { balance } = useStellar(role === 'seller' && trade?.status === 'pending' ? address : null);

  const savePending = useCallback(
    (value) => {
      if (value) localStorage.setItem(pendingKey(id), JSON.stringify(value));
      else localStorage.removeItem(pendingKey(id));
      setPendingTx(value);
    },
    [id]
  );

  // Refresco periódico mientras la operación esté abierta (la contraparte puede actuar).
  useEffect(() => {
    if (!isOpen) return undefined;
    const t = setInterval(() => reload({ silent: true }), TRADE_POLL_MS);
    return () => clearInterval(t);
  }, [isOpen, reload]);

  // Una tx pendiente deja de aplicar si la operación ya avanzó (la registró la contraparte, otra pestaña…).
  useEffect(() => {
    if (!trade || !pendingTx) return;
    const stillValid =
      pendingTx.action === 'fund' ? trade.status === 'pending' : ESCROWED_STATUSES.includes(trade.status);
    if (!stillValid) savePending(null);
  }, [trade, pendingTx, savePending]);

  // Antes de depositar: el comprador necesita trustline USDC o la liberación fallaría on-chain.
  const buyerAddress = trade?.buyer.stellarAddress;
  useEffect(() => {
    if (role !== 'seller' || trade?.status !== 'pending' || !buyerAddress) return;
    checkBalance(buyerAddress)
      .then((b) => setBuyerTrustline(b.hasTrustline))
      .catch(() => setBuyerTrustline(null));
  }, [role, trade?.status, buyerAddress]);

  // Ledger actual: para saber cuándo puede reclamar el vendedor.
  useEffect(() => {
    if (!escrowed || role !== 'seller') return;
    latestLedger()
      .then(setLedger)
      .catch(() => setLedger(null));
  }, [escrowed, role, trade?.updatedAt]);

  if (loading) return <Spinner label="Cargando operación…" />;
  if (error || !trade) {
    return (
      <EmptyState title="Operación no encontrada" text={error?.message}>
        <Link to={ROUTES.myOffers + '?tab=history'} className="text-sm font-medium text-amber-300 hover:text-amber-200">
          Ver mis operaciones
        </Link>
      </EmptyState>
    );
  }

  const { escrow } = trade;
  const counterpart = role === 'buyer' ? trade.seller : trade.buyer;
  const escrowSeller = escrow.seller ?? trade.seller.stellarAddress;
  const escrowBuyer = escrow.buyer ?? trade.buyer.stellarAddress;
  const usdc = `${fmtNumber(trade.usdcAmount, 7)} USDC`;
  const insufficient = balance?.hasTrustline && Number(balance.usdc) < trade.usdcAmount;
  const canReclaim = escrow.refundAfterLedger !== null && ledger !== null && ledger >= escrow.refundAfterLedger;
  const reclaimEta =
    escrow.refundAfterLedger !== null && ledger !== null && !canReclaim
      ? Math.ceil(((escrow.refundAfterLedger - ledger) * SECONDS_PER_LEDGER) / 3600)
      : null;

  const act = async (key, fn, okText) => {
    setBusy(key);
    setNotice(null);
    try {
      const updated = await fn();
      if (updated) setData(updated);
      if (okText && updated) {
        const hash = updated.stellarTxHash ?? updated.escrow?.fundTxHash;
        setNotice({ kind: 'ok', text: okText, href: hash ? EXPLORER_TX_URL + hash : undefined });
      }
    } catch (err) {
      setNotice({ kind: 'err', text: err.message });
    } finally {
      setBusy(null);
    }
  };

  /** Registra en la API una tx de escrow ya confirmada (la API la verifica on-chain). */
  const register = async (action, hash) => {
    const updated = await ACTIONS[action].register(trade.id, hash);
    savePending(null);
    return updated;
  };

  /** Firma con Freighter la acción on-chain, guarda el hash al enviarse y lo registra en la API. */
  const runEscrow = (action, confirmText, chainCall) =>
    act(
      action,
      async () => {
        if (!window.confirm(confirmText)) return null;
        if (!escrow.contractId) throw new Error('El escrow on-chain no está configurado en el servidor');
        const signer = freighterSigner(address);
        const { hash } = await chainCall(signer, { onSubmitted: (h) => savePending({ action, hash: h }) });
        return register(action, hash);
      },
      ACTIONS[action].ok
    );

  const onFund = () =>
    runEscrow(
      'fund',
      `Depositarás ${usdc} en el contrato de escrow. Solo podrás recuperarlos si el comprador cancela o tras el plazo de reembolso (~24 h). ¿Continuar?`,
      (signer, opts) =>
        fundEscrow(
          {
            contractId: escrow.contractId,
            tokenId: escrow.tokenId,
            seller: trade.seller.stellarAddress,
            buyer: trade.buyer.stellarAddress,
            amountStroops: escrow.amountStroops,
            tradeId: escrow.tradeId,
          },
          signer,
          opts
        )
    );

  const onRelease = () =>
    runEscrow(
      'release',
      `El contrato enviará ${usdc} a ${trade.buyer.displayName}. ¿Confirmas que recibiste ${fmtFiat(trade.fiatAmount, trade.currency)}?`,
      (signer, opts) =>
        releaseEscrow({ contractId: escrow.contractId, seller: escrowSeller, tradeId: escrow.tradeId }, signer, opts)
    );

  const onRefund = () =>
    runEscrow(
      'refund',
      role === 'buyer'
        ? `Cancelarás la operación y el contrato devolverá ${usdc} a ${trade.seller.displayName}. No lo hagas si ya enviaste el pago fiat. ¿Continuar?`
        : `Reclamarás los ${usdc} del escrow (plazo vencido). ¿Continuar?`,
      (signer, opts) =>
        refundEscrow(
          { contractId: escrow.contractId, caller: address, seller: escrowSeller, tradeId: escrow.tradeId },
          signer,
          opts
        )
    );

  const onConfirmCancel = () =>
    window.confirm('¿Cancelar la operación? Los USDC reservados vuelven a la oferta.') &&
    act('cancel', () => tradesApi.cancelTrade(trade.id), 'Operación cancelada');

  const onDispute = () =>
    window.confirm('¿Abrir una disputa?') && act('dispute', () => tradesApi.disputeTrade(trade.id), 'Disputa abierta');

  // Acción on-chain que el usuario puede registrar a mano (tx enviada desde otra herramienta).
  const manualAction =
    role === 'seller'
      ? trade.status === 'pending'
        ? 'fund'
        : escrowed
          ? 'release'
          : null
      : escrowed
        ? 'refund'
        : null;

  const reclaimBlock = role === 'seller' && escrowed && (
    <div className="flex flex-col gap-2 border-t border-white/5 pt-4">
      <p className="text-xs text-slate-400">
        {canReclaim
          ? 'El plazo de reembolso venció: puedes recuperar los USDC del escrow si la operación no se completó.'
          : `Podrás reclamar los USDC si la operación no avanza${reclaimEta !== null ? ` (en ~${reclaimEta} h, ledger ${escrow.refundAfterLedger})` : ' tras el plazo de reembolso (~24 h desde el depósito)'}.`}
      </p>
      {canReclaim && (
        <WalletGate required={escrowSeller}>
          <div>
            <Button
              variant="secondary"
              loading={busy === 'refund'}
              loadingText="Firmando en Freighter…"
              onClick={onRefund}
            >
              Reclamar USDC del escrow
            </Button>
          </div>
        </WalletGate>
      )}
    </div>
  );

  return (
    <>
      <PageHeader
        title={`Operación #${trade.id}`}
        subtitle={`${role === 'buyer' ? 'Compras' : 'Vendes'} ${usdc} a ${counterpart.displayName}`}
        action={<StatusBadge status={trade.status} map={TRADE_STATUS} />}
      />
      {notice && <NoticeBanner notice={notice} onClose={() => setNotice(null)} />}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-6">
          <Card>
            <TradeSteps status={trade.status} />
          </Card>

          <Card title="Siguiente paso">
            {pendingTx && ACTIONS[pendingTx.action] ? (
              <div className="rounded-xl border border-sky-400/20 bg-sky-400/10 p-3 text-sm text-sky-100">
                Ya enviaste la transacción de {ACTIONS[pendingTx.action].label} (<TxLink hash={pendingTx.hash} />
                ), pero no se pudo registrar. No la repitas:
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    loading={busy === 'retry'}
                    onClick={() =>
                      act('retry', () => register(pendingTx.action, pendingTx.hash), ACTIONS[pendingTx.action].ok)
                    }
                  >
                    Reintentar registro
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      window.confirm('¿Descartar? Solo si la transacción falló on-chain.') && savePending(null)
                    }
                  >
                    Descartar
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {/* ---------------- Comprador ---------------- */}
                {role === 'buyer' && trade.status === 'pending' && (
                  <div className="flex flex-col gap-4">
                    <p className="text-sm text-slate-300">
                      Esperando que {trade.seller.displayName} deposite los {usdc} en el contrato de escrow.{' '}
                      <strong className="text-white">No envíes el pago fiat todavía.</strong>
                    </p>
                    <div>
                      <Button variant="secondary" loading={busy === 'cancel'} onClick={onConfirmCancel}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
                {role === 'buyer' && trade.status === 'funded' && (
                  <div className="flex flex-col gap-4">
                    <p className="text-sm text-slate-300">
                      Los {usdc} están bloqueados en el escrow on-chain. Envía{' '}
                      <strong className="text-white">{fmtFiat(trade.fiatAmount, trade.currency)}</strong> a{' '}
                      {trade.seller.displayName} por <strong className="text-white">{trade.paymentMethod}</strong>
                      {trade.bank && <> ({trade.bank})</>} y márcalo aquí cuando hayas pagado.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="success"
                        loading={busy === 'paid'}
                        onClick={() =>
                          window.confirm('¿Confirmas que ya enviaste el pago fiat?') &&
                          act('paid', () => tradesApi.markPaid(trade.id), 'Pago marcado como enviado')
                        }
                      >
                        Ya realicé el pago
                      </Button>
                    </div>
                    <details className="text-sm text-slate-400">
                      <summary className="cursor-pointer hover:text-slate-200">
                        ¿Quieres cancelar? Devuelve los USDC al vendedor
                      </summary>
                      <div className="mt-3">
                        <WalletGate required={escrowBuyer}>
                          <Button
                            variant="secondary"
                            loading={busy === 'refund'}
                            loadingText="Firmando en Freighter…"
                            onClick={onRefund}
                          >
                            Cancelar y reembolsar al vendedor
                          </Button>
                        </WalletGate>
                      </div>
                    </details>
                  </div>
                )}
                {role === 'buyer' && (trade.status === 'paid' || trade.status === 'disputed') && (
                  <div className="flex flex-col gap-4">
                    <p className="text-sm text-slate-300">
                      {trade.status === 'paid' ? (
                        <>
                          Esperando que {trade.seller.displayName} confirme tu pago y libere los USDC del escrow a{' '}
                          <Address value={escrowBuyer} />.
                        </>
                      ) : (
                        <>
                          Operación en disputa. Los USDC siguen en el escrow; el vendedor aún puede liberarlos y tú
                          puedes desistir devolviéndoselos.
                        </>
                      )}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {trade.status === 'paid' && (
                        <Button variant="secondary" loading={busy === 'dispute'} onClick={onDispute}>
                          Abrir disputa
                        </Button>
                      )}
                    </div>
                    <details className="text-sm text-slate-400">
                      <summary className="cursor-pointer hover:text-slate-200">
                        Desistir: devolver los USDC al vendedor
                      </summary>
                      <div className="mt-3">
                        <WalletGate required={escrowBuyer}>
                          <Button
                            variant="ghost"
                            loading={busy === 'refund'}
                            loadingText="Firmando en Freighter…"
                            onClick={onRefund}
                          >
                            Reembolsar al vendedor
                          </Button>
                        </WalletGate>
                      </div>
                    </details>
                  </div>
                )}

                {/* ---------------- Vendedor ---------------- */}
                {role === 'seller' && trade.status === 'pending' && (
                  <div className="flex flex-col gap-4">
                    <p className="text-sm text-slate-300">
                      Deposita los {usdc} en el contrato de escrow. Quedan bloqueados on-chain hasta que los liberes a{' '}
                      {trade.buyer.displayName} (tras recibir {fmtFiat(trade.fiatAmount, trade.currency)}) o se
                      reembolsen.
                    </p>
                    {buyerTrustline === false && (
                      <Warn>
                        {trade.buyer.displayName} aún no tiene trustline USDC en{' '}
                        {shortenAddress(trade.buyer.stellarAddress, 6)}: no podría recibir los USDC. Pídele que la cree
                        antes de depositar.
                      </Warn>
                    )}
                    <WalletGate required={trade.seller.stellarAddress}>
                      <div className="flex flex-col gap-2">
                        {insufficient && (
                          <p className="text-sm text-rose-300">
                            Tu balance USDC ({fmtNumber(balance.usdc, 7)}) no alcanza.
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="success"
                            loading={busy === 'fund'}
                            loadingText="Firmando en Freighter…"
                            disabled={insufficient || buyerTrustline === false}
                            onClick={onFund}
                          >
                            Depositar {usdc} en escrow
                          </Button>
                          <Button variant="secondary" loading={busy === 'cancel'} onClick={onConfirmCancel}>
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    </WalletGate>
                  </div>
                )}
                {role === 'seller' && trade.status === 'funded' && (
                  <div className="flex flex-col gap-4">
                    <p className="text-sm text-slate-300">
                      Los {usdc} están en escrow. Esperando que {trade.buyer.displayName} envíe{' '}
                      <strong className="text-white">{fmtFiat(trade.fiatAmount, trade.currency)}</strong> por{' '}
                      {trade.paymentMethod}.
                    </p>
                    {reclaimBlock}
                  </div>
                )}
                {role === 'seller' && (trade.status === 'paid' || trade.status === 'disputed') && (
                  <div className="flex flex-col gap-4">
                    <p className="text-sm text-slate-300">
                      {trade.status === 'paid' ? (
                        <>
                          {trade.buyer.displayName} indica que pagó{' '}
                          <strong className="text-white">{fmtFiat(trade.fiatAmount, trade.currency)}</strong>. Verifica
                          que el dinero llegó a tu cuenta y libera los USDC del escrow.
                        </>
                      ) : (
                        <>Operación en disputa (la resolución aún es manual). Si recibiste el pago, libera los USDC.</>
                      )}
                    </p>
                    <WalletGate required={escrowSeller}>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="success"
                          loading={busy === 'release'}
                          loadingText="Firmando en Freighter…"
                          onClick={onRelease}
                        >
                          Liberar {usdc} al comprador
                        </Button>
                        {trade.status === 'paid' && (
                          <Button variant="secondary" loading={busy === 'dispute'} onClick={onDispute}>
                            No recibí el pago
                          </Button>
                        )}
                      </div>
                    </WalletGate>
                    {reclaimBlock}
                  </div>
                )}

                {manualAction && (
                  <details className="mt-4 text-sm text-slate-400">
                    <summary className="cursor-pointer hover:text-slate-200">
                      ¿Enviaste la transacción de {ACTIONS[manualAction].label} con otra herramienta? Registra el hash
                    </summary>
                    <form
                      className="mt-3 flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        act(
                          'manual',
                          () => register(manualAction, manualHash.trim().toLowerCase()),
                          ACTIONS[manualAction].ok
                        );
                      }}
                    >
                      <input
                        value={manualHash}
                        onChange={(e) => setManualHash(e.target.value)}
                        placeholder="Hash de la transacción (64 hex)"
                        pattern="[a-fA-F0-9]{64}"
                        required
                        className={`${INPUT_CLASS} font-mono text-xs`}
                      />
                      <Button type="submit" variant="secondary" loading={busy === 'manual'} className="shrink-0">
                        Registrar
                      </Button>
                    </form>
                  </details>
                )}
              </>
            )}

            {/* ---------------- Estados finales ---------------- */}
            {trade.status === 'released' && (
              <p className="text-sm text-emerald-200">
                Operación completada. El escrow envió los USDC a {trade.buyer.displayName}.{' '}
                {trade.stellarTxHash && (
                  <a
                    href={EXPLORER_TX_URL + trade.stellarTxHash}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Ver transacción ↗
                  </a>
                )}
              </p>
            )}
            {trade.status === 'refunded' && (
              <p className="text-sm text-slate-300">
                Operación reembolsada: el escrow devolvió los USDC a {trade.seller.displayName} y volvieron a la oferta.{' '}
                {trade.stellarTxHash && (
                  <a
                    href={EXPLORER_TX_URL + trade.stellarTxHash}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Ver transacción ↗
                  </a>
                )}
              </p>
            )}
            {trade.status === 'cancelled' && (
              <p className="text-sm text-slate-400">Operación cancelada. Los USDC reservados volvieron a la oferta.</p>
            )}
          </Card>

          <p className="text-xs text-slate-500">
            Escrow on-chain: el vendedor deposita los USDC en un contrato Soroban antes de que el comprador pague. Solo
            el vendedor puede liberarlos al comprador; el comprador puede desistir devolviéndolos, y el vendedor puede
            reclamarlos tras ~24 h si la operación no se completa. El servidor verifica cada paso en la red antes de
            actualizar la operación.
          </p>
        </div>

        <Card title="Detalles">
          <dl className="divide-y divide-white/5">
            <Row label="Monto">{usdc}</Row>
            <Row label="Precio">{fmtFiat(trade.price, trade.currency)} / USDC</Row>
            <Row label="Total fiat">
              <span className="text-lg">{fmtFiat(trade.fiatAmount, trade.currency)}</span>
            </Row>
            <Row label="Método de pago">
              {trade.paymentMethod}
              {trade.bank && <span className="block text-xs text-slate-400">{trade.bank}</span>}
            </Row>
            <Row label="Comprador">
              {trade.buyer.displayName}
              {role === 'buyer' && ' (tú)'}
              <span className="block text-xs">
                <Address value={trade.buyer.stellarAddress} />
              </span>
            </Row>
            <Row label="Vendedor">
              {trade.seller.displayName}
              {role === 'seller' && ' (tú)'}
              <span className="block text-xs">
                <Address value={trade.seller.stellarAddress} />
              </span>
            </Row>
            <Row label="Abierta">{fmtDate(trade.createdAt)}</Row>
            <Row label="Actualizada">{fmtDate(trade.updatedAt)}</Row>
            {escrow.contractId && (
              <Row label="Contrato escrow">
                <a
                  href={EXPLORER_CONTRACT_URL + escrow.contractId}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono hover:text-amber-200"
                >
                  {shortenAddress(escrow.contractId, 6)} ↗
                </a>
              </Row>
            )}
            {escrow.fundTxHash && (
              <Row label="Depósito">
                <TxLink hash={escrow.fundTxHash} />
              </Row>
            )}
            {trade.stellarTxHash && (
              <Row label={trade.status === 'refunded' ? 'Reembolso' : 'Liberación'}>
                <TxLink hash={trade.stellarTxHash} />
              </Row>
            )}
          </dl>
        </Card>
      </div>
    </>
  );
}
