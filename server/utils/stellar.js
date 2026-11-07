import { config } from '../config.js';
import { HttpError, badRequest } from './http.js';

/** "12.5" → 125000000n (stroops, 7 decimales) sin pasar por float. */
export function toStroops(amount) {
  const [int, frac = ''] = String(amount).split('.');
  return BigInt(int) * 10_000_000n + BigInt((frac + '0000000').slice(0, 7));
}

/**
 * Verifica en Horizon que `txHash` sea una transacción exitosa con un pago USDC
 * `from` → `to` por al menos `amount`, posterior a `notBefore`.
 * Lanza 400 si no cumple; 502 si Horizon no responde.
 */
export async function verifyUsdcPayment({ txHash, from, to, amount, notBefore }) {
  const { horizonUrl, usdcCode, usdcIssuer } = config.stellar;
  let res;
  try {
    res = await fetch(`${horizonUrl}/transactions/${txHash}/operations?limit=200`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(502, 'No se pudo consultar Horizon; intenta de nuevo');
  }
  if (res.status === 404) throw badRequest('Transacción no encontrada en Stellar Testnet');
  if (!res.ok) throw new HttpError(502, `Horizon respondió ${res.status}`);

  const ops = (await res.json())?._embedded?.records ?? [];
  const want = toStroops(amount);
  const match = ops.find(
    (op) =>
      op.transaction_successful &&
      op.type === 'payment' &&
      op.asset_code === usdcCode &&
      op.asset_issuer === usdcIssuer &&
      op.from === from &&
      op.to === to &&
      toStroops(op.amount) >= want &&
      new Date(op.created_at) >= new Date(notBefore)
  );
  if (!match) {
    throw badRequest('La transacción no contiene el pago USDC esperado (origen, destino, monto o fecha no coinciden)');
  }
}
