import { StrKey } from '@stellar/stellar-sdk';
import { FRIENDBOT_URL, USDC_CODE, USDC_ISSUER } from '../../config/stellar.js';
import { server } from './client.js';
import { isNotFound } from './errors.js';

/**
 * Consulta balances XLM y USDC de una cuenta.
 * @returns {Promise<import('../../types/index.js').AccountBalance>}
 */
export async function checkBalance(publicKey) {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) throw new Error('Clave pública inválida');
  try {
    const account = await server.loadAccount(publicKey);
    const native = account.balances.find((b) => b.asset_type === 'native');
    const usdc = account.balances.find((b) => b.asset_code === USDC_CODE && b.asset_issuer === USDC_ISSUER);
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

/** Fondea una cuenta de Testnet con XLM vía Friendbot. */
export async function fundWithFriendbot(publicKey) {
  if (!FRIENDBOT_URL) throw new Error('Friendbot solo está disponible en testnet');
  const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? 'Friendbot no pudo fondear la cuenta');
  }
  return res.json();
}
