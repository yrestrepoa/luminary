import {
  Horizon,
  Keypair,
  Asset,
  Operation,
  TransactionBuilder,
  BASE_FEE,
  StrKey,
} from '@stellar/stellar-sdk';
import {
  HORIZON_URL,
  NETWORK_PASSPHRASE,
  FRIENDBOT_URL,
  USDC_CODE,
  USDC_ISSUER,
} from '../config/stellar.js';
import { freighterSigner, getConnectedAddress } from './wallet.js';

export const server = new Horizon.Server(HORIZON_URL);
export const USDC = new Asset(USDC_CODE, USDC_ISSUER);

const isNotFound = (err) => err?.response?.status === 404;

/** Traduce errores de Horizon a mensajes legibles. */
function horizonError(err) {
  const codes = err?.response?.data?.extras?.result_codes;
  if (codes) {
    const ops = codes.operations?.join(', ');
    return new Error(`Transacción fallida: ${codes.transaction}${ops ? ` (${ops})` : ''}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Normaliza el firmante: acepta una clave secreta (S...) o un objeto
 * { publicKey, sign(xdr) => signedXdr } (p.ej. freighterSigner).
 */
function toSigner(secretKeyOrSigner) {
  if (typeof secretKeyOrSigner === 'string') {
    if (!StrKey.isValidEd25519SecretSeed(secretKeyOrSigner)) {
      throw new Error('Clave secreta inválida');
    }
    const kp = Keypair.fromSecret(secretKeyOrSigner);
    return {
      publicKey: kp.publicKey(),
      async sign(xdr) {
        const tx = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);
        tx.sign(kp);
        return tx.toXDR();
      },
    };
  }
  if (secretKeyOrSigner?.publicKey && typeof secretKeyOrSigner.sign === 'function') {
    return secretKeyOrSigner;
  }
  throw new Error('Se requiere una clave secreta o un firmante válido');
}

/** Construye, firma y envía una transacción con las operaciones dadas. */
async function submit(signer, operations) {
  const account = await server.loadAccount(signer.publicKey);
  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  operations.forEach((op) => builder.addOperation(op));
  const tx = builder.setTimeout(180).build();

  const signedXdr = await signer.sign(tx.toXDR());
  const signedTx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  try {
    return await server.submitTransaction(signedTx);
  } catch (err) {
    throw horizonError(err);
  }
}

/**
 * Consulta balances XLM y USDC de una cuenta.
 * @returns {{ funded: boolean, xlm: string, usdc: string|null, hasTrustline: boolean }}
 */
export async function checkBalance(publicKey) {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) throw new Error('Clave pública inválida');
  try {
    const account = await server.loadAccount(publicKey);
    const native = account.balances.find((b) => b.asset_type === 'native');
    const usdc = account.balances.find(
      (b) => b.asset_code === USDC_CODE && b.asset_issuer === USDC_ISSUER
    );
    return {
      funded: true,
      xlm: native?.balance ?? '0',
      usdc: usdc?.balance ?? null,
      hasTrustline: Boolean(usdc),
    };
  } catch (err) {
    if (isNotFound(err)) return { funded: false, xlm: '0', usdc: null, hasTrustline: false };
    throw err;
  }
}

/** Crea la trustline USDC para la cuenta del firmante. */
export async function createTrustline(secretKeyOrSigner) {
  const signer = toSigner(secretKeyOrSigner);
  return submit(signer, [Operation.changeTrust({ asset: USDC })]);
}

/**
 * Envía USDC a `destination`. Por defecto firma con Freighter (cuenta conectada);
 * opcionalmente acepta una clave secreta o firmante como tercer parámetro.
 */
export async function sendUSDC(destination, amount, secretKeyOrSigner) {
  if (!StrKey.isValidEd25519PublicKey(destination)) throw new Error('Dirección de destino inválida');
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error('Monto inválido');

  let signer;
  if (secretKeyOrSigner) {
    signer = toSigner(secretKeyOrSigner);
  } else {
    const address = await getConnectedAddress();
    if (!address) throw new Error('Conecta tu wallet primero');
    signer = freighterSigner(address);
  }

  return submit(signer, [
    Operation.payment({
      destination,
      asset: USDC,
      amount: value.toFixed(7).replace(/\.?0+$/, ''),
    }),
  ]);
}

/** Fondea una cuenta de Testnet con XLM vía Friendbot. */
export async function fundWithFriendbot(publicKey) {
  const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? 'Friendbot no pudo fondear la cuenta');
  }
  return res.json();
}
