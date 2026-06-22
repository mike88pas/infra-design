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
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'sample-floor.dxf')

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
const bridge = canRun ? new SidecarBridge({ scriptDir: SCRIPT_DIR, python: python! }) : null

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
