import { Keypair, TransactionBuilder, StrKey } from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE } from '../../config/stellar.js';

/**
 * Normaliza el firmante: acepta una clave secreta (S...) o un objeto
 * { publicKey, sign(xdr) => signedXdr } (p.ej. freighterSigner).
 * @param {string | import('../../types/index.js').Signer} secretKeyOrSigner
 * @returns {import('../../types/index.js').Signer}
 */
export function toSigner(secretKeyOrSigner) {
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
