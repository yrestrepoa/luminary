import { useWallet } from '../../hooks/useWallet.js';
import { shortenAddress } from '../../utils/format.js';

export default function Navbar() {
  const { address, connecting, connect, disconnect } = useWallet();

  return (
    <header className="sticky top-0 z-20 border-b border-white/5 bg-slate-950/80 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-amber-300 to-orange-500 shadow-lg shadow-orange-500/20">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-950" fill="currentColor" aria-hidden>
              <path d="M12 2l2.4 7.6H22l-6.2 4.5 2.4 7.6L12 17.2l-6.2 4.5 2.4-7.6L2 9.6h7.6z" />
            </svg>
          </div>
          <span className="text-lg font-semibold tracking-tight">Luminary</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300 sm:inline-flex">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            Stellar Testnet
          </span>

          {address ? (
            <button
              onClick={disconnect}
              title="Desconectar"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 font-mono text-sm hover:bg-white/10"
            >
              {shortenAddress(address)}
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={connecting}
              className="rounded-xl bg-gradient-to-r from-amber-300 to-orange-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-orange-500/20 transition hover:brightness-110 disabled:opacity-60"
            >
              {connecting ? 'Conectando…' : 'Conectar Wallet'}
            </button>
          )}
        </div>
      </nav>
    </header>
  );
}
