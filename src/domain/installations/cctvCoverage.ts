/**
 * Model pokrycia kamer CCTV — DORI (PN-EN 62676-4) + sektor FOV.
 *
 * Czysta domena (bez zależności, reużywalna desktop + web). Liczy gęstość px/m na
 * dystansie z rozdzielczości poziomej i kąta widzenia, promienie stref DORI
 * (Detection/Observation/Recognition/Identification) i wielobok sektora pokrycia
 * (opcjonalnie przycięty do obrysu pomieszczenia — kamera nie widzi przez ściany).
 *
 * DORI = progi gęstości obrazu wg PN-EN 62676-4:
 *   Detection ≥ 25 px/m · Observation ≥ 62,5 · Recognition ≥ 125 · Identification ≥ 250.
 */

export interface Point {
  x: number
  y: number
}

export type DoriLevel = 'identification' | 'recognition' | 'observation' | 'detection'

/** Progi gęstości obrazu [px/m] wg PN-EN 62676-4. */
export const DORI_PXM: Record<DoriLevel, number> = {
  identification: 250,
  recognition: 125,
  observation: 62.5,
  detection: 25
}

/** Kolejność od najostrzejszej (blisko) do najsłabszej (daleko). */
export const DORI_ORDER: DoriLevel[] = ['identification', 'recognition', 'observation', 'detection']

const DEG2RAD = Math.PI / 180

/** Rozdzielczość pozioma matrycy [px] z megapikseli (założenie kadru 16:9). */
export function hPixelsFromMp(mp: number): number {
  return Math.round(Math.sqrt(Math.max(0, mp) * 1e6 * (16 / 9)))
}

/** Gęstość obrazu [px/m] na dystansie `distM` [m] dla kamery o `hPx` i kącie `fovDeg`. */
export function pxPerMeterAt(distM: number, hPx: number, fovDeg: number): number {
  if (distM <= 0) return Infinity
  const sceneWidthM = 2 * distM * Math.tan((fovDeg / 2) * DEG2RAD)
  return sceneWidthM > 0 ? hPx / sceneWidthM : Infinity
}

/** Dystans [m], na którym gęstość spada do `pxm` [px/m]. */
export function distanceForPxM(pxm: number, hPx: number, fovDeg: number): number {
  const denom = 2 * pxm * Math.tan((fovDeg / 2) * DEG2RAD)
  return denom > 0 ? hPx / denom : 0
}

/** Promienie stref DORI [m] (identification < recognition < observation < detection). */
export function doriRadiiM(hPx: number, fovDeg: number): Record<DoriLevel, number> {
  return {
    identification: distanceForPxM(DORI_PXM.identification, hPx, fovDeg),
    recognition: distanceForPxM(DORI_PXM.recognition, hPx, fovDeg),
    observation: distanceForPxM(DORI_PXM.observation, hPx, fovDeg),
    detection: distanceForPxM(DORI_PXM.detection, hPx, fovDeg)
  }
}

/** Wielobok sektora pokrycia (apex + łuk) dla kierunku `dirDeg` i kąta `fovDeg`. */
export function sectorPolygon(
  center: Point,
  dirDeg: number,
  fovDeg: number,
  radius: number,
  segments = 24
): Point[] {
  const pts: Point[] = [{ x: center.x, y: center.y }]
  const half = (fovDeg / 2) * DEG2RAD
  const dir = dirDeg * DEG2RAD
  for (let i = 0; i <= segments; i++) {
    const a = dir - half + (2 * half * i) / segments
    pts.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) })
  }
  return pts
}

