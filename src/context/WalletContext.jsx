import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { connectFreighter, getConnectedAddress } from '../services/wallet.js';

const WalletContext = createContext(null);

export function WalletProvider({ children }) {
  const [address, setAddress] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  // Reconexión silenciosa si el sitio ya estaba autorizado
  useEffect(() => {
    getConnectedAddress().then((a) => a && setAddress(a)).catch(() => {});
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      setAddress(await connectFreighter());
    } catch (err) {
      setError(err.message);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => setAddress(null), []);

  return (
    <WalletContext.Provider value={{ address, connecting, error, connect, disconnect, setError }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet debe usarse dentro de <WalletProvider>');
  return ctx;
}
