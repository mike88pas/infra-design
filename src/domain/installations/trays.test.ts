import { describe, it, expect } from 'vitest'
import { deriveTrays, trayMetersByWidth } from './trays'
import type { CableRoute, Point } from '@domain/model/schema'

function route(id: string, path: Point[]): CableRoute {
  return {
    id,
    system: 'lan',
    path,
    cableType: 'U/UTP kat.6 LSOH',
    length: 0,
    from: { deviceId: id, port: 'a' },
    to: { deviceId: 'rack', port: 'b' }
  }
}

describe('deriveTrays — koryta nośne z tras (backbone)', () => {
  it('wspólny korytarz liczony RAZ (dedup), nie N× — metry = długość backbone', () => {
    // Dwie trasy wchodzą w korytarz (y=1000) w różnych punktach, wspólny odcinek x∈[2000,5000].
    const routes = [
      route('a', [{ x: 0, y: 0 }, { x: 0, y: 1000 }, { x: 5000, y: 1000 }]),
      route('b', [{ x: 2000, y: 0 }, { x: 2000, y: 1000 }, { x: 5000, y: 1000 }])
    ]
    const trays = deriveTrays(routes, 1, { minCables: 2 })
    expect(trays.length).toBeGreaterThanOrEqual(1)
    const total = Object.values(trayMetersByWidth(trays)).reduce((s, m) => s + m, 0)
    // Wspólny fragment 2000→5000 = 3 m (NIE 6 m — brak podwójnego liczenia).
    expect(total).toBeGreaterThan(2.7)
    expect(total).toBeLessThan(3.4)
  })

  it('pojedynczy drop (1 kabel) NIE dostaje korytka', () => {
    const trays = deriveTrays([route('solo', [{ x: 0, y: 0 }, { x: 0, y: 3000 }])], 1, { minCables: 2 })
    expect(trays).toHaveLength(0)
  })

  it('szerokość rośnie z liczbą kabli (wypełnienie PN-EN 61537 ≤ 40%)', () => {
    // 2 kable na wspólnym odcinku → 100 mm; 60 kabli → 200 mm.
    const corridor = (id: string): CableRoute => route(id, [{ x: 0, y: 1000 }, { x: 4000, y: 1000 }])
    const few = deriveTrays([corridor('x1'), corridor('x2')], 1, { minCables: 2 })
    expect(few.every((t) => t.widthMm === 100)).toBe(true)

    const many = deriveTrays(
      Array.from({ length: 60 }, (_, i) => corridor(`c${i}`)),
      1,
      { minCables: 2 }
    )
    expect(many.some((t) => t.widthMm === 200)).toBe(true)
    for (const t of many) expect(t.fillPercent).toBeLessThanOrEqual(40)
  })

  it('brak tras → brak koryt', () => {
    expect(deriveTrays([], 1)).toHaveLength(0)
  })
})
