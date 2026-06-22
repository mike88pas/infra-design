import { describe, it, expect } from 'vitest'
import {
  createEmptyBundle,
  createEmptyProject,
  type CableRoute,
  type ProjectBundle
} from '@domain/model/schema'
import { buildExportDocument, LEGAL_DISCLAIMER } from './document'

function bundleFixture(): ProjectBundle {
  const project = createEmptyProject({ id: 'p1', name: 'Pilot LAN — biuro', client: 'ACME sp. z o.o.', now: '2026-06-21T00:00:00Z' })
  const b = createEmptyBundle(project)
  b.devices = [
    { id: 'L1', drawingId: 'd1', system: 'lan', typeKey: 'lan.outlet.2x', position: { x: 0, y: 0 }, rotation: 0, props: {}, connections: [] },
    { id: 'L2', drawingId: 'd1', system: 'lan', typeKey: 'lan.outlet.2x', position: { x: 0, y: 0 }, rotation: 0, props: {}, connections: [] }
  ]
  const r: CableRoute = { id: 'R1', system: 'lan', path: [], cableType: 'U/UTP kat.6 LSOH', length: 50, from: { deviceId: 'L1', port: 'a' }, to: { deviceId: 'RK', port: 'b' } }
  b.routes = [r]
  return b
}

describe('buildExportDocument — model dokumentu eksportowego', () => {
  const doc = buildExportDocument(bundleFixture())

  it('zawiera metrykę projektu i klienta', () => {
    expect(doc.meta.projectName).toBe('Pilot LAN — biuro')
    expect(doc.meta.client).toBe('ACME sp. z o.o.')
  })

  it('ma projektanta z miejscem na podpis (software nie podpisuje)', () => {
    expect(doc.designer.signaturePlaceholder).toBe(true)
  })

  it('zawiera klauzulę prawną o niezastępowaniu projektanta', () => {
    expect(doc.disclaimer).toBe(LEGAL_DISCLAIMER)
    expect(doc.disclaimer).toContain('nie zastępuje projektanta')
  })

  it('składa BOM i kosztorys z dodatnią kwotą brutto', () => {
    expect(doc.bom.length).toBeGreaterThan(0)
    expect(doc.cost.gross).toBeGreaterThan(0)
    expect(doc.cost.gross).toBeGreaterThan(doc.cost.net)
  })

  it('dołącza podsumowanie audytu norm', () => {
    expect(doc.audit.summary.total).toBeGreaterThanOrEqual(1)
  })
})
