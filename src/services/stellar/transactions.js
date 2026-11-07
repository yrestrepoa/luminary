import { Operation, TransactionBuilder, BASE_FEE, StrKey } from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE } from '../../config/stellar.js';
import { freighterSigner, getConnectedAddress } from '../wallet/index.js';
import { toStellarAmount } from '../../utils/format.js';
import { server, USDC } from './client.js';
import { horizonError } from './errors.js';
import { toSigner } from './signer.js';

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
      amount: toStellarAmount(value),
    }),
  ]);
}
