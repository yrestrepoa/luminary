/** Estados de una operación P2P y su presentación. */
export const TRADE_STATUS = {
  pending: { label: 'Esperando depósito', className: 'bg-sky-400/10 text-sky-300' },
  funded: { label: 'USDC en escrow', className: 'bg-indigo-400/10 text-indigo-300' },
  paid: { label: 'Pago enviado', className: 'bg-amber-400/10 text-amber-300' },
  released: { label: 'Completada', className: 'bg-emerald-400/10 text-emerald-300' },
  refunded: { label: 'Reembolsada', className: 'bg-slate-400/10 text-slate-300' },
  cancelled: { label: 'Cancelada', className: 'bg-slate-400/10 text-slate-400' },
  disputed: { label: 'En disputa', className: 'bg-rose-400/10 text-rose-300' },
};

export const TRADE_FILTERS = [
  { key: 'all', label: 'Todas' },
  { key: 'pending', label: 'Pendientes' },
  { key: 'funded', label: 'En escrow' },
  { key: 'paid', label: 'Pagadas' },
  { key: 'released', label: 'Completadas' },
  { key: 'refunded', label: 'Reembolsadas' },
  { key: 'cancelled', label: 'Canceladas' },
  { key: 'disputed', label: 'Disputas' },
];

/** Pasos del flujo feliz, para el indicador de progreso. */
export const TRADE_STEPS = [
  { key: 'pending', label: 'Operación abierta' },
  { key: 'funded', label: 'USDC en escrow' },
  { key: 'paid', label: 'Pago fiat enviado' },
  { key: 'released', label: 'USDC liberado' },
];

/** Estados con USDC bloqueado en el contrato de escrow. */
export const ESCROWED_STATUSES = ['funded', 'paid', 'disputed'];

/** Polling del detalle de operación (ms). */
export const TRADE_POLL_MS = 10_000;
