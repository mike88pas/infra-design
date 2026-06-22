/**
 * Trasy kablowe z wyniku sidecara A* (`route_cables`) → CableRoute[] (F2).
 *
 * Sidecar zwraca trasy w JEDNOSTKACH MODELU (mm dla rzutów mm). Tu przeliczamy na
 * metry przez `unitMm` (mm na jednostkę modelu) i wiążemy z urządzeniami/szafami,
 * żeby BOM/kosztorys policzył metry kabla. Źródła muszą być w tej samej kolejności,
 * w jakiej trafiły do `route_cables` (sourceIndex ↔ devices[i]).
 */

import type { CableRoute, Device, Id, Point, SystemKey } from '@domain/model/schema'

export interface SidecarRoute {
  sourceIndex: number
  targetIndex: number
  path: Point[]
  /** Długość w jednostkach modelu. */
  length: number
  method: 'astar' | 'straight'
}

export interface BuildCableRoutesInput {
  /** Urządzenia-źródła w kolejności przekazanej do route_cables. */
  devices: Device[]
  routes: SidecarRoute[]
  /** mm na jednostkę modelu (z kalibracji). */
  unitMm: number
  /** Id szaf po targetIndex (cel trasy). */
  cabinetIds?: Id[]
  cableType?: string
  system?: SystemKey
}

const DEFAULT_CABLE = 'U/UTP kat.6 LSOH'

/** Buduje CableRoute[] (długości w metrach) z tras sidecara. */
export function buildCableRoutes(input: BuildCableRoutesInput): CableRoute[] {
  const { devices, routes, unitMm } = input
  const cableType = input.cableType ?? DEFAULT_CABLE
  const out: CableRoute[] = []

  for (const r of routes) {
    const dev = devices[r.sourceIndex]
    if (!dev) continue
    const cabinetId = input.cabinetIds?.[r.targetIndex] ?? `rack-${r.targetIndex}`
    out.push({
      id: `route-${dev.id}`,
      system: input.system ?? dev.system,
      path: r.path,
      cableType,
      length: (r.length * unitMm) / 1000, // jedn. modelu → mm → m
      from: { deviceId: dev.id, port: 'a' },
      to: { deviceId: cabinetId, port: 'b' }
    })
  }

  return out
}

/** Suma metrów kabla per typ (szybki podgląd przed BOM). */
export function totalCableMeters(routes: CableRoute[]): number {
  return routes.reduce((s, r) => s + r.length, 0)
}