/** Przycięcie wieloboku do wypukłego obszaru (Sutherland-Hodgman). `clip` musi być wypukły. */
export function clipToConvex(subject: Point[], clip: Point[]): Point[] {
  if (clip.length < 3) return subject
  // Orientacja clipu (znak pola) — „wewnątrz" to lewa strona każdej krawędzi.
  let area = 0
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i]
    const b = clip[(i + 1) % clip.length]
    area += a.x * b.y - b.x * a.y
  }
  const ccw = area > 0
  const inside = (p: Point, a: Point, b: Point): boolean => {
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    return ccw ? cross >= 0 : cross <= 0
  }
  const intersect = (p1: Point, p2: Point, a: Point, b: Point): Point => {
    const d1x = p2.x - p1.x
    const d1y = p2.y - p1.y
    const d2x = b.x - a.x
    const d2y = b.y - a.y
    const denom = d1x * d2y - d1y * d2x
    const t = denom !== 0 ? ((a.x - p1.x) * d2y - (a.y - p1.y) * d2x) / denom : 0
    return { x: p1.x + t * d1x, y: p1.y + t * d1y }
  }
  let output = subject
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i]
    const b = clip[(i + 1) % clip.length]
    const input = output
    output = []
    for (let j = 0; j < input.length; j++) {
      const cur = input[j]
      const prev = input[(j + input.length - 1) % input.length]
      const curIn = inside(cur, a, b)
      const prevIn = inside(prev, a, b)
      if (curIn) {
        if (!prevIn) output.push(intersect(prev, cur, a, b))
        output.push(cur)
      } else if (prevIn) {
        output.push(intersect(prev, cur, a, b))
      }
    }
    if (output.length === 0) break
  }
  return output
}

export interface CoverageBand {
  level: DoriLevel
  /** Próg gęstości [px/m]. */
  pxm: number
  /** Promień strefy w jednostkach modelu. */
  radiusModel: number
  /** Wielobok strefy (po ewentualnym przycięciu do pomieszczenia). */
  polygon: Point[]
}

export interface CameraCoverageInput {
  position: Point
  /** Kierunek patrzenia [deg], 0 = +X (jak atan2). */
  dirDeg: number
  /** Megapiksele matrycy (do rozdzielczości poziomej). */
  mp: number
  /** Poziomy kąt widzenia [deg]. */
  fovDeg: number
}

/**
 * Strefy DORI kamery jako wieloboki w jednostkach modelu (od najszerszej do
 * najwęższej — do rysowania kolejno, węższe na wierzchu). `unitMm` = mm/jednostkę
 * modelu (radius_model = dist_m * 1000 / unitMm). `room` (opcjonalnie) przycina sektor.
 */
export function cameraCoverageBands(
  cam: CameraCoverageInput,
  unitMm: number,
  room?: Point[] | null
): CoverageBand[] {
  const hPx = hPixelsFromMp(cam.mp)
  const radiiM = doriRadiiM(hPx, cam.fovDeg)
  const bands: CoverageBand[] = []
  // Od najszerszej (detection) do najwęższej (identification) — rysowane w tej kolejności.
  for (const level of ['detection', 'observation', 'recognition', 'identification'] as DoriLevel[]) {
    const radiusModel = (radiiM[level] * 1000) / (unitMm || 1)
    let polygon = sectorPolygon(cam.position, cam.dirDeg, cam.fovDeg, radiusModel)
    if (room && room.length >= 3) polygon = clipToConvex(polygon, room)
    bands.push({ level, pxm: DORI_PXM[level], radiusModel, polygon })
  }
  return bands
}

// ── Audyt DORI: worst-case gęstość w pomieszczeniu + wzbogacenie urządzeń ────

export interface WorstCasePxm {
  /** Gęstość obrazu [px/m] w najdalszym wierzchołku pomieszczenia. */
  pxm: number
  /** Dystans do najdalszego wierzchołka [m]. */
  distM: number
  /** Najdalszy wierzchołek (jednostki modelu). */
  corner: Point
  /** Kierunek patrzenia kamery [deg] — na centroid pomieszczenia (reużywany w renderze). */
  dirDeg: number
}

