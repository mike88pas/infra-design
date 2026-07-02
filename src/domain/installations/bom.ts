/**
 * Silnik BOM (F2) — agreguje urządzenia + kable + korytka projektu w zestawienie
 * materiałowe (`BomItem[]` z modelu rdzenia).
 *
 * Założenia jednostek:
 *   - `CableRoute.length` — w METRACH (długość domenowa po kalibracji skali).
 *   - `Tray.path` — we współrzędnych modelu (mm); konwertujemy na metry.
 * Do długości kabla dodajemy `cableSparePct` zapasu i zaokrąglamy w górę do pełnych metrów.
 */

import type { BomItem, CableRoute, Device, Tray } from '@domain/model/schema'
import { CABLE_KEYS, CATALOG, trayKey } from './catalog'

export interface BomInput {
  devices: Device[]
  routes: CableRoute[]
  trays: Tray[]
}

export interface BomOptions {
  /** Zapas na kabel [%] (domyślnie 5%). */
  cableSparePct?: number
}

function polylineLengthM(path: Array<{ x: number; y: number }>): number {
  let mm = 0
  for (let i = 1; i < path.length; i++) {
    mm += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
  }
  return mm / 1000
}

/** Buduje zestawienie materiałowe z encji projektu. */
export function buildBom(input: BomInput, opts: BomOptions = {}): BomItem[] {
  const spare = 1 + (opts.cableSparePct ?? 5) / 100
  const map = new Map<string, BomItem>()

  const add = (catalogKey: string, qty: number, sourceRef: string) => {
    const cat = CATALOG[catalogKey]
    if (!cat) return
    const existing = map.get(catalogKey)
    if (existing) {
      existing.qty += qty
      existing.sourceRefs.push(sourceRef)
    } else {
      map.set(catalogKey, {
        id: `bom.${catalogKey}`,
        catalogRef: catalogKey,
        description: cat.description,
        qty,
        unit: cat.unit,
        system: cat.system,
        sourceRefs: [sourceRef]
      })
    }
  }

  // Urządzenia — po jednej sztuce na encję, grupowane po typeKey.
  for (const d of input.devices) add(d.typeKey, 1, d.id)

  // Kable — sumujemy długości tras po typie kabla, potem zapas + zaokrąglenie.
  const cableMeters = new Map<string, { m: number; refs: string[] }>()
  for (const r of input.routes) {
    const key = CABLE_KEYS[r.cableType]
    if (!key) continue
    const acc = cableMeters.get(key) ?? { m: 0, refs: [] }
    acc.m += r.length
    acc.refs.push(r.id)
    cableMeters.set(key, acc)
  }
  for (const [key, acc] of cableMeters) {
    const cat = CATALOG[key]
    if (!cat) continue
    map.set(key, {
      id: `bom.${key}`,
      catalogRef: key,
      description: cat.description,
      qty: Math.ceil(acc.m * spare),
      unit: cat.unit,
      system: cat.system,
      sourceRefs: acc.refs
    })
  }

  // Korytka — sumujemy długości tras nośnych po szerokości, potem zaokrąglamy RAZ
  // (zaokrąglanie per‑bieg zawyżałoby przy wielu krótkich odcinkach magistrali).
  const trayMeters = new Map<string, { m: number; refs: string[] }>()
  for (const t of input.trays) {
    const key = trayKey(t.widthMm)
    if (!CATALOG[key]) continue
    const acc = trayMeters.get(key) ?? { m: 0, refs: [] }
    acc.m += polylineLengthM(t.path)
    acc.refs.push(t.id)
    trayMeters.set(key, acc)
  }
  for (const [key, acc] of trayMeters) {
    add(key, Math.ceil(acc.m), acc.refs[0])
    const item = map.get(key)
    if (item) for (let i = 1; i < acc.refs.length; i++) item.sourceRefs.push(acc.refs[i])
  }

  return [...map.values()].sort(
    (a, b) => a.system.localeCompare(b.system) || a.description.localeCompare(b.description)
  )
}
