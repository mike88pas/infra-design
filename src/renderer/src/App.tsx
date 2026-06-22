import { useMemo, useRef, useState } from 'react'
import type { DxfDocument, ProjectBundle } from '../../domain/model/schema'
import { CadViewer } from '@core/cad/CadViewer'
import { polygonsToSpaces, type CadScene, type RenderSpace } from '@core/cad'
import {
  guessLayerRoles,
  guessWallLayers,
  type LayerRole
} from '../../domain/dxf/layerMapping'

type Status = { kind: 'idle' | 'ok' | 'err'; text: string }

const ROLE_LABELS: Record<LayerRole, string> = {
  walls: 'ściany',
  doors: 'drzwi',
  windows: 'okna',
  rooms: 'pomieszcz.',
  text: 'opisy',
  other: 'inne'
}

export default function App(): JSX.Element {
  const [bundle, setBundle] = useState<ProjectBundle | null>(null)
  const [filePath, setFilePath] = useState<string | undefined>(undefined)
  const [sidecarInfo, setSidecarInfo] = useState<string>('—')
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: 'Gotowy' })

  const [doc, setDoc] = useState<DxfDocument | null>(null)
  const [dxfPath, setDxfPath] = useState<string | null>(null)
  const [spaces, setSpaces] = useState<RenderSpace[]>([])
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({})
  const [layerRoles, setLayerRoles] = useState<Record<string, LayerRole>>({})
  const [hovered, setHovered] = useState<RenderSpace | null>(null)

  const [measured, setMeasured] = useState<number | null>(null)
  const [realInput, setRealInput] = useState('')
  const [unitMm, setUnitMm] = useState<number | null>(null)

  const sceneRef = useRef<CadScene | null>(null)

  const totalArea = useMemo(
    () => spaces.reduce((s, sp) => s + sp.area, 0) / 1_000_000,
    [spaces]
  )

  async function ping(): Promise<void> {
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

  async function newProject(): Promise<void> {
    const b = await window.infra.project.new('Projekt instalacji')
    setBundle(b)
    setFilePath(undefined)
    setStatus({ kind: 'ok', text: `Utworzono projekt (schema v${b.project.schemaVersion})` })
  }

  async function save(): Promise<void> {
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

  async function open(): Promise<void> {
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

  async function importDxf(): Promise<void> {
    setStatus({ kind: 'idle', text: 'Wczytuję DXF…' })
    try {
      const res = await window.infra.dxf.import()
      if (!res.imported || !res.doc || !res.filePath) {
        setStatus({ kind: 'idle', text: 'Import anulowany' })
        return
      }
      const d = res.doc
      setDoc(d)
      setDxfPath(res.filePath)
      setLayerVisibility(Object.fromEntries(d.layers.map((l) => [l.name, l.visible])))
      const roles = guessLayerRoles(d.layers)
      setLayerRoles(roles)
      setSpaces([])
      setUnitMm(null)
      setMeasured(null)
      const trunc = d.truncated ? ` (przycięto ${d.truncated})` : ''
      setStatus({
        kind: 'ok',
        text: `Wczytano DXF: ${d.layers.length} warstw, ${d.entityCount} encji${trunc}`
      })
      await detectSpaces(res.filePath, d)
    } catch (e) {
      setStatus({ kind: 'err', text: `Import DXF: ${(e as Error).message}` })
    }
  }

  async function detectSpaces(path: string, d: DxfDocument): Promise<void> {
    setStatus({ kind: 'idle', text: 'Wykrywam pomieszczenia…' })
    try {
      const wallLayers = guessWallLayers(d.layers)
      const res = await window.infra.dxf.polygonize({ path, wallLayers })
      const sp = polygonsToSpaces(res.polygons)
      setSpaces(sp)
      setStatus({
        kind: 'ok',
        text: `Wykryto ${sp.length} pomieszczeń${wallLayers.length ? ` (warstwy: ${wallLayers.join(', ')})` : ' (wszystkie warstwy)'}`
      })
    } catch (e) {
      setStatus({ kind: 'err', text: `Polygonize: ${(e as Error).message}` })
    }
  }

  function toggleLayer(name: string): void {
    setLayerVisibility((v) => ({ ...v, [name]: !v[name] }))
  }

  function setRole(name: string, role: LayerRole): void {
    setLayerRoles((r) => ({ ...r, [name]: role }))
  }

  async function redetectWithRoles(): Promise<void> {
    if (!dxfPath || !doc) return
    const wallLayers = Object.entries(layerRoles)
      .filter(([, r]) => r === 'walls')
      .map(([n]) => n)
    setStatus({ kind: 'idle', text: 'Wykrywam pomieszczenia…' })
    try {
      const res = await window.infra.dxf.polygonize({ path: dxfPath, wallLayers })
      setSpaces(polygonsToSpaces(res.polygons))
      setStatus({ kind: 'ok', text: `Wykryto ${res.polygons.length} pomieszczeń` })
    } catch (e) {
      setStatus({ kind: 'err', text: `Polygonize: ${(e as Error).message}` })
    }
  }

  function startCalibration(): void {
    const scene = sceneRef.current
    if (!scene) return
    setStatus({ kind: 'idle', text: 'Kalibracja: kliknij dwa punkty o znanej odległości' })
    scene.startMeasure((modelDist) => {
      setMeasured(modelDist)
      setStatus({ kind: 'idle', text: `Zmierzono ${modelDist.toFixed(1)} jedn. — podaj wymiar rzeczywisty` })
    })
  }

  function applyCalibration(): void {
    const real = parseFloat(realInput.replace(',', '.'))
    if (!measured || !real || real <= 0) return
    setUnitMm(real / measured)
    setStatus({ kind: 'ok', text: `Skala: 1 jedn. modelu = ${(real / measured).toFixed(4)} mm` })
    setMeasured(null)
    setRealInput('')
  }

  const statusColor =
    status.kind === 'ok' ? 'text-emerald-400' : status.kind === 'err' ? 'text-rose-400' : 'text-slate-400'

  return (
    <div className="flex h-full flex-col bg-ink text-slate-100">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Infra<span className="text-accent">Design</span>
          </h1>
          <p className="text-xs text-slate-400">Projektowanie instalacji budynkowych · F1 DXF</p>
        </div>
        <span className="rounded bg-white/5 px-2 py-1 text-xs text-slate-400">sidecar: {sidecarInfo}</span>
      </header>

      <main className="flex min-h-0 flex-1">
        {/* lewy panel */}
        <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-white/10 p-4">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={ping} className="rounded bg-white/10 px-3 py-2 text-xs hover:bg-white/15">Ping</button>
            <button onClick={newProject} className="rounded bg-white/10 px-3 py-2 text-xs hover:bg-white/15">Nowy</button>
            <button onClick={save} disabled={!bundle} className="rounded bg-white/10 px-3 py-2 text-xs hover:bg-white/15 disabled:opacity-30">Zapisz</button>
            <button onClick={open} className="rounded bg-white/10 px-3 py-2 text-xs hover:bg-white/15">Otwórz</button>
          </div>

          <button onClick={importDxf} className="rounded bg-accent/20 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/30">
            Importuj rzut DXF
          </button>

          {doc && (
            <button onClick={startCalibration} className="rounded bg-white/10 px-3 py-2 text-xs hover:bg-white/15">
              Kalibracja skali (2 punkty)
            </button>
          )}

          {measured !== null && (
            <div className="space-y-2 rounded border border-amber-400/30 bg-amber-400/5 p-2">
              <p className="text-xs text-amber-200">Zmierzono {measured.toFixed(1)} jedn.</p>
              <div className="flex gap-2">
                <input
                  value={realInput}
                  onChange={(e) => setRealInput(e.target.value)}
                  placeholder="wymiar [mm]"
                  className="w-full rounded bg-black/30 px-2 py-1 text-xs"
                />
                <button onClick={applyCalibration} className="rounded bg-amber-400/20 px-2 py-1 text-xs text-amber-200">OK</button>
              </div>
            </div>
          )}

          {unitMm !== null && (
            <p className="rounded bg-emerald-400/10 px-2 py-1 text-xs text-emerald-300">
              Skala: 1 jedn. = {unitMm.toFixed(4)} mm
            </p>
          )}

          {doc && (
            <section className="mt-1">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Warstwy</h2>
                <button onClick={redetectWithRoles} className="text-[10px] text-accent hover:underline">
                  przelicz pomieszcz.
                </button>
              </div>
              <ul className="space-y-1">
                {doc.layers.map((l) => (
                  <li key={l.name} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={layerVisibility[l.name] ?? true}
                      onChange={() => toggleLayer(l.name)}
                    />
                    <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: l.color }} />
                    <span className="flex-1 truncate" title={l.name}>{l.name}</span>
                    <select
                      value={layerRoles[l.name] ?? 'other'}
                      onChange={(e) => setRole(l.name, e.target.value as LayerRole)}
                      className="rounded bg-black/30 px-1 py-0.5 text-[10px]"
                    >
                      {(Object.keys(ROLE_LABELS) as LayerRole[]).map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>

        {/* canvas */}
        <section className="relative min-w-0 flex-1">
          {doc ? (
            <CadViewer
              doc={doc}
              spaces={spaces}
              layerVisibility={layerVisibility}
              onHoverSpace={setHovered}
              onReady={(s) => (sceneRef.current = s)}
              className="h-full w-full"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              Zaimportuj rzut DXF, aby zobaczyć rysunek.
            </div>
          )}

          {/* nakładka info */}
          {doc && (
            <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/50 px-3 py-2 text-xs text-slate-300 backdrop-blur">
              <div>Pomieszczeń: <span className="text-accent">{spaces.length}</span> · łącznie {totalArea.toFixed(1)} m²</div>
              {hovered && <div className="mt-1 text-accent">{hovered.name}: {(hovered.area / 1_000_000).toFixed(1)} m²</div>}
            </div>
          )}
        </section>
      </main>

      <footer className={`border-t border-white/10 px-6 py-2 text-xs ${statusColor}`}>{status.text}</footer>
    </div>
  )
}
