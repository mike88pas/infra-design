/**
 * Demo na REALNYM rzucie klienta (Teatr Rzeszów, K+1).
 *
 * Sidecar (Python) nie działa w przeglądarce — dane (warstwy, pomieszczenia, INSERT-y,
 * trasy) są „upieczone" do client-floor.json. Ale CAŁY pipeline F2 liczy się TUTAJ,
 * tym samym kodem TS co w aplikacji desktop: mapowanie warstw→systemy →
 * urządzenia → BOM → kosztorys. Zmiana mapowania przelicza wszystko na żywo.
 */

import { useMemo, useState } from 'react'
import type { CableRoute, Device, DxfInsert, DxfRoom } from '@domain/model/schema'
import { guessSystemMapping, type LayerSystemMap, type SystemTypeMapping } from '@domain/dxf/systemMapping'
import { devicesFromInserts, countByTypeKey } from '@domain/installations/fromDxf'
import { roomsToSpaces } from '@domain/dxf/rooms'
import { buildBom } from '@domain/installations/bom'
import { buildCost, PLN } from '@domain/installations/cost'
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

export function ClientDemo(): JSX.Element {
  const [overrides, setOverrides] = useState<LayerSystemMap>({})

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
    return { spaces, devices, byType: countByTypeKey(devices), bom, cost, cableM: routes.reduce((s, r) => s + r.length, 0) }
  }, [mapping])

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
