import { describe, it, expect } from 'vitest'
import { parseProjectBundle } from './validate'
import { createEmptyBundle, createEmptyProject, SCHEMA_VERSION } from './schema'

function goodBundle() {
  const p = createEmptyProject({ id: 'p1', name: 'Test', now: '2026-06-23T00:00:00.000Z' })
  return createEmptyBundle(p)
}

describe('parseProjectBundle — walidacja paczki .infra', () => {
  it('przepuszcza poprawną paczkę i normalizuje', () => {
    const out = parseProjectBundle(goodBundle())
    expect(out.project.id).toBe('p1')
    expect(out.devices).toEqual([])
    expect(out.project.activeSystems).toEqual(['lan', 'cctv'])
  })

  it('uzupełnia brakujące kolekcje pustymi tablicami', () => {
    const b = goodBundle() as unknown as Record<string, unknown>
    delete b.devices
    delete b.routes
    const out = parseProjectBundle(b)
    expect(out.devices).toEqual([])
    expect(out.routes).toEqual([])
  })

  it('odrzuca brak project', () => {
    expect(() => parseProjectBundle({})).toThrow(/project/)
  })

  it('odrzuca schemaVersion z przyszłości', () => {
    const b = goodBundle()
    b.project.schemaVersion = SCHEMA_VERSION + 1
    expect(() => parseProjectBundle(b)).toThrow(/nowsz/)
  })

  it('odrzuca niedozwolony system', () => {
    const b = goodBundle() as unknown as { project: { activeSystems: string[] } }
    b.project.activeSystems = ['lan', 'evil']
    expect(() => parseProjectBundle(b)).toThrow(/activeSystems/)
  })

  it('odrzuca NaN/Infinity w geometrii urządzenia', () => {
    const b = goodBundle() as unknown as { devices: unknown[] }
    b.devices = [{ id: 'd1', position: { x: Number.NaN, y: 0 } }]
    expect(() => parseProjectBundle(b)).toThrow(/skończon/)
  })

  it('odrzuca NaN w polygonie pomieszczenia', () => {
    const b = goodBundle() as unknown as { spaces: unknown[] }
    b.spaces = [{ id: 's1', polygon: [{ x: 0, y: 0 }, { x: Infinity, y: 1 }] }]
    expect(() => parseProjectBundle(b)).toThrow(/skończon/)
  })

  it('odrzuca tablicę przekraczającą limit', () => {
    const b = goodBundle() as unknown as { spaces: unknown[] }
    b.spaces = new Array(50_001).fill({ id: 's', polygon: [] })
    expect(() => parseProjectBundle(b)).toThrow(/limit/)
  })

  it('odrzuca pole tekstowe przekraczające limit długości', () => {
    const b = goodBundle()
    b.project.name = 'x'.repeat(2000)
    expect(() => parseProjectBundle(b)).toThrow(/długości/)
  })

  it('odrzuca kolekcję, która nie jest tablicą', () => {
    const b = goodBundle() as unknown as { devices: unknown }
    b.devices = { not: 'array' }
    expect(() => parseProjectBundle(b)).toThrow(/tablic/)
  })
})
