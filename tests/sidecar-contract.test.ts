/**
 * Test kontraktowy mostu TS ↔ Python (SidecarBridge → server.py).
 *
 * Sprawdza realne wywołania import_dxf/polygonize przez stdio na fixture DXF.
 * Pomijany, gdy interpreter sidecara nie jest dostępny (np. job CI bez venv) —
 * stronę Pythona pokrywa wtedy `sidecar/tests/test_geometry.py`.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { SidecarBridge } from '../src/main/sidecar'

const ROOT = join(__dirname, '..')
const SCRIPT_DIR = join(ROOT, 'sidecar', 'geometry')
const FIXTURE_DIR = join(ROOT, 'tests', 'fixtures')
const FIXTURE = join(FIXTURE_DIR, 'sample-floor.dxf')
const OFFICE = join(FIXTURE_DIR, 'sample_office_clean.dxf')

interface Pt {
  x: number
  y: number
}

function resolvePython(): string | null {
  const env = process.env.INFRA_PYTHON
  if (env && existsSync(env)) return env
  const venv = join(ROOT, 'sidecar', '.venv', 'Scripts', 'python.exe')
  if (existsSync(venv)) return venv
  const venvNix = join(ROOT, 'sidecar', '.venv', 'bin', 'python')
  if (existsSync(venvNix)) return venvNix
  return null
}

const python = resolvePython()
const canRun = python !== null && existsSync(FIXTURE)
const bridge = canRun
  ? new SidecarBridge({ scriptDir: SCRIPT_DIR, python: python!, allowedRoots: [FIXTURE_DIR] })
  : null

afterAll(() => bridge?.stop())

describe.skipIf(!canRun)('SidecarBridge ↔ server.py (kontrakt IPC)', () => {
  it('import_dxf zwraca DxfDocument zgodny z kontraktem', async () => {
    const doc = await bridge!.importDxf(FIXTURE)
    expect(doc.units).toBe('mm')
    expect(doc.entityCount).toBe(doc.entities.length)
    expect(doc.entityCount).toBeGreaterThan(0)
    expect(doc.bbox.maxX).toBeCloseTo(12000, 0)
    expect(doc.layers.map((l) => l.name)).toEqual(expect.arrayContaining(['WALLS', 'DOORS', 'TEXT']))
    for (const l of doc.layers) expect(l.color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('polygonize wykrywa 5 pomieszczeń (~96 m²)', async () => {
    const res = await bridge!.polygonize({ path: FIXTURE, wallLayers: ['WALLS'] })
    expect(res.polygons).toHaveLength(5)
    const totalM2 = res.polygons.reduce((s, p) => s + p.area, 0) / 1_000_000
    expect(totalM2).toBeCloseTo(96, 0)
    for (const p of res.polygons) expect(p.points.length).toBeGreaterThanOrEqual(3)
  })
})

// Eksport DXF: koryta kablowe muszą trafić na rysunek (warstwa INSTAL-KORYTA + etykieta).
describe.skipIf(!canRun)('export_dxf — koryta na rysunku (INSTAL-KORYTA)', () => {
  it('zapisuje LWPOLYLINE koryta z etykietą KORYTO 100', async () => {
    const { mkdtempSync, rmSync, readFileSync: read } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const tmp = mkdtempSync(join(tmpdir(), 'infra-dxf-'))
    try {
      const out = join(tmp, 'instalacja.dxf')
      const res = await bridge!.exportDxf({
        path: out,
        devices: [{ system: 'lan', typeKey: 'lan.outlet.2x', position: { x: 1000, y: 1000 } }],
        routes: [{ path: [{ x: 1000, y: 1000 }, { x: 5000, y: 1000 }], system: 'lan' }],
        trays: [
          { path: [{ x: 1000, y: 900 }, { x: 5000, y: 900 }], widthDraw: 100, widthMm: 100 }
        ],
        rooms: [],
        cabinets: [{ x: 5000, y: 1000 }],
        legend: [],
        meta: { project: 'TEST', drawing: 'T', designer: '', license: '' },
        _allowedRoots: [tmp]
      })
      expect((res as unknown as { trays: number }).trays).toBe(1)
      const dxf = read(out, 'utf-8')
      expect(dxf).toContain('INSTAL-KORYTA')
      expect(dxf).toContain('KORYTO 100')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

// Router: otwory drzwiowe (doorLayers) muszą „przebijać" ściany — bez nich kable z pokoi
// zamkniętych spadają do prostej (przez mur), z nimi trasują się przez drzwi.
describe.skipIf(!canRun || !existsSync(OFFICE))('route_cables — trasowanie przez drzwi (A-DOOR)', () => {
  const centroid = (pts: Pt[]): Pt => ({
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length
  })

  it('doorLayers eliminuje trasy „straight" przez ścianę (sealed rooms → przez drzwi)', async () => {
    const poly = await bridge!.polygonize({ path: OFFICE, wallLayers: ['A-WALL'] })
    expect(poly.polygons.length).toBe(9)
    const sources = poly.polygons.map((p) => centroid(p.points))
    const rack = centroid(sources) // centroid wszystkich — jak autoDesign (cel tras)

    const base = { path: OFFICE, sources, targets: [rack], wallLayers: ['A-WALL'] }
    const without = await bridge!.routeCables(base)
    const withDoors = await bridge!.routeCables({ ...base, doorLayers: ['DOOR'], doorClear: 2 })

    const straight = (r: { routes: { method: string }[] }): number =>
      r.routes.filter((x) => x.method === 'straight').length

    // Bez drzwi: większość pokoi odcięta (prosto przez mur). Z drzwiami: zero prostych.
    expect(straight(without)).toBeGreaterThan(3)
    expect(straight(withDoors)).toBe(0)
  })
})