/**
 * Worst-case DORI kamery w pomieszczeniu: gęstość px/m w NAJDALSZYM wierzchołku obrysu.
 * Konserwatywne dystansowo, liberalne kątowo (zakładamy, że kamerę da się wyregulować tak,
 * by objąć pokój — pokrycie kątowe to osobna, przyszła reguła). Kamera w rogu działa
 * naturalnie (najdalszy wierzchołek = przekątna). `null` gdy brak obrysu lub złe unitMm.
 */
export function worstCasePxm(
  cam: { position: Point; mp: number; fovDeg: number },
  room: Point[] | null | undefined,
  unitMm: number
): WorstCasePxm | null {
  if (!room || room.length < 3 || !(unitMm > 0)) return null
  let corner = room[0]
  let maxDist = -1
  let cx = 0
  let cy = 0
  for (const p of room) {
    cx += p.x
    cy += p.y
    const d = Math.hypot(p.x - cam.position.x, p.y - cam.position.y)
    if (d > maxDist) {
      maxDist = d
      corner = p
    }
  }
  const distM = (maxDist * unitMm) / 1000
  const dirDeg =
    (Math.atan2(cy / room.length - cam.position.y, cx / room.length - cam.position.x) * 180) / Math.PI
  return {
    pxm: pxPerMeterAt(distM, hPixelsFromMp(cam.mp), cam.fovDeg),
    distM,
    corner,
    dirDeg
  }
}

/** Minimalny kształt urządzenia/pomieszczenia (strukturalnie zgodny z Device/Space ze schematu). */
interface DeviceLike {
  system: string
  typeKey: string
  position: Point
  spaceId?: string
  props: Record<string, unknown>
}
interface SpaceLike {
  id: string
  polygon: Point[]
}

/** Parametry optyki per typ kamery (spójne z defaultProps w CCTV_DEVICE_TYPES). */
const CAMERA_DEFAULTS: Record<string, { mp: number; fov: number; doriTarget: number }> = {
  'cctv.dome.4mp': { mp: 4, fov: 110, doriTarget: 62.5 }, // observation w całym pomieszczeniu
  'cctv.bullet.4mp': { mp: 4, fov: 90, doriTarget: 125 } // recognition
}

function pointInPolygon(pt: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * Wzbogaca urządzenia CCTV o realne dane DORI przed audytem norm (PN-EN 62676-4):
 * uzupełnia `mp`/`fov`/`doriTarget` z defaults typu (BEZ nadpisywania wartości z atrybutów
 * DXF) i liczy `doriResolutionPxM` = worst-case px/m w pomieszczeniu kamery. Pokój po
 * `spaceId`, fallback: point-in-polygon. Brak pomieszczenia → `doriResolutionPxM = 0`
 * (reguła traktuje 0 jako „brak danych" = exempt; nie Infinity — musi się serializować).
 * Czysta funkcja — zwraca nowe obiekty, nie mutuje wejścia.
 */
export function applyDoriProps<D extends DeviceLike>(
  devices: D[],
  spaces: SpaceLike[],
  unitMm: number
): D[] {
  return devices.map((d) => {
    if (d.system !== 'cctv') return d
    const defs = CAMERA_DEFAULTS[d.typeKey] ?? CAMERA_DEFAULTS['cctv.dome.4mp']
    const mp = typeof d.props.mp === 'number' ? (d.props.mp as number) : defs.mp
    const fov = typeof d.props.fov === 'number' ? (d.props.fov as number) : defs.fov
    const doriTarget =
      typeof d.props.doriTarget === 'number' ? (d.props.doriTarget as number) : defs.doriTarget
    const room =
      (d.spaceId ? spaces.find((s) => s.id === d.spaceId) : undefined) ??
      spaces.find((s) => s.polygon.length >= 3 && pointInPolygon(d.position, s.polygon))
    const wc = worstCasePxm({ position: d.position, mp, fovDeg: fov }, room?.polygon, unitMm)
    return {
      ...d,
      props: {
        ...d.props,
        mp,
        fov,
        doriTarget,
        doriResolutionPxM: wc ? Math.round(wc.pxm * 10) / 10 : 0
      }
    }
  })
}
