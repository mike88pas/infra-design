/**
 * Auto-projektowanie instalacji (F2, tryb „od zera") — z wykazu pomieszczeń generuje
 * WSTĘPNY layout urządzeń wg reguł (gęstość punktów LAN, AP, kamery CCTV). To start
 * („mieszane"): projektant koryguje, a wytyczne klienta nadpisują parametry reguł.
 *
 * Wejście: pomieszczenia z `extract_rooms` (nazwa + metraż + środek). Wyjście: Space[]
 * + Device[] gotowe do trasowania (route_cables), BOM, kosztorysu i audytu norm.
 *
 * Pozycje to draft: urządzenia rozkładamy w siatce wokół środka pomieszczenia
 * (dokładne miejsca projektant przesunie; do BOM/długości liczy się liczba i przybliżenie).
 */

import type { Device, DxfRoom, Id, Point, Space } from '@domain/model/schema'
import { roomsToSpaces } from '@domain/dxf/rooms'

export interface AutoDesignRules {
  /** LAN: 1 gniazdo 2×RJ45 na m² powierzchni; min na pomieszczenie. */
  lan: { m2PerOutlet: number; minPerRoom: number }
  /** AP: 1 na m²; tylko pomieszczenia ≥ minRoomArea. */
  ap: { m2PerAp: number; minRoomArea: number }
  /** CCTV: kamera gdy pole ≥ minRoomArea lub nazwa pasuje do słów kluczowych. */
  cctv: { minRoomArea: number; nameKeywords: string[] }
  /** Szafa/IDF: pomieszczenie teletechniczne po słowie kluczowym (cel tras). */
  cabinet: { roomKeywords: string[] }
}

/** Domyślne reguły (dobre praktyki PL; nadpisywalne wytycznymi klienta). */
export const DEFAULT_AUTODESIGN_RULES: AutoDesignRules = {
  lan: { m2PerOutlet: 10, minPerRoom: 1 },
  ap: { m2PerAp: 100, minRoomArea: 30 },
  cctv: {
    minRoomArea: 40,
    nameKeywords: ['wejśc', 'wejsc', 'foyer', 'hol', 'korytarz', 'scena', 'magazyn', 'recepcj', 'klatka']
  },
  cabinet: {
    roomKeywords: ['teletech', 'serwer', 'rozdzieln', 'it', 'gpd', 'lpd', 'telekom', 'elektryczn']
  }
}

export interface AutoDesignOptions {
  drawingId: Id
  idPrefix?: string
  rules?: Partial<AutoDesignRules>
  /** Odstęp siatki rozkładania urządzeń w pomieszczeniu (jedn. modelu, domyślnie 800). */
  spacing?: number
}

/** Szafa/IDF — cel tras kablowych (punkt zbiorczy okablowania). */
export interface DesignCabinet {
  id: Id
  at: Point
  spaceId?: Id
  name: string
}

export interface AutoDesignResult {
  spaces: Space[]
  devices: Device[]
  /** Szafy/IDF (cele tras). Na start jedna główna na kondygnację. */
  cabinets: DesignCabinet[]
  /** Zestawienie decyzji per pomieszczenie (audyt/uzasadnienie dla projektanta). */
  perRoom: Array<{ spaceId: Id; name: string; areaM2: number | null; outlets: number; aps: number; cameras: number }>
}

function mergeRules(p?: Partial<AutoDesignRules>): AutoDesignRules {
  return {
    lan: { ...DEFAULT_AUTODESIGN_RULES.lan, ...(p?.lan ?? {}) },
    ap: { ...DEFAULT_AUTODESIGN_RULES.ap, ...(p?.ap ?? {}) },
    cctv: { ...DEFAULT_AUTODESIGN_RULES.cctv, ...(p?.cctv ?? {}) },
    cabinet: { ...DEFAULT_AUTODESIGN_RULES.cabinet, ...(p?.cabinet ?? {}) }
  }
}

