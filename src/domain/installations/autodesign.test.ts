/**
 * Auto-projektowanie: z wykazu pomieszczeń → wstępny layout urządzeń → BOM/kosztorys.
 * Tryb „od zera" (klient przysyła sam podkład + wytyczne).
 */

import { describe, it, expect } from 'vitest'
import type { DxfRoom } from '@domain/model/schema'
import { autoDesign, DEFAULT_AUTODESIGN_RULES } from './autodesign'
import { buildBom } from './bom'
import { buildCost } from './cost'
import { countByTypeKey } from './fromDxf'

const rooms: DxfRoom[] = [
  { number: '0.1', name: 'Sala A', areaM2: 48, at: { x: 3000, y: 4000 }, tag: [{ x: 0, y: 0 }] },
  { number: '0.2', name: 'Sala B', areaM2: 64, at: { x: 10000, y: 4000 }, tag: [{ x: 0, y: 0 }] },
  { number: '0.3', name: 'Korytarz', areaM2: 12, at: { x: 6000, y: 8000 }, tag: [{ x: 0, y: 0 }] }
]

describe('autoDesign — layout z reguł', () => {
  const res = autoDesign(rooms, { drawingId: 'd1', idPrefix: 'AD' })

  it('LAN: gniazda wg metrażu (1 / 10 m², min 1)', () => {
    // 48→5, 64→7, 12→2
    const byRoom = Object.fromEntries(res.perRoom.map((r) => [r.name, r.outlets]))
    expect(byRoom['Sala A']).toBe(5)
    expect(byRoom['Sala B']).toBe(7)
    expect(byRoom['Korytarz']).toBe(2)
  })

  it('CCTV: kamera w dużych pomieszczeniach lub po słowie kluczowym (korytarz)', () => {
    const byRoom = Object.fromEntries(res.perRoom.map((r) => [r.name, r.cameras]))
    expect(byRoom['Sala A']).toBe(1) // ≥40 m²
    expect(byRoom['Sala B']).toBe(1)
    expect(byRoom['Korytarz']).toBe(1) // 12 m² ale słowo kluczowe „korytarz”
  })

  it('AP: tylko pomieszczenia ≥ 30 m²', () => {
    const byRoom = Object.fromEntries(res.perRoom.map((r) => [r.name, r.aps]))
    expect(byRoom['Sala A']).toBe(1)
    expect(byRoom['Sala B']).toBe(1)
    expect(byRoom['Korytarz']).toBe(0)
  })

  it('przypisuje urządzenia do pomieszczeń (spaceId) i znakuje auto', () => {
    expect(res.devices.every((d) => d.spaceId)).toBe(true)
    expect(res.devices.every((d) => d.props.auto === true)).toBe(true)
  })

  it('łączy się z BOM/kosztorysem (pełny tor od zera)', () => {
    const counts = countByTypeKey(res.devices)
    expect(counts['lan.outlet.2x']).toBe(14) // 5+7+2
    expect(counts['lan.ap']).toBe(2)
    expect(counts['cctv.dome.4mp']).toBe(3)
    const bom = buildBom({ devices: res.devices, routes: [], trays: [] })
    const cost = buildCost(bom)
    expect(cost.gross).toBeGreaterThan(0)
  })

  it('wytyczne nadpisują reguły (np. gęściej: 1 gniazdo / 5 m²)', () => {
    const dense = autoDesign(rooms, { drawingId: 'd1', rules: { lan: { m2PerOutlet: 5, minPerRoom: 1 } } })
    const sala = dense.perRoom.find((r) => r.name === 'Sala A')
    expect(sala?.outlets).toBe(10) // 48/5 = 9.6 → 10
  })
})

describe('DEFAULT_AUTODESIGN_RULES', () => {
  it('ma reguły LAN/AP/CCTV', () => {
    expect(DEFAULT_AUTODESIGN_RULES.lan.m2PerOutlet).toBeGreaterThan(0)
    expect(DEFAULT_AUTODESIGN_RULES.cctv.nameKeywords.length).toBeGreaterThan(0)
  })
})
