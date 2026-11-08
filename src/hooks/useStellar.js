import { useCallback, useEffect, useState } from 'react';
import { checkBalance, getRecentPayments } from '../services/stellar/index.js';

/**
 * Carga (y permite refrescar) el balance de una cuenta Stellar y, con `withPayments`, sus últimos pagos.
 * balance: import('../types/index.js').AccountBalance | null
 * payments: import('../types/index.js').RecentPayment[] (vacío si no se pidieron)
 * Un fallo al leer los pagos no oculta el balance: se informa en `paymentsError`.
 */
export function useStellar(publicKey, { withPayments = false } = {}) {
  const [balance, setBalance] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [paymentsError, setPaymentsError] = useState(null);

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setBalance(null);
      setPayments([]);
      return;
    }
    setLoading(true);
    setError(null);
    setPaymentsError(null);
    const [bal, pays] = await Promise.allSettled([
      checkBalance(publicKey),
      withPayments ? getRecentPayments(publicKey) : Promise.resolve([]),
    ]);
    if (bal.status === 'fulfilled') setBalance(bal.value);
    else setError(bal.reason.message);
    if (pays.status === 'fulfilled') setPayments(pays.value);
    else setPaymentsError(pays.reason.message);
    setLoading(false);
  }, [publicKey, withPayments]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { balance, payments, loading, error, paymentsError, refresh };
}
