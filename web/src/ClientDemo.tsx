/**
 * Demo na REALNYM (zanonimizowanym) rzucie klienta referencyjnego — obiekt
 * użyteczności publicznej, K+1.
 *
 * Sidecar (Python) nie działa w przeglądarce — dane (warstwy, pomieszczenia, INSERT-y,
 * trasy) są „upieczone" do client-floor.json. Ale CAŁY pipeline F2 liczy się TUTAJ,
 * tym samym kodem TS co w aplikacji desktop: mapowanie warstw→systemy →
 * urządzenia → BOM → kosztorys. Zmiana mapowania przelicza wszystko na żywo.
 */

import { useMemo, useState } from 'react'
import type { CableRoute, Device, DxfInsert, DxfRoom, DxfDocument, BBox } from '@domain/model/schema'
import { guessSystemMapping, type LayerSystemMap, type SystemTypeMapping } from '@domain/dxf/systemMapping'
import { devicesFromInserts, countByTypeKey } from '@domain/installations/fromDxf'
import { roomsToSpaces } from '@domain/dxf/rooms'
import { buildBom } from '@domain/installations/bom'
import { buildCost, PLN } from '@domain/installations/cost'
import { runAudit } from '@domain/norms/audit'
import { INSTALLATION_RULES } from '@domain/norms/rules'
import type { ProjectBundle } from '@domain/model/schema'
import { CadViewer } from '@core/cad/CadViewer'
import type { RenderDevice } from '@core/cad'
import clientData from './data/client-floor.json'

interface ClientFloor {
  meta: { name: string; level: number; units: string; unitMm: number }
  layers: { name: string; color: string; visible: boolean }[]
  rooms: DxfRoom[]
  inserts: DxfInsert[]
  cableRoutes: { at: { x: number; y: number }; lengthM: number }[]
  cableTotalM: number
}

const data = clientData as unknown as ClientFloor

const TARGETS: { key: string; label: string; value: SystemTypeMapping | null }[] = [
  { key: 'unset', label: '— nie przypisano —', value: null },
  { key: 'ignore', label: '— pomiń —', value: null },
  { key: 'lan.outlet.2x', label: 'LAN · gniazdo 2×RJ45', value: { system: 'lan', typeKey: 'lan.outlet.2x' } },
  { key: 'lan.ap', label: 'LAN · Access Point', value: { system: 'lan', typeKey: 'lan.ap' } },
  { key: 'cctv.dome.4mp', label: 'CCTV · kamera', value: { system: 'cctv', typeKey: 'cctv.dome.4mp' } },
  { key: 'kd.reader', label: 'KD · czytnik', value: { system: 'kd', typeKey: 'kd.reader' } },
  { key: 'kd.intercom', label: 'KD · intercom', value: { system: 'kd', typeKey: 'kd.intercom' } }
]

const SYSTEM_LABEL: Record<string, string> = {
  'lan.outlet.2x': 'Gniazda RJ-45',
  'lan.ap': 'Access Pointy',
  'cctv.dome.4mp': 'Kamery CCTV',
  'kd.reader': 'Kontrola dostępu',
  'kd.intercom': 'Intercomy'
}

function targetKeyFor(map: LayerSystemMap, layer: string): string {
  if (!(layer in map)) return 'unset'
  const m = map[layer]
  return m === null ? 'ignore' : m.typeKey
}

// Liczba INSERT-ów na warstwie (do pokazania „ile symboli").
const INSERT_COUNTS: Record<string, number> = (() => {
  const c: Record<string, number> = {}
  for (const i of data.inserts) c[i.layer] = (c[i.layer] ?? 0) + 1
  return c
})()

// Minimalny „rzut" dla renderera CAD: ten plik klienta to ekstrakcja typu schedule
// (etykiety pomieszczeń + metraż, bez geometrii ścian), więc rysujemy markery
// pomieszczeń + symbole urządzeń na realnych pozycjach. bbox liczymy z punktów.
const CLIENT_BBOX: BBox = (() => {
  // Percentyl 2–98% obcina pojedyncze bloki-outliery (np. stray w origin 0,0),
  // które inaczej rozciągają widok i ściskają realny klaster urządzeń.
  const pts = [...data.inserts.map((i) => i.at), ...data.rooms.map((r) => r.at)]
  if (!pts.length) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }
  const xs = pts.map((p) => p.x).sort((a, b) => a - b)
  const ys = pts.map((p) => p.y).sort((a, b) => a - b)
  const q = (arr: number[], t: number): number =>
    arr[Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * t)))]
  const minX = q(xs, 0.02)
  const maxX = q(xs, 0.98)
  const minY = q(ys, 0.02)
  const maxY = q(ys, 0.98)
  const mx = (maxX - minX) * 0.06 || 500
  const my = (maxY - minY) * 0.06 || 500
  return { minX: minX - mx, minY: minY - my, maxX: maxX + mx, maxY: maxY + my }
})()

