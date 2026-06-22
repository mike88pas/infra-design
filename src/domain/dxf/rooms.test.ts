import { describe, it, expect } from 'vitest'
import type { DxfRoom } from '@domain/model/schema'
import { roomsToSpaces } from './rooms'

const rooms: DxfRoom[] = [
  { number: '1.11', name: 'Scena Nowa', areaM2: 224.64, at: { x: 0, y: 0 }, tag: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }] },
  { number: '1.01', name: 'Foyer', areaM2: 218.57, at: { x: 1000, y: 0 }, tag: [{ x: 999, y: -1 }, { x: 1001, y: -1 }, { x: 1001, y: 1 }] },
  { number: '0.9', name: 'Schowek', areaM2: null, at: { x: 0, y: 1000 }, tag: [{ x: 0, y: 999 }, { x: 1, y: 999 }, { x: 1, y: 1001 }] }
]

describe('roomsToSpaces — wykaz pomieszczeń → Space[]', () => {
  const { spaces, assign } = roomsToSpaces(rooms, 'drw-1')

  it('nadaje nazwę "numer nazwa" i metraż w mm² (m²×1e6)', () => {
    expect(spaces[0].name).toBe('1.11 Scena Nowa')
    expect(spaces[0].area).toBeCloseTo(224.64 * 1_000_000, 0)
    expect(spaces[0].drawingId).toBe('drw-1')
  })

  it('pole nieznane (null) → area 0', () => {
    const schowek = spaces.find((s) => s.name.includes('Schowek'))
    expect(schowek?.area).toBe(0)
  })

  it('id pochodzi od numeru pomieszczenia', () => {
    expect(spaces[0].id).toBe('drw-1::room::1.11')
  })

  it('assign przypisuje punkt do najbliższego środka etykiety', () => {
    expect(assign({ x: 980, y: 5 })).toBe(spaces[1].id) // blisko Foyer (1000,0)
    expect(assign({ x: 10, y: 5 })).toBe(spaces[0].id) // blisko Sceny (0,0)
  })
})
