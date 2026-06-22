import { useMemo, useRef, useState } from 'react'
import type { BomItem, Device, DxfDocument, DxfRoom, Point, ProjectBundle, Space } from '../../domain/model/schema'
import { createEmptyBundle, createEmptyProject } from '../../domain/model/schema'
import { autoDesign } from '../../domain/installations/autodesign'
import { CadViewer } from '@core/cad/CadViewer'
import { polygonsToSpaces, type CadScene, type RenderSpace } from '@core/cad'
import {
  guessLayerRoles,
  guessWallLayers,
  type LayerRole
} from '../../domain/dxf/layerMapping'
import { ImportWizard } from './components/ImportWizard'
import type { ImportProfile } from '../../domain/dxf/importProfile'
import { roomsToSpaces } from '../../domain/dxf/rooms'
import { devicesFromInserts, countByTypeKey } from '../../domain/installations/fromDxf'
import { buildBom } from '../../domain/installations/bom'
import { buildCost, PLN, type CostSummary } from '../../domain/installations/cost'
import { buildCableRoutes } from '../../domain/installations/routing'
import { runAudit } from '../../domain/norms/audit'
import { INSTALLATION_RULES } from '../../domain/norms/rules'

/** Centroid wielokąta (do środka pomieszczenia z polygonize). */
function centroid(pts: Point[]): Point {
  const n = pts.length || 1
  return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n }
}

