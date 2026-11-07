/** Formatea un monto en moneda fiat (locale es-CO). */
export const fmtFiat = (value, currency) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);

/** Formatea un número con hasta `d` decimales (locale es-CO). */
export const fmtNumber = (v, d = 2) => Number(v).toLocaleString('es-CO', { maximumFractionDigits: d });

/** Acorta una dirección Stellar: primeros y últimos `n` caracteres. */
export const shortenAddress = (a, n = 4) => `${a.slice(0, n)}…${a.slice(-n)}`;

/** Convierte un monto numérico al string de hasta 7 decimales que espera Stellar. */
export const toStellarAmount = (value) => value.toFixed(7).replace(/\.?0+$/, '');

/** Fecha/hora corta en locale es-CO. */
export const fmtDate = (value) =>
  new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
