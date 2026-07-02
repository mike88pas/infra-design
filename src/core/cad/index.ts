/**
 * Rdzeń CAD (generic) — publiczne API renderera rzutu.
 * Niezależny od Electrona/instalacji; konsumuje czyste dane modelu.
 */

import type { DetectedPolygon, Point, Tray } from '@domain/model/schema'
import type { RenderSpace, RenderCoverage, RenderTray } from './CadScene'
import { cameraCoverageBands, worstCasePxm } from '@domain/installations/cctvCoverage'

export { CadScene } from './CadScene'
export type {
  RenderSpace,
  RenderDevice,
  RenderRoute,
  RenderCoverage,
  RenderTray,
  RenderExtras,
  CadSceneOptions,
  SheetInfo
} from './CadScene'

/**
 * Mapuje surowe wieloboki z `polygonize` na renderowalne pomieszczenia,
 * nadając Id i tymczasowe nazwy (projektant zmienia je w UI).
 */
export function polygonsToSpaces(polygons: DetectedPolygon[], prefix = 'Pom.'): RenderSpace[] {
  return polygons.map((p, i) => ({
    id: `space-${i + 1}`,
    name: `${prefix} ${i + 1}`,
    polygon: p.points,
    area: p.area
  }))
}

/**
 * Tray[] z bundla → RenderTray[]. UWAGA na jednostki: `Tray.path` jest w MILIMETRACH
 * (tak liczy `deriveTrays`), a scena rysuje w jednostkach modelu — dzielimy przez
 * `unitMm` danego rysunku. `unitMmOf` zwraca mm/jednostkę dla drawingId (z Drawing.transform[0]).
 */
export function traysToRender(trays: Tray[], unitMmOf: (drawingId: string) => number): RenderTray[] {
  return trays.map((t) => {
    const u = unitMmOf(t.drawingId) || 1
    return {
      id: t.id,
      path: t.path.map((p) => ({ x: p.x / u, y: p.y / u })),
      widthWorld: t.widthMm / u,
      widthMm: t.widthMm
    }
  })
}

/** Minimalne kształty wejść (strukturalnie zgodne z Device/Space ze schematu). */
interface CoverageDevice {
  id: string
  system: string
  position: Point
  spaceId?: string
  props: Record<string, unknown>
}
interface CoverageSpace {
  id: string
  polygon: Point[]
}

/**
 * Strefy pokrycia DORI dla kamer CCTV → RenderCoverage[]. Kierunek kamery = na centroid
 * jej pomieszczenia (z `worstCasePxm`); sektor przycięty do obrysu pokoju. Kamera bez
 * pomieszczenia → sektor bez przycięcia (informacyjnie). Wymaga `mp`/`fov` w props
 * (uzupełnia je `applyDoriProps` w pipeline importu).
 */
export function coverageForDevices(
  devices: CoverageDevice[],
  spaces: CoverageSpace[],
  unitMm: number
): RenderCoverage[] {
  const out: RenderCoverage[] = []
  for (const d of devices) {
    if (d.system !== 'cctv') continue
    const mp = typeof d.props.mp === 'number' ? (d.props.mp as number) : 4
    const fov = typeof d.props.fov === 'number' ? (d.props.fov as number) : 110
    const room = d.spaceId ? spaces.find((s) => s.id === d.spaceId)?.polygon : undefined
    const wc = worstCasePxm({ position: d.position, mp, fovDeg: fov }, room, unitMm)
    const dirDeg = wc?.dirDeg ?? 0
    const bands = cameraCoverageBands(
      { position: d.position, dirDeg, mp, fovDeg: fov },
      unitMm,
      room ?? null
    )
    out.push({
      deviceId: d.id,
      system: d.system,
      bands: bands.map((b) => ({ level: b.level, polygon: b.polygon }))
    })
  }
  return out
}
