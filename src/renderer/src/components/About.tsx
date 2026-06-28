/** Modal „O programie" — tożsamość produktu i autora (The Best Agency). */
import { Logo } from './Logo'

const APP_VERSION = '1.0.0'
const YEAR = 2026

export function About({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[28rem] max-w-[90vw] rounded-xl border border-white/10 bg-[#0e1830] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-4">
          <Logo className="h-14 w-14" />
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              Infra<span className="text-accent">Design</span>
            </h2>
            <p className="text-xs text-slate-400">CAD do projektowania instalacji budynkowych</p>
          </div>
        </div>

        <div className="mt-5 space-y-1.5 text-sm text-slate-300">
          <div className="flex justify-between"><span className="text-slate-400">Wersja</span><span>{APP_VERSION}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Systemy</span><span>LAN · CCTV (pilot)</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Normy</span><span>PN-EN 50173</span></div>
        </div>

        <hr className="my-4 border-white/10" />

        <p className="text-sm text-slate-300">
          © {YEAR} <span className="font-semibold text-accent">The Best Agency</span>
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Oprogramowanie wspomaga projektanta z uprawnieniami (PIIB) — nie zastępuje autoryzacji projektu.
        </p>

        <button
          onClick={onClose}
          className="mt-5 w-full rounded-lg bg-accent/20 px-3 py-2 text-sm font-medium text-accent hover:bg-accent/30"
        >
          Zamknij
        </button>
      </div>
    </div>
  )
}