interface ImportSummary {
  level: number
  spaces: number
  roomAreaM2: number
  devices: number
  byType: Record<string, number>
  cableM: number
  routedAstar: number
  bom: BomItem[]
  cost: CostSummary
  audit: { errors: number; warnings: number; issues: Array<{ id: string; message: string; reference: string }> }
}

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

  // Kreator importu instalacji (F2)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [summary, setSummary] = useState<ImportSummary | null>(null)

  const sceneRef = useRef<CadScene | null>(null)

  const fileName = useMemo(() => (dxfPath ? dxfPath.split(/[\\/]/).pop() ?? '' : ''), [dxfPath])

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

  /** Import pod kreator instalacji: wczytuje DXF i otwiera formularz wartości początkowych. */
  async function importInstallations(): Promise<void> {
    setStatus({ kind: 'idle', text: 'Wczytuję DXF…' })
    try {
      const res = await window.infra.dxf.import()
      if (!res.imported || !res.doc || !res.filePath) {
        setStatus({ kind: 'idle', text: 'Import anulowany' })
        return
      }
      setDoc(res.doc)
      setDxfPath(res.filePath)
      setLayerVisibility(Object.fromEntries(res.doc.layers.map((l) => [l.name, l.visible])))
      setSpaces([])
      setSummary(null)
      setWizardOpen(true)
      setStatus({ kind: 'ok', text: 'Potwierdź wartości początkowe w kreatorze' })
    } catch (e) {
      setStatus({ kind: 'err', text: `Import DXF: ${(e as Error).message}` })
    }
  }

  /** Po potwierdzeniu profilu: pomieszczenia + urządzenia + trasy → BOM → kosztorys → bundle. */
  async function runImport(profile: ImportProfile): Promise<void> {
    if (!dxfPath) return
    setWizardOpen(false)
    const drawingId = `drw-${profile.level}`
    try {
      // 1) Pomieszczenia jako DxfRoom[] — etykiety pól (czyste) lub rekonstrukcja ze ścian
      setStatus({ kind: 'idle', text: 'Wykrywam pomieszczenia…' })
      let rooms: DxfRoom[]
      if (profile.roomSource === 'area') {
        const rr = await window.infra.dxf.extractRooms({
          path: dxfPath,
          areaLayers: profile.areaLayers,
          explodeBlocks: profile.explodeBlocks
        })
        rooms = rr.rooms
      } else {
        const poly = await window.infra.dxf.polygonize({
          path: dxfPath,
          wallLayers: profile.wallLayers,
          explodeBlocks: profile.explodeBlocks
        })
        rooms = poly.polygons.map((p, i) => ({
          number: '',
          name: `Pom. ${i + 1}`,
          areaM2: p.area / 1_000_000,
          at: centroid(p.points),
          tag: p.points
        }))
      }
      const { spaces: domainSpaces, assign: assignToRoom } = roomsToSpaces(rooms, drawingId)
      const renderSpaces: RenderSpace[] = domainSpaces.map((s) => ({
        id: s.id,
        name: s.name,
        polygon: s.polygon,
        area: s.area
      }))
      setSpaces(renderSpaces)

      // 2) Urządzenia: odczyt naniesionych (extract) albo auto-projektowanie (autodesign)
      let devices: Device[]
      let targets: Point[] = []
      let cabinetIds: string[] = []
      if (profile.mode === 'autodesign') {
        setStatus({ kind: 'idle', text: 'Projektuję instalację (auto-design)…' })
        const ad = autoDesign(rooms, {
          drawingId,
          idPrefix: `L${profile.level}`,
          rules: { lan: { m2PerOutlet: profile.autoM2PerOutlet, minPerRoom: 1 } }
        })
        devices = ad.devices
        targets = ad.cabinets.map((c) => c.at)
        cabinetIds = ad.cabinets.map((c) => c.id)
      } else {
        setStatus({ kind: 'idle', text: 'Wyciągam urządzenia…' })
        const ext = await window.infra.dxf.extractDevices({ path: dxfPath })
        devices = devicesFromInserts(ext.inserts, profile.systemMapping, {
          drawingId,
          idPrefix: `L${profile.level}`,
          spaceOf: assignToRoom
        })
        const cab = await window.infra.dxf.extractDevices({ path: dxfPath, layers: profile.targetLayers })
        targets = cab.inserts.map((c) => c.at)
        cabinetIds = cab.inserts.map((_, i) => `rack-${profile.level}-${i}`)
      }

      // 3) Trasowanie kabli A* (opcjonalne) → CableRoute[]
      let routes: ReturnType<typeof buildCableRoutes> = []
      let routedAstar = 0
      if (profile.doRouting && devices.length && targets.length) {
        setStatus({ kind: 'idle', text: 'Trasuję kable (A*) — to może chwilę potrwać…' })
        const rc = await window.infra.dxf.routeCables({
          path: dxfPath,
          sources: devices.map((d) => d.position),
          targets,
          wallLayers: profile.wallLayers,
          explodeBlocks: profile.explodeBlocks
        })
        routedAstar = rc.routes.filter((r) => r.method === 'astar').length
        routes = buildCableRoutes({ devices, routes: rc.routes, unitMm: profile.unitMm, cabinetIds })
      }

      // 4) BOM + kosztorys
      const bom = buildBom({ devices, routes, trays: [] }, { cableSparePct: profile.cableSparePct })
      const cost = buildCost(bom, { overheadPct: profile.overheadPct, vatPct: profile.vatPct })

      // 4b) Audyt norm — długość kanału LAN ≤ 90 m (mamy długości z A*).
      // DORI pomijamy do czasu modelu pokrycia kamer (F4) — inaczej fałszywe ostrzeżenia.
      const rules = INSTALLATION_RULES.filter((r) => r.id !== 'cctv.dori.target')
      const validations = runAudit(
        { devices, routes, trays: [], circuits: [] } as unknown as ProjectBundle,
        rules
      )
      const failed = validations.filter((v) => v.status === 'fail')
      const audit = {
        errors: failed.filter((v) => v.severity === 'error').length,
        warnings: failed.filter((v) => v.severity === 'warn').length,
        issues: failed.slice(0, 6).map((v) => ({ id: v.targetId, message: v.message, reference: v.reference }))
      }

      // 5) Persystencja do bundla (utwórz, jeśli brak)
      persistImport(profile, drawingId, domainSpaces, devices, routes, bom, cost, validations)

      const cableM = routes.reduce((s, r) => s + r.length, 0)
      const roomAreaM2 = domainSpaces.reduce((s, sp) => s + sp.area, 0) / 1_000_000
      setSummary({
        level: profile.level,
        spaces: domainSpaces.length,
        roomAreaM2,
        devices: devices.length,
        byType: countByTypeKey(devices),
        cableM,
        routedAstar,
        bom,
        cost,
        audit
      })
      setStatus({
        kind: 'ok',
        text: `Zaimportowano kondygnację ${profile.level}: ${devices.length} urządzeń, ${domainSpaces.length} pomieszczeń, ${Math.round(cableM)} m kabla, brutto ${PLN(cost.gross)}`
      })
    } catch (e) {
      setStatus({ kind: 'err', text: `Import instalacji: ${(e as Error).message}` })
    }
  }

  /** Wpisuje wynik importu do ProjectBundle (zastępuje dane danej kondygnacji). */
  function persistImport(
    profile: ImportProfile,
    drawingId: string,
    domainSpaces: Space[],
    devices: Device[],
    routes: ReturnType<typeof buildCableRoutes>,
    bom: BomItem[],
    cost: CostSummary,
    validations: ReturnType<typeof runAudit>
  ): void {
    setBundle((prev) => {
      const base =
        prev ??
        createEmptyBundle(
          createEmptyProject({
            id: crypto.randomUUID(),
            name: profile.projectName || 'Projekt instalacji',
            client: profile.client,
            now: new Date().toISOString()
          })
        )
      // Zastąp dane tej kondygnacji (drawingId), zachowaj pozostałe.
      const keepSpace = base.spaces.filter((s) => s.drawingId !== drawingId)
      const keepDev = base.devices.filter((d) => d.drawingId !== drawingId)
      const keepRoute = base.routes.filter((r) => !r.id.startsWith(`route-L${profile.level}-`))
      const drawing = {
        id: drawingId,
        projectId: base.project.id,
        name: profile.drawingName || `Kondygnacja ${profile.level}`,
        level: profile.level,
        sourceDxfRef: dxfPath ?? '',
        layers: [],
        transform: [profile.unitMm, 0, 0, profile.unitMm, 0, 0] as [number, number, number, number, number, number],
        bbox: doc?.bbox ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 }
      }
      const drawings = [...base.drawings.filter((d) => d.id !== drawingId), drawing]
      return {
        ...base,
        project: { ...base.project, updatedAt: new Date().toISOString() },
        drawings,
        spaces: [...keepSpace, ...domainSpaces],
        devices: [...keepDev, ...devices],
        routes: [...keepRoute, ...routes],
        bom,
        costs: cost.items,
        validations
      }
    })
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

          <button onClick={importInstallations} className="rounded bg-emerald-400/15 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-400/25">
            Importuj / Zaprojektuj instalacje (kreator)
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

          {/* panel wyników importu instalacji */}
          {summary && (
            <div className="absolute bottom-3 right-3 w-72 rounded-lg border border-emerald-400/20 bg-black/70 p-3 text-xs text-slate-200 backdrop-blur">
              <h3 className="mb-2 font-semibold text-emerald-300">Instalacje — kondygnacja {summary.level}</h3>
              <div className="mb-2 grid grid-cols-2 gap-1 text-slate-300">
                <span>Urządzeń: <b className="text-accent">{summary.devices}</b></span>
                <span>Pomieszczeń: <b className="text-accent">{summary.spaces}</b></span>
                <span>Pow.: <b className="text-accent">{summary.roomAreaM2.toFixed(0)} m²</b></span>
                <span>Kabel: <b className="text-accent">{Math.round(summary.cableM)} m</b></span>
              </div>
              {summary.cableM > 0 && (
                <p className="mb-1 text-[10px] text-slate-500">Trasy A*: {summary.routedAstar}/{summary.devices}</p>
              )}
              <table className="w-full">
                <tbody>
                  {Object.entries(summary.byType).map(([k, v]) => (
                    <tr key={k} className="border-t border-white/5">
                      <td className="py-0.5 text-slate-400">{k}</td>
                      <td className="py-0.5 text-right">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 border-t border-white/10 pt-2">
                <div className="flex justify-between"><span className="text-slate-400">Netto</span><span>{PLN(summary.cost.net)}</span></div>
                <div className="flex justify-between font-semibold text-emerald-300"><span>Brutto</span><span>{PLN(summary.cost.gross)}</span></div>
              </div>
              <div className="mt-2 border-t border-white/10 pt-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-slate-400">Normy (PN-EN)</span>
                  <span>
                    {summary.audit.errors > 0 && <span className="mr-2 text-rose-400">● {summary.audit.errors} błąd</span>}
                    {summary.audit.warnings > 0 && <span className="text-amber-400">▲ {summary.audit.warnings} ostrz.</span>}
                    {summary.audit.errors === 0 && summary.audit.warnings === 0 && <span className="text-emerald-400">✓ OK</span>}
                  </span>
                </div>
                {summary.audit.issues.slice(0, 4).map((iss, k) => (
                  <div key={k} className="text-[10px] text-rose-300/80" title={iss.reference}>
                    {iss.id}: {iss.message}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      {wizardOpen && doc && (
        <ImportWizard
          doc={doc}
          fileName={fileName}
          onConfirm={runImport}
          onCancel={() => {
            setWizardOpen(false)
            setStatus({ kind: 'idle', text: 'Import anulowany' })
          }}
        />
      )}

      <footer className={`border-t border-white/10 px-6 py-2 text-xs ${statusColor}`}>{status.text}</footer>
    </div>
  )
}
