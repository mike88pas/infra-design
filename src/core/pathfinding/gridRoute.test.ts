import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { GridRouter, segmentsIntersect, type Segment, type GridBBox } from './gridRoute'
import { autoDesign } from '@domain/installations/autodesign'
import type { Point, DxfRoom } from '@domain/model/schema'

const BB100: GridBBox = { minX: 0, minY: 0, maxX: 100, maxY: 100 }

/** Czy żaden odcinek trasy nie przecina żadnej ściany. */
function noCrossings(path: Point[], walls: Segment[]): boolean {
  for (let i = 0; i < path.length - 1; i++) {
    for (const w of walls) {
      if (segmentsIntersect(path[i], path[i + 1], w.a, w.b)) return false
    }
  }
  return true
}

describe('GridRouter — trasowanie ortogonalne omijające ściany', () => {
  it('bez ścian: trasa ≈ prosta (method grid), długość ≈ euklides', () => {
    const r = new GridRouter(BB100, [], [{ x: 90, y: 50 }])
    const res = r.routeFrom({ x: 10, y: 50 })
    expect(res.method).toBe('grid')
    expect(res.length).toBeGreaterThan(75)
    expect(res.length).toBeLessThan(90)
    expect(res.path.length).toBeGreaterThanOrEqual(2)
  })

  it('ściana z otworem (drzwi): trasa przechodzi przez otwór i NIE przecina ściany', () => {
    // Pionowa ściana x=50, przerwa y∈(40,60).
    const walls: Segment[] = [
      { a: { x: 50, y: 0 }, b: { x: 50, y: 40 } },
      { a: { x: 50, y: 60 }, b: { x: 50, y: 100 } }
    ]
    const r = new GridRouter(BB100, walls, [{ x: 90, y: 50 }])
    const res = r.routeFrom({ x: 10, y: 50 })
    expect(res.method).toBe('grid')
    expect(noCrossings(res.path, walls)).toBe(true)
    // Punkt przejścia przez x=50 leży w zakresie otworu.
    let crossedInGap = false
    for (let i = 0; i < res.path.length - 1; i++) {
      const a = res.path[i]
      const b = res.path[i + 1]
      if ((a.x - 50) * (b.x - 50) <= 0 && a.x !== b.x) {
        const t = (50 - a.x) / (b.x - a.x)
        const y = a.y + (b.y - a.y) * t
        if (y > 40 && y < 60) crossedInGap = true
      }
    }
    expect(crossedInGap).toBe(true)
  })

  it('ściana bez otworu zmusza do obejścia (trasa dłuższa niż prosta)', () => {
    // Ściana x=50 od y=0 do y=80 (przejście tylko górą, y>80).
    const walls: Segment[] = [{ a: { x: 50, y: 0 }, b: { x: 50, y: 80 } }]
    const r = new GridRouter(BB100, walls, [{ x: 90, y: 20 }])
    const res = r.routeFrom({ x: 10, y: 20 })
    expect(res.method).toBe('grid')
    expect(noCrossings(res.path, walls)).toBe(true)
    expect(res.length).toBeGreaterThan(80) // obejście górą » prosta 80
  })

  it('cel zamknięty murem → fallback prosta (method straight)', () => {
    // Szczelny box wokół celu (50,50); start na zewnątrz.
    const walls: Segment[] = [
      { a: { x: 40, y: 40 }, b: { x: 60, y: 40 } },
      { a: { x: 60, y: 40 }, b: { x: 60, y: 60 } },
      { a: { x: 60, y: 60 }, b: { x: 40, y: 60 } },
      { a: { x: 40, y: 60 }, b: { x: 40, y: 40 } }
    ]
    const r = new GridRouter(BB100, walls, [{ x: 50, y: 50 }])
    const res = r.routeFrom({ x: 10, y: 10 })
    expect(res.method).toBe('straight')
  })

  it('trasa ortogonalna: każdy odcinek poziomy lub pionowy', () => {
    const walls: Segment[] = [
      { a: { x: 50, y: 0 }, b: { x: 50, y: 40 } },
      { a: { x: 50, y: 60 }, b: { x: 50, y: 100 } }
    ]
    const r = new GridRouter(BB100, walls, [{ x: 90, y: 50 }])
    const res = r.routeFrom({ x: 10, y: 20 })
    for (let i = 0; i < res.path.length - 1; i++) {
      const a = res.path[i]
      const b = res.path[i + 1]
      const horizontal = Math.abs(a.y - b.y) < 1e-6
      const vertical = Math.abs(a.x - b.x) < 1e-6
      expect(horizontal || vertical).toBe(true)
    }
  })
})

describe('GridRouter — integracja na demo-floor.json', () => {
  const floor = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../web/src/data/demo-floor.json', import.meta.url)), 'utf-8')
  ) as {
    doc: { entities: { t: string; a?: Point; b?: Point }[]; bbox: GridBBox }
  }
  const walls: Segment[] = floor.doc.entities
    .filter((e) => e.t === 'line' && e.a && e.b)
    .map((e) => ({ a: e.a as Point, b: e.b as Point }))
  const rack: Point = { x: 10250, y: 2000 } // centroid SERWEROWNI

  it('wszystkie pomieszczenia dochodzą do szafy (grid, nie straight)', () => {
    const r = new GridRouter(floor.doc.bbox, walls, [rack], { inflate: 1 })
    const sources: Point[] = [
      { x: 2500, y: 2000 }, // BIURO 1
      { x: 2500, y: 6000 }, // BIURO 2
      { x: 6750, y: 4000 }, // OPEN SPACE
      { x: 10250, y: 6000 } // SALA KONF.
    ]
    for (const s of sources) {
      const res = r.routeFrom(s)
      expect(res.method).toBe('grid')
      expect(noCrossings(res.path, walls)).toBe(true)
    }
  })

  it('REALNE trasy demo (autoDesign jak w App): każda grid + zero przecięć ze ścianami', () => {
    const spaces = (floor as unknown as { spaces: { name: string; area: number; polygon: Point[] }[] }).spaces
    const centroid = (poly: Point[]): Point => ({
      x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
      y: poly.reduce((s, p) => s + p.y, 0) / poly.length
    })
    const rooms: DxfRoom[] = spaces.map((s, i) => ({
      number: String(i + 1),
      name: s.name,
      areaM2: s.area / 1_000_000,
      at: centroid(s.polygon),
      tag: s.polygon
    }))
    const design = autoDesign(rooms, {
      drawingId: 'demo',
      spacing: 650,
      rules: {
        cctv: { minRoomArea: 999, nameKeywords: ['open', 'konf', 'sala', 'serwer'] },
        ap: { m2PerAp: 100, minRoomArea: 18 }
      }
    })
    const seed = design.cabinets[0].at
    const router = new GridRouter(floor.doc.bbox, walls, [seed], { inflate: 1 })
    expect(design.devices.length).toBeGreaterThan(10)
    let straight = 0
    for (const d of design.devices) {
      const res = router.routeFrom(d.position)
      if (res.method === 'straight') straight++
      expect(noCrossings(res.path, walls)).toBe(true)
    }
    expect(straight).toBe(0) // żadne urządzenie nie spada do prostej przez ścianę
  })
})
