export const isNotFound = (err) => err?.response?.status === 404;

/** Traduce errores de Horizon a mensajes legibles. */
export function horizonError(err) {
  const codes = err?.response?.data?.extras?.result_codes;
  if (codes) {
    const ops = codes.operations?.join(', ');
    return new Error(`Transacción fallida: ${codes.transaction}${ops ? ` (${ops})` : ''}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}
