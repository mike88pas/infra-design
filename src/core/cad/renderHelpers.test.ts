import { describe, it, expect } from 'vitest'
import { traysToRender, coverageForDevices } from './index'
import type { Tray } from '@domain/model/schema'

describe('traysToRender — jednostki (Tray.path w mm → model)', () => {
  const tray: Tray = {
    id: 't1',
    drawingId: 'd1',
    path: [
      { x: 0, y: 1000 },
      { x: 5000, y: 1000 }
    ],
    type: 'perforated',
    widthMm: 100,
    fillPercent: 12,
    level: 0
  }

  it('unitMm=1 (rzut w mm): path bez zmian, widthWorld=100', () => {
    const [r] = traysToRender([tray], () => 1)
    expect(r.path[1].x).toBe(5000)
    expect(r.widthWorld).toBe(100)
    expect(r.widthMm).toBe(100)
  })

  it('unitMm=25: path i szerokość przeliczone (ryzyko 25×)', () => {
    const [r] = traysToRender([tray], () => 25)
    expect(r.path[1].x).toBe(200) // 5000 mm / 25 mm-na-jednostkę
    expect(r.widthWorld).toBe(4) // 100/25
  })

  it('unitMm per drawingId (różne rysunki, różne skale)', () => {
    const t2: Tray = { ...tray, id: 't2', drawingId: 'd2' }
    const out = traysToRender([tray, t2], (id) => (id === 'd2' ? 10 : 1))
    expect(out[0].path[1].x).toBe(5000)
    expect(out[1].path[1].x).toBe(500)
  })
})

describe('coverageForDevices — strefy DORI dla kamer', () => {
  const spaces = [
    {
      id: 'sp1',
      polygon: [
        { x: 0, y: 0 },
        { x: 5000, y: 0 },
        { x: 5000, y: 4000 },
        { x: 0, y: 4000 }
      ]
    }
  ]

  it('kamera w pokoju → 4 strefy przycięte do obrysu; nie-CCTV pomijane', () => {
    const devices = [
      { id: 'cam1', system: 'cctv', position: { x: 200, y: 200 }, spaceId: 'sp1', props: { mp: 4, fov: 110 } },
      { id: 'ap1', system: 'lan', position: { x: 0, y: 0 }, props: {} }
    ]
    const cov = coverageForDevices(devices, spaces, 1)
    expect(cov).toHaveLength(1)
    expect(cov[0].deviceId).toBe('cam1')
    expect(cov[0].bands.map((b) => b.level)).toEqual([
      'detection',
      'observation',
      'recognition',
      'identification'
    ])
    for (const b of cov[0].bands) {
      for (const p of b.polygon) {
        expect(p.x).toBeGreaterThanOrEqual(-1)
        expect(p.x).toBeLessThanOrEqual(5001)
      }
    }
  })

  it('kamera bez pomieszczenia → sektor bez przycięcia (informacyjnie), nie wybucha', () => {
    const cov = coverageForDevices(
      [{ id: 'c', system: 'cctv', position: { x: 0, y: 0 }, props: {} }],
      spaces,
      1
    )
    expect(cov).toHaveLength(1)
    expect(cov[0].bands.length).toBe(4)
  })
})
