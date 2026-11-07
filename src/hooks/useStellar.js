import { useCallback, useEffect, useState } from 'react';
import { checkBalance } from '../services/stellar/index.js';

/**
 * Carga (y permite refrescar) el balance de una cuenta Stellar.
 * balance: import('../types/index.js').AccountBalance | null
 */
export function useStellar(publicKey) {
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setBalance(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setBalance(await checkBalance(publicKey));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { balance, loading, error, refresh };
}
