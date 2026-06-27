/**
 * Testy zagospodarowania szaf (elewacja 19").
 * 1) Domena `buildRacks` — alokacja U bez kolizji, wysokość ≤ uHeight, etykiety.
 * 2) Kontrakt eksportu DXF (sidecar `export_rack_elevation`) — plik powstaje, liczby się zgadzają.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildRacks } from '../src/domain/installations/rack'
import { SidecarBridge } from '../src/main/sidecar'
import type { Device } from '../src/domain/model/schema'

function outlets(n: number): Device[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `d${i}`,
    drawingId: 'L0',
    system: 'lan',
    typeKey: 'lan.outlet.2x',
    position: { x: 0, y: 0 },
    rotation: 0,
    props: {},
    connections: []
  }))
}

describe('buildRacks — elewacja 19"', () => {
  const racks = buildRacks(outlets(60), [{ id: 'L0::rack', name: 'Szafa IDF — Parter' }])

  it('tworzy szafę z pozycjami U', () => {
    expect(racks).toHaveLength(1)
    expect(racks[0].uHeight).toBe(42)
    expect(racks[0].units.length).toBeGreaterThan(0)
  })

  it('alokacja U bez kolizji i w granicach szafy', () => {
    const occupied = new Set<number>()
    for (const u of racks[0].units) {
      expect(u.uPos).toBeGreaterThanOrEqual(1)
      expect(u.uPos + u.uSize - 1).toBeLessThanOrEqual(racks[0].uHeight)
      for (let k = 0; k < u.uSize; k++) {
        const slot = u.uPos + k
        expect(occupied.has(slot)).toBe(false) // brak nakładania
        occupied.add(slot)
      }
    }
  })

  it('zawiera przełącznice i switche (z katalogu)', () => {
    const labels = racks[0].units.map((u) => u.label).join(' ')
    expect(labels).toContain('XPS00')
    expect(labels).toContain('OS6560-P24X4-EU')
  })

  it('brak szaf, gdy brak portów LAN', () => {
    expect(buildRacks([], [])).toHaveLength(0)
  })
})

// ── Kontrakt eksportu DXF ────────────────────────────────────────────────────

const ROOT = join(__dirname, '..')
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
const tmp = mkdtempSync(join(tmpdir(), 'infra-rack-'))
const bridge = python
  ? new SidecarBridge({ scriptDir: join(ROOT, 'sidecar', 'geometry'), python, allowedRoots: [tmp] })
  : null

afterAll(() => {
  bridge?.stop()
  try {
    rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe.skipIf(!python)('export_rack_elevation → DXF (kontrakt)', () => {
  it('zapisuje DXF z elewacją szaf', async () => {
    const racks = buildRacks(outlets(60), [{ id: 'L0::rack', name: 'Szafa IDF — Parter' }])
    const out = join(tmp, 'szafy.dxf')
    const res = await bridge!.exportRackElevation({
      path: out,
      racks,
      meta: { project: 'TEST' },
      _allowedRoots: [tmp]
    })
    expect(existsSync(res.path)).toBe(true)
    expect(res.racks).toBe(1)
    expect(res.units).toBe(racks[0].units.length)
  })
})
