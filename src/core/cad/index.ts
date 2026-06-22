/**
 * Rdzeń CAD (generic) — publiczne API renderera rzutu.
 * Niezależny od Electrona/instalacji; konsumuje czyste dane modelu.
 */

import type { DetectedPolygon } from '@domain/model/schema'
import type { RenderSpace } from './CadScene'

export { CadScene } from './CadScene'
export type { RenderSpace, CadSceneOptions } from './CadScene'

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
