/** "12.5" → 125000000n (stroops, 7 decimales) sin pasar por float. */
export function toStroops(amount) {
  const [int, frac = ''] = String(amount).split('.');
  return BigInt(int) * 10_000_000n + BigInt((frac + '0000000').slice(0, 7));
}