/** Wybiera lokalizację głównej szafy: pomieszczenie teletechniczne lub centroid. */
function placeCabinet(rooms: DxfRoom[], spaces: Space[], rules: AutoDesignRules, drawingId: Id): DesignCabinet {
  const idx = rooms.findIndex((r) => {
    const n = (r.name ?? '').toLowerCase()
    return rules.cabinet.roomKeywords.some((k) => n.includes(k))
  })
  if (idx >= 0) {
    return { id: `${drawingId}::rack`, at: rooms[idx].at, spaceId: spaces[idx].id, name: `Szafa IDF — ${rooms[idx].name}` }
  }
  // centroid środków pomieszczeń
  const n = rooms.length || 1
  const cx = rooms.reduce((s, r) => s + r.at.x, 0) / n
  const cy = rooms.reduce((s, r) => s + r.at.y, 0) / n
  return { id: `${drawingId}::rack`, at: { x: cx, y: cy }, name: 'Szafa IDF (centroid)' }
}

/** Rozkłada `n` punktów w siatce wokół środka (draft pozycji). */
function gridAround(center: Point, n: number, spacing: number): Point[] {
  if (n <= 0) return []
  const cols = Math.ceil(Math.sqrt(n))
  const pts: Point[] = []
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols)
    const c = i % cols
    pts.push({
      x: center.x + (c - (cols - 1) / 2) * spacing,
      y: center.y + (r - (cols - 1) / 2) * spacing
    })
  }
  return pts
}

/** Generuje wstępny layout urządzeń LAN+CCTV z wykazu pomieszczeń. */
export function autoDesign(rooms: DxfRoom[], opts: AutoDesignOptions): AutoDesignResult {
  const rules = mergeRules(opts.rules)
  const spacing = opts.spacing ?? 800
  const prefix = opts.idPrefix ?? 'AD'
  const { spaces } = roomsToSpaces(rooms, opts.drawingId)

  const devices: Device[] = []
  const perRoom: AutoDesignResult['perRoom'] = []
  let seq = 0
  const mk = (system: Device['system'], typeKey: string, at: Point, spaceId: Id): Device => ({
    id: `${prefix}-${++seq}`,
    drawingId: opts.drawingId,
    spaceId,
    system,
    typeKey,
    position: at,
    rotation: 0,
    props: { auto: true },
    connections: []
  })

  rooms.forEach((room, i) => {
    const space = spaces[i]
    const area = room.areaM2 ?? 0
    const name = (room.name ?? '').toLowerCase()

    // LAN: liczba gniazd z metrażu (min na pomieszczenie)
    const outlets = area > 0 ? Math.max(rules.lan.minPerRoom, Math.ceil(area / rules.lan.m2PerOutlet)) : rules.lan.minPerRoom

    // AP: tylko większe pomieszczenia
    const aps = area >= rules.ap.minRoomArea ? Math.max(1, Math.round(area / rules.ap.m2PerAp)) : 0

    // CCTV: duże pomieszczenia lub trafienie w słowo kluczowe (wejścia/korytarze/sceny…)
    const keyworded = rules.cctv.nameKeywords.some((k) => name.includes(k))
    const cameras = area >= rules.cctv.minRoomArea || keyworded ? 1 : 0

    // Pozycje (draft) wokół środka pomieszczenia
    const lanPts = gridAround(room.at, outlets, spacing)
    for (const p of lanPts) devices.push(mk('lan', 'lan.outlet.2x', p, space.id))
    const apPts = gridAround({ x: room.at.x, y: room.at.y + spacing * 2 }, aps, spacing)
    for (const p of apPts) devices.push(mk('lan', 'lan.ap', p, space.id))
    const camPts = gridAround({ x: room.at.x, y: room.at.y - spacing * 2 }, cameras, spacing)
    for (const p of camPts) devices.push(mk('cctv', 'cctv.dome.4mp', p, space.id))

    perRoom.push({ spaceId: space.id, name: room.name, areaM2: room.areaM2, outlets, aps, cameras })
  })

  const cabinets = rooms.length ? [placeCabinet(rooms, spaces, rules, opts.drawingId)] : []
  return { spaces, devices, cabinets, perRoom }
}
