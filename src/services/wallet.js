import {
  isConnected,
  isAllowed,
  requestAccess,
  getAddress,
  getNetwork,
  signTransaction,
} from '@stellar/freighter-api';
import { NETWORK_PASSPHRASE } from '../config/stellar.js';

/**
 * Conecta la extensión Freighter y devuelve la clave pública del usuario.
 * Lanza un Error con mensaje legible si algo falla.
 */
export async function connectFreighter() {
  const conn = await isConnected();
  if (conn.error || !conn.isConnected) {
    throw new Error('Freighter no está instalada. Instálala desde https://freighter.app');
  }

  const access = await requestAccess();
  if (access.error) {
    throw new Error(`Acceso denegado: ${access.error.message ?? access.error}`);
  }

  const net = await getNetwork();
  if (!net.error && net.networkPassphrase !== NETWORK_PASSPHRASE) {
    throw new Error('Freighter no está en Testnet. Cambia la red a "Testnet" en la extensión.');
  }

  return access.address;
}

/** Devuelve la dirección si el sitio ya fue autorizado previamente (sin abrir popup). */
export async function getConnectedAddress() {
  const conn = await isConnected();
  if (conn.error || !conn.isConnected) return null;
  const allowed = await isAllowed();
  if (allowed.error || !allowed.isAllowed) return null;
  const { address, error } = await getAddress();
  return error || !address ? null : address;
}

/**
 * Firmante basado en Freighter, compatible con services/stellar.js.
 * Interfaz: { publicKey, sign(xdr) => Promise<signedXdr> }
 */
export function freighterSigner(publicKey) {
  return {
    publicKey,
    async sign(xdr) {
      const res = await signTransaction(xdr, {
        networkPassphrase: NETWORK_PASSPHRASE,
        address: publicKey,
      });
      if (res.error) throw new Error(`Firma rechazada: ${res.error.message ?? res.error}`);
      return res.signedTxXdr;
    },
  };
}