const CLIENT_DOC: DxfDocument = {
  layers: data.layers,
  entities: [],
  bbox: CLIENT_BBOX,
  units: 'mm',
  entityCount: 0
}

// Systemy do filtra na canvasie (kolor zgodny z legendą renderera).
const SYSTEM_FILTER: { key: string; label: string; dot: string }[] = [
  { key: 'lan', label: 'LAN', dot: '#38bdf8' },
  { key: 'cctv', label: 'CCTV', dot: '#ef4444' },
  { key: 'kd', label: 'KD', dot: '#a78bfa' }
]

export function ClientDemo(): JSX.Element {
  const [overrides, setOverrides] = useState<LayerSystemMap>({})
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const mapping = useMemo<LayerSystemMap>(
    () => ({ ...guessSystemMapping(data.layers), ...overrides }),
    [overrides]
  )

  const result = useMemo(() => {
    const { spaces, assign } = roomsToSpaces(data.rooms, 'k1')
    const devices: Device[] = devicesFromInserts(data.inserts, mapping, {
      drawingId: 'k1',
      idPrefix: 'L1',
      spaceOf: assign
    })
    // Trasy z upieczonych długości — dopasowanie po pozycji urządzenia.
    const byPos = new Map(devices.map((d) => [`${d.position.x},${d.position.y}`, d]))
    const routes: CableRoute[] = []
    for (const cr of data.cableRoutes) {
      const dev = byPos.get(`${cr.at.x},${cr.at.y}`)
      if (!dev) continue
      routes.push({
        id: `route-${dev.id}`,
        system: dev.system,
        path: [],
        cableType: 'U/UTP kat.6 LSOH',
        length: cr.lengthM,
        from: { deviceId: dev.id, port: 'a' },
        to: { deviceId: 'RK1', port: 'b' }
      })
    }
    const bom = buildBom({ devices, routes, trays: [] })
    const cost = buildCost(bom)
    // Audyt: długość kanału LAN ≤ 90 m (DORI dochodzi z modelem pokrycia kamer).
    const rules = INSTALLATION_RULES.filter((r) => r.id !== 'cctv.dori.target')
    const failed = runAudit({ devices, routes, trays: [], circuits: [] } as unknown as ProjectBundle, rules).filter(
      (v) => v.status === 'fail'
    )
    return {
      spaces,
      devices,
      byType: countByTypeKey(devices),
      bom,
      cost,
      cableM: routes.reduce((s, r) => s + r.length, 0),
      normErrors: failed.length
    }
  }, [mapping])

  // Symbole na rzut: urządzenia (po filtrze systemów) + markery pomieszczeń.
  const renderDevices = useMemo<RenderDevice[]>(
    () =>
      result.devices
        .filter((d) => !hidden.has(d.system))
        .map((d) => ({
          id: d.id,
          system: d.system,
          typeKey: d.typeKey,
          position: d.position,
          rotation: d.rotation
        })),
    [result.devices, hidden]
  )

  function toggleSystem(sys: string): void {
    setHidden((h) => {
      const next = new Set(h)
      if (next.has(sys)) next.delete(sys)
      else next.add(sys)
      return next
    })
  }

  // Warstwy urządzeń (mają INSERT-y i rozpoznany/edytowalny system).
  const deviceLayers = data.layers
    .map((l) => l.name)
    .filter((n) => INSERT_COUNTS[n] && (n in guessSystemMapping(data.layers) || n in overrides))

  function setLayer(layer: string, key: string): void {
    setOverrides((o) => {
      const next = { ...o }
      if (key === 'unset') next[layer] = undefined as unknown as null
      else {
        const t = TARGETS.find((x) => x.key === key)
        next[layer] = t ? t.value : null
      }
      return next
    })
  }

  const totalRoomArea = data.rooms.reduce((s, r) => s + (r.areaM2 ?? 0), 0)

  return (
    <section className="block" id="realny">
      <div className="wrap">
        <h2 className="section-title">Realny projekt: {data.meta.name}</h2>
        <p className="section-sub">
          Plik DWG od biura projektowego (AutoCAD 2018) → konwersja DXF → ekstrakcja. Mapowanie
          warstw, urządzenia, BOM i kosztorys liczą się <strong>na żywo w przeglądarce</strong> tym
          samym kodem co aplikacja desktop. Zmień przypisanie warstwy — wszystko przeliczy się od razu.
        </p>

        {/* Mini-rzut: urządzenia naniesione na realne pozycje (tym samym rendererem
            CAD co desktop). Filtr systemów i zmiana mapowania przeliczają widok live. */}
        <div className="demo-frame">
          <div className="demo-bar">
            <span>
              rzut K+1 · <span className="pill">{renderDevices.length} symboli</span>{' '}
              <span className="pill">{data.rooms.length} pomieszczeń</span>
            </span>
            <span className="sysfilter">
              {SYSTEM_FILTER.map((s) => {
                const n = result.devices.filter((d) => d.system === s.key).length
                if (!n) return null
                const off = hidden.has(s.key)
                return (
                  <button
                    key={s.key}
                    className={`sys${off ? ' off' : ''}`}
                    onClick={() => toggleSystem(s.key)}
                    title={off ? 'Pokaż' : 'Ukryj'}
                  >
                    <i style={{ background: s.dot }} /> {s.label} · {n}
                  </button>
                )
              })}
            </span>
          </div>
          <CadViewer doc={CLIENT_DOC} spaces={[]} devices={renderDevices} className="demo-canvas" />
        </div>

        <div className="client-grid">
          {/* Mapowanie warstw (interaktywne) */}
          <div className="card">
            <h3>Mapowanie warstw → systemy</h3>
            <table className="ctab">
              <tbody>
                {deviceLayers.map((name) => (
                  <tr key={name}>
                    <td className="muted">{name}</td>
                    <td className="num">{INSERT_COUNTS[name]}</td>
                    <td>
                      <select value={targetKeyFor(mapping, name)} onChange={(e) => setLayer(name, e.target.value)}>
                        {TARGETS.map((t) => (
                          <option key={t.key} value={t.key}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Wynik: urządzenia + kosztorys */}
          <div className="card">
            <h3>Urządzenia i kosztorys (live)</h3>
            <div className="kpis">
              <div>
                <b>{result.devices.length}</b>
                <span>urządzeń</span>
              </div>
              <div>
                <b>{data.rooms.length}</b>
                <span>pomieszczeń</span>
              </div>
              <div>
                <b>{totalRoomArea.toFixed(0)} m²</b>
                <span>powierzchni</span>
              </div>
              <div>
                <b>{Math.round(data.cableTotalM)} m</b>
                <span>kabla (A*)</span>
              </div>
            </div>
            <table className="ctab">
              <tbody>
                {Object.entries(result.byType).map(([k, v]) => (
                  <tr key={k}>
                    <td>{SYSTEM_LABEL[k] ?? k}</td>
                    <td className="num">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="cost">
              <span>Kosztorys netto</span>
              <b>{PLN(result.cost.net)}</b>
            </div>
            <div className="cost grad">
              <span>Brutto (z narzutem + VAT)</span>
              <b>{PLN(result.cost.gross)}</b>
            </div>
            <div className="cost">
              <span>Walidacja norm (PN-EN 50173: kanał ≤90 m)</span>
              <b style={{ color: result.normErrors ? '#f59e0b' : 'var(--accent)' }}>
                {result.normErrors ? `▲ ${result.normErrors} tras >90 m` : '✓ OK'}
              </b>
            </div>
          </div>
        </div>

        <details className="client-rooms">
          <summary>Wykaz pomieszczeń z rzutu ({data.rooms.length}) — numer · nazwa · metraż architekta</summary>
          <table className="ctab full">
            <tbody>
              {data.rooms.map((r, i) => (
                <tr key={i}>
                  <td className="muted">{r.number}</td>
                  <td>{r.name}</td>
                  <td className="num">{(r.areaM2 ?? 0).toFixed(1)} m²</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>

        <p className="demo-hint">
          BOM: {result.bom.length} pozycji · kosztorys metodą uproszczoną (KNR + cennik placeholder,
          do walidacji u klienta). Software wspomaga projektanta — nie podpisuje projektu.
        </p>
      </div>
    </section>
  )
}
