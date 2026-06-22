import { describe, it, expect } from 'vitest'
import {
  createEmptyBundle,
  createEmptyProject,
  type CableRoute,
  type Device,
  type ProjectBundle,
  type Tray
} from '@domain/model/schema'
import { runAudit, summarizeAudit } from './audit'

function bundleFixture(): ProjectBundle {
  const project = createEmptyProject({ id: 'p1', name: 'Audyt test', now: '2026-06-21T00:00:00Z' })
  const b = createEmptyBundle(project)

  const camFail: Device = {
    id: 'C-fail', drawingId: 'd1', system: 'cctv', typeKey: 'cctv.dome.4mp',
    position: { x: 0, y: 0 }, rotation: 0, props: { doriTarget: 250, doriResolutionPxM: 180 }, connections: []
  }
  const camOk: Device = {
    id: 'C-ok', drawingId: 'd1', system: 'cctv', typeKey: 'cctv.dome.4mp',
    position: { x: 0, y: 0 }, rotation: 0, props: { doriTarget: 125, doriResolutionPxM: 160 }, connections: []
  }
  const longRun: CableRoute = {
    id: 'R-long', system: 'lan', path: [], cableType: 'U/UTP kat.6 LSOH', length: 95,
    from: { deviceId: 'x', port: 'a' }, to: { deviceId: 'RK', port: 'b' }
  }
  const shortRun: CableRoute = {
    id: 'R-short', system: 'lan', path: [], cableType: 'U/UTP kat.6 LSOH', length: 40,
    from: { deviceId: 'y', port: 'a' }, to: { deviceId: 'RK', port: 'b' }
  }
  const trayFull: Tray = { id: 'T-full', drawingId: 'd1', path: [], type: 'perforated', widthMm: 100, fillPercent: 46, level: 0 }
  const trayOk: Tray = { id: 'T-ok', drawingId: 'd1', path: [], type: 'perforated', widthMm: 100, fillPercent: 30, level: 0 }

  b.devices = [camFail, camOk]
  b.routes = [longRun, shortRun]
  b.trays = [trayFull, trayOk]
  return b
}

describe('runAudit — silnik audytu po projekcie', () => {
  const results = runAudit(bundleFixture())

  it('wykrywa kanał LAN > 90 m (błąd)', () => {
    const r = results.find((x) => x.targetId === 'R-long')
    expect(r?.status).toBe('fail')
    expect(r?.severity).toBe('error')
    expect(results.find((x) => x.targetId === 'R-short')?.status).toBe('pass')
  })

  it('wykrywa kamerę nie spełniającą DORI (ostrzeżenie)', () => {
    expect(results.find((x) => x.targetId === 'C-fail')?.status).toBe('fail')
    expect(results.find((x) => x.targetId === 'C-ok')?.status).toBe('pass')
  })

  it('wykrywa przepełnione korytko (> 40%)', () => {
    expect(results.find((x) => x.targetId === 'T-full')?.status).toBe('fail')
    expect(results.find((x) => x.targetId === 'T-ok')?.status).toBe('pass')
  })

  it('podsumowanie: 3 niezgodności (1 błąd, 2 ostrzeżenia)', () => {
    const s = summarizeAudit(results)
    expect(s.failed).toBe(3)
    expect(s.errors).toBe(1)
    expect(s.warnings).toBe(2)
    expect(s.passed).toBe(3)
  })
})
