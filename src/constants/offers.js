/** Filtros del listado de ofertas. */
export const OFFER_FILTERS = [
  { key: 'all', label: 'Todas' },
  { key: 'sell', label: 'Comprar USDC' },
  { key: 'buy', label: 'Vender USDC' },
];

/** Monedas fiat soportadas en el formulario de ofertas (ISO 4217). */
export const FIAT_CURRENCIES = [
  { code: 'COP', label: 'Peso colombiano' },
  { code: 'MXN', label: 'Peso mexicano' },
  { code: 'ARS', label: 'Peso argentino' },
  { code: 'PEN', label: 'Sol peruano' },
  { code: 'CLP', label: 'Peso chileno' },
  { code: 'BRL', label: 'Real brasileño' },
  { code: 'USD', label: 'Dólar estadounidense' },
  { code: 'EUR', label: 'Euro' },
];

export const OFFER_STATUS = {
  active: { label: 'Activa', className: 'bg-emerald-400/10 text-emerald-300' },
  paused: { label: 'Pausada', className: 'bg-amber-400/10 text-amber-300' },
  closed: { label: 'Cerrada', className: 'bg-slate-400/10 text-slate-400' },
};
