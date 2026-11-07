import { TRADE_STEPS } from '../../constants/trades.js';

/** Indicador de progreso pending → funded → paid → released. */
export default function TradeSteps({ status }) {
  const current = TRADE_STEPS.findIndex((s) => s.key === status);
  const halted = ['cancelled', 'disputed', 'refunded'].includes(status);

  return (
    <ol className="grid grid-cols-4 gap-2">
      {TRADE_STEPS.map((step, i) => {
        const done = !halted && (i < current || status === 'released');
        const active = !halted && i === current && status !== 'released';
        return (
          <li key={step.key} className="flex flex-col gap-2">
            <span className={`h-1.5 rounded-full ${done ? 'bg-emerald-400' : active ? 'bg-amber-300' : 'bg-white/10'}`} />
            <span className={`text-xs ${done || active ? 'text-slate-200' : 'text-slate-500'}`}>
              {done ? '✓ ' : ''}
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
