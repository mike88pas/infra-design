import { useState } from 'react'
import type { ProjectBundle } from '../../domain/model/schema'

type Status = { kind: 'idle' | 'ok' | 'err'; text: string }

export default function App() {
  const [bundle, setBundle] = useState<ProjectBundle | null>(null)
  const [filePath, setFilePath] = useState<string | undefined>(undefined)
  const [sidecarInfo, setSidecarInfo] = useState<string>('—')
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: 'Gotowy' })

  async function ping() {
    setStatus({ kind: 'idle', text: 'Łączę z sidecarem…' })
    try {
      const res = await window.infra.sidecar.ping()
      setSidecarInfo(`ezdxf ${res.ezdxf} · Python ${res.python}`)
      setStatus({ kind: 'ok', text: 'Sidecar odpowiada (handshake OK)' })
    } catch (e) {
      setSidecarInfo('niedostępny')
      setStatus({ kind: 'err', text: `Sidecar: ${(e as Error).message}` })
    }
  }

  async function newProject() {
    const b = await window.infra.project.new('Projekt instalacji')
    setBundle(b)
    setFilePath(undefined)
    setStatus({ kind: 'ok', text: `Utworzono projekt (schema v${b.project.schemaVersion})` })
  }

  async function save() {
    if (!bundle) return
    try {
      const res = await window.infra.project.save(bundle, filePath)
      if (res.saved) {
        setFilePath(res.filePath)
        setStatus({ kind: 'ok', text: `Zapisano: ${res.filePath}` })
      } else {
        setStatus({ kind: 'idle', text: 'Zapis anulowany' })
      }
    } catch (e) {
      setStatus({ kind: 'err', text: `Błąd zapisu: ${(e as Error).message}` })
    }
  }

  async function open() {
    try {
      const res = await window.infra.project.open()
      if (res.opened && res.bundle) {
        setBundle(res.bundle)
        setFilePath(res.filePath)
        setStatus({ kind: 'ok', text: `Wczytano: ${res.filePath}` })
      } else {
        setStatus({ kind: 'idle', text: 'Otwieranie anulowane' })
      }
    } catch (e) {
      setStatus({ kind: 'err', text: `Błąd odczytu: ${(e as Error).message}` })
    }
  }

  const statusColor =
    status.kind === 'ok' ? 'text-emerald-400' : status.kind === 'err' ? 'text-rose-400' : 'text-slate-400'

  return (
    <div className="flex h-full flex-col bg-ink text-slate-100">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Infra<span className="text-accent">Design</span>
          </h1>
          <p className="text-xs text-slate-400">Projektowanie instalacji budynkowych · F0 scaffold</p>
        </div>
        <span className="rounded bg-white/5 px-2 py-1 text-xs text-slate-400">sidecar: {sidecarInfo}</span>
      </header>

      <main className="flex flex-1 gap-6 p-6">
        <section className="w-72 shrink-0 space-y-3">
          <button onClick={ping} className="w-full rounded bg-accent/20 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/30">
            Test sidecara (ping)
          </button>
          <button onClick={newProject} className="w-full rounded bg-white/10 px-4 py-2 text-sm hover:bg-white/15">
            Nowy projekt
          </button>
          <button onClick={save} disabled={!bundle} className="w-full rounded bg-white/10 px-4 py-2 text-sm hover:bg-white/15 disabled:opacity-30">
            Zapisz (.infra)
          </button>
          <button onClick={open} className="w-full rounded bg-white/10 px-4 py-2 text-sm hover:bg-white/15">
            Otwórz (.infra)
          </button>
        </section>

        <section className="flex-1 rounded-lg border border-white/10 bg-panel p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">Stan projektu</h2>
          {bundle ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <dt className="text-slate-400">Nazwa</dt>
              <dd>{bundle.project.name}</dd>
              <dt className="text-slate-400">ID</dt>
              <dd className="font-mono text-xs">{bundle.project.id}</dd>
              <dt className="text-slate-400">Jednostki</dt>
              <dd>{bundle.project.units}</dd>
              <dt className="text-slate-400">Systemy</dt>
              <dd>{bundle.project.activeSystems.join(', ')}</dd>
              <dt className="text-slate-400">Wertykały</dt>
              <dd>{bundle.project.activeVerticals.join(', ')}</dd>
              <dt className="text-slate-400">Schema</dt>
              <dd>v{bundle.project.schemaVersion}</dd>
              <dt className="text-slate-400">Plik</dt>
              <dd className="truncate font-mono text-xs">{filePath ?? '— niezapisany —'}</dd>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">Brak projektu. Kliknij „Nowy projekt".</p>
          )}
        </section>
      </main>

      <footer className={`border-t border-white/10 px-6 py-2 text-xs ${statusColor}`}>{status.text}</footer>
    </div>
  )
}
