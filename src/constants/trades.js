/** Estados de una operación P2P y su presentación. */
export const TRADE_STATUS = {
  pending: { label: 'Esperando pago', className: 'bg-sky-400/10 text-sky-300' },
  paid: { label: 'Pago enviado', className: 'bg-amber-400/10 text-amber-300' },
  released: { label: 'Completada', className: 'bg-emerald-400/10 text-emerald-300' },
  cancelled: { label: 'Cancelada', className: 'bg-slate-400/10 text-slate-400' },
  disputed: { label: 'En disputa', className: 'bg-rose-400/10 text-rose-300' },
};

export const TRADE_FILTERS = [
  { key: 'all', label: 'Todas' },
  { key: 'pending', label: 'Pendientes' },
  { key: 'paid', label: 'Pagadas' },
  { key: 'released', label: 'Completadas' },
  { key: 'cancelled', label: 'Canceladas' },
  { key: 'disputed', label: 'Disputas' },
];

/** Pasos del flujo feliz, para el indicador de progreso. */
export const TRADE_STEPS = [
  { key: 'pending', label: 'Operación abierta' },
  { key: 'paid', label: 'Pago fiat enviado' },
  { key: 'released', label: 'USDC liberado' },
];

/** Polling del detalle de operación (ms). */
export const TRADE_POLL_MS = 10_000;
