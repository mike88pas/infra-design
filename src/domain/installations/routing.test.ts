import { describe, it, expect } from 'vitest'
import type { Device } from '@domain/model/schema'
import { buildCableRoutes, totalCableMeters } from './routing'
import type { SidecarRoute } from './routing'
import { buildBom } from './bom'

const dev = (id: string, typeKey: string): Device => ({
  id,
  drawingId: 'd1',
  system: 'lan',
  typeKey,
  position: { x: 0, y: 0 },
  rotation: 0,
  props: {},
  connections: []
})

const devices = [dev('L1-1', 'lan.outlet.2x'), dev('L1-2', 'lan.outlet.2x')]

// Sidecar zwraca długości w jednostkach modelu (mm). 40000 mm = 40 m, 60000 mm = 60 m.
const sidecarRoutes: SidecarRoute[] = [
  { sourceIndex: 0, targetIndex: 0, path: [{ x: 0, y: 0 }, { x: 0, y: 40000 }], length: 40000, method: 'astar' },
  { sourceIndex: 1, targetIndex: 0, path: [{ x: 0, y: 0 }, { x: 0, y: 60000 }], length: 60000, method: 'astar' }
]

describe('buildCableRoutes — trasy sidecara → CableRoute[] (metry)', () => {
  const routes = buildCableRoutes({ devices, routes: sidecarRoutes, unitMm: 1, cabinetIds: ['RK1'] })

  it('przelicza jednostki modelu na metry przez unitMm', () => {
    expect(routes[0].length).toBeCloseTo(40, 6)
    expect(routes[1].length).toBeCloseTo(60, 6)
    expect(totalCableMeters(routes)).toBeCloseTo(100, 6)
  })

  it('wiąże trasę z urządzeniem (from) i szafą (to)', () => {
    expect(routes[0].from.deviceId).toBe('L1-1')
    expect(routes[0].to.deviceId).toBe('RK1')
    expect(routes[0].cableType).toBe('U/UTP kat.6 LSOH')
  })

  it('skala m (unitMm=1000): 40 jedn. modelu = 40000 mm = 40 m', () => {
    const inM = buildCableRoutes({ devices, routes: [{ ...sidecarRoutes[0], length: 40 }], unitMm: 1000 })
    expect(inM[0].length).toBeCloseTo(40, 6)
  })

  it('BOM liczy metry kabla z tras (100 m + 5% = 105)', () => {
    const bom = buildBom({ devices, routes, trays: [] })
    expect(bom.find((b) => b.catalogRef === 'cable.utp.cat6')?.qty).toBe(105)
  })
})
