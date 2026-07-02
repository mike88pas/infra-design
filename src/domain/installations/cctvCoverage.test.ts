import { describe, it, expect } from 'vitest'
import {
  hPixelsFromMp,
  pxPerMeterAt,
  distanceForPxM,
  doriRadiiM,
  worstCasePxm,
  applyDoriProps,
  cameraCoverageBands
} from './cctvCoverage'

// Referencja: 4 Mpx 16:9 → hPx = √(4e6·16/9) ≈ 2667; dome 110° → pxm(d) ≈ 933,7/d.

describe('cctvCoverage — matematyka DORI (PN-EN 62676-4)', () => {
  it('hPixelsFromMp: 4 Mpx (16:9) ≈ 2667 px', () => {
    expect(hPixelsFromMp(4)).toBeGreaterThan(2660)
    expect(hPixelsFromMp(4)).toBeLessThan(2675)
  })

  it('pxPerMeterAt: dome 4 Mpx/110° na 3 m ≈ 311 px/m', () => {
    const pxm = pxPerMeterAt(3, hPixelsFromMp(4), 110)
    expect(pxm).toBeGreaterThan(305)
    expect(pxm).toBeLessThan(318)
  })

  it('distanceForPxM: recognition 125 px/m przy 4 Mpx/110° ≈ 7,47 m (round-trip z pxPerMeterAt)', () => {
    const hPx = hPixelsFromMp(4)
    const d = distanceForPxM(125, hPx, 110)
    expect(d).toBeGreaterThan(7.2)
    expect(d).toBeLessThan(7.7)
    expect(pxPerMeterAt(d, hPx, 110)).toBeCloseTo(125, 5)
  })

  it('doriRadiiM: identification < recognition < observation < detection', () => {
    const r = doriRadiiM(hPixelsFromMp(4), 110)
    expect(r.identification).toBeLessThan(r.recognition)
    expect(r.recognition).toBeLessThan(r.observation)
    expect(r.observation).toBeLessThan(r.detection)
  })
})

describe('worstCasePxm — najdalszy wierzchołek pomieszczenia', () => {
  // Pokój 5×4 m (mm), kamera w rogu (0,0) → najdalszy narożnik = przekątna 6,40 m.
  const room = [
    { x: 0, y: 0 },
    { x: 5000, y: 0 },
    { x: 5000, y: 4000 },
    { x: 0, y: 4000 }
  ]
  const cam = { position: { x: 0, y: 0 }, mp: 4, fovDeg: 110 }

  it('kamera w rogu 5×4 m: dist ≈ 6,40 m, pxm ≈ 146 (≥ observation 62,5, ≥ recognition 125)', () => {
    const wc = worstCasePxm(cam, room, 1)!
    expect(wc.distM).toBeCloseTo(6.4, 1)
    expect(wc.pxm).toBeGreaterThan(140)
    expect(wc.pxm).toBeLessThan(152)
  })

  it('skala unitMm=25 (rzut 1 jedn. = 25 mm): ten sam pokój w jednostkach → ten sam wynik w metrach', () => {
    const room25 = room.map((p) => ({ x: p.x / 25, y: p.y / 25 }))
    const wc = worstCasePxm({ ...cam, position: { x: 0, y: 0 } }, room25, 25)!
    expect(wc.distM).toBeCloseTo(6.4, 1)
  })

  it('null bez pomieszczenia / złe unitMm', () => {
    expect(worstCasePxm(cam, null, 1)).toBeNull()
    expect(worstCasePxm(cam, room, 0)).toBeNull()
  })

  it('dirDeg wskazuje na centroid pokoju', () => {
    const wc = worstCasePxm(cam, room, 1)!
    // centroid (2500,2000) z (0,0) → atan2(2000,2500) ≈ 38,7°
    expect(wc.dirDeg).toBeGreaterThan(30)
    expect(wc.dirDeg).toBeLessThan(45)
  })
})

describe('applyDoriProps — wzbogacenie kamer przed audytem', () => {
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
  const cam = {
    system: 'cctv',
    typeKey: 'cctv.dome.4mp',
    position: { x: 100, y: 100 },
    spaceId: 'sp1',
    props: { auto: true } as Record<string, unknown>
  }

  it('uzupełnia mp/fov/doriTarget z defaults typu i liczy doriResolutionPxM > 0', () => {
    const [d] = applyDoriProps([cam], spaces, 1)
    expect(d.props.mp).toBe(4)
    expect(d.props.fov).toBe(110)
    expect(d.props.doriTarget).toBe(62.5)
    expect(d.props.doriResolutionPxM as number).toBeGreaterThan(62.5) // dome przechodzi observation
  })

  it('NIE nadpisuje override z atrybutów DXF', () => {
    const [d] = applyDoriProps([{ ...cam, props: { doriTarget: 250, fov: 60 } }], spaces, 1)
    expect(d.props.doriTarget).toBe(250)
    expect(d.props.fov).toBe(60)
  })

  it('fallback point-in-polygon gdy brak spaceId', () => {
    const [d] = applyDoriProps([{ ...cam, spaceId: undefined }], spaces, 1)
    expect(d.props.doriResolutionPxM as number).toBeGreaterThan(0)
  })

  it('kamera bez pomieszczenia → doriResolutionPxM = 0 (exempt)', () => {
    const [d] = applyDoriProps([{ ...cam, spaceId: undefined, position: { x: 99000, y: 99000 } }], spaces, 1)
    expect(d.props.doriResolutionPxM).toBe(0)
  })

  it('nie dotyka urządzeń nie-CCTV i nie mutuje wejścia', () => {
    const lan = { system: 'lan', typeKey: 'lan.ap', position: { x: 0, y: 0 }, props: {} }
    const out = applyDoriProps([lan, cam], spaces, 1)
    expect(out[0]).toBe(lan)
    expect(cam.props.doriResolutionPxM).toBeUndefined() // oryginał nietknięty
  })
})

describe('cameraCoverageBands — strefy do renderu', () => {
  it('4 strefy, przycięte do pokoju, w kolejności detection→identification', () => {
    const room = [
      { x: 0, y: 0 },
      { x: 5000, y: 0 },
      { x: 5000, y: 4000 },
      { x: 0, y: 4000 }
    ]
    const bands = cameraCoverageBands(
      { position: { x: 100, y: 100 }, dirDeg: 40, mp: 4, fovDeg: 110 },
      1,
      room
    )
    expect(bands.map((b) => b.level)).toEqual(['detection', 'observation', 'recognition', 'identification'])
    for (const b of bands) {
      expect(b.polygon.length).toBeGreaterThanOrEqual(3)
      for (const p of b.polygon) {
        expect(p.x).toBeGreaterThanOrEqual(-1)
        expect(p.x).toBeLessThanOrEqual(5001)
        expect(p.y).toBeGreaterThanOrEqual(-1)
        expect(p.y).toBeLessThanOrEqual(4001)
      }
    }
  })
})
