/**
 * Test end-to-end ścieżki F1→F2 (bez Electrona/sidecara): symbole DXF (INSERT)
 * → Device[] → BOM → kosztorys. Domyka pętlę, którą w aplikacji uruchamia kreator importu.
 */

import { describe, it, expect } from 'vitest'
import type { DxfInsert } from '@domain/model/schema'
import { guessSystemMapping } from '@domain/dxf/systemMapping'
import { devicesFromInserts } from './fromDxf'
import { buildBom } from './bom'
import { buildCost } from './cost'

const LAYERS = [
  'PST_gniazda_RJ-45',
  'PST_gniazda AP',
  'PST_gniazda CCTV',
  'PST_zasięgi kamer',
  'PST_podkład'
].map((name) => ({ name }))

// Symbole jak z realnego rzutu: 3× RJ-45, 2× AP, 2× CCTV + szum (zasięgi/podkład).
const inserts: DxfInsert[] = [
  ...Array.from({ length: 3 }, (_, i) => mk('PST_gniazda_RJ-45', 1000 + i * 500, 0, { NR: String(i) })),
  ...Array.from({ length: 2 }, (_, i) => mk('PST_gniazda AP', 3000 + i * 500, 1000)),
  ...Array.from({ length: 2 }, (_, i) => mk('PST_gniazda CCTV', 5000 + i * 500, 2000)),
  mk('PST_zasięgi kamer', 5200, 2000), // strefa widzenia — nie urządzenie
  mk('PST_podkład', 0, 0) // podkład — nie urządzenie
]

function mk(layer: string, x: number, y: number, attribs: Record<string, string> = {}): DxfInsert {
  return { layer, name: '*U', at: { x, y }, rotation: 0, sx: 1, sy: 1, attribs }
}

describe('F1→F2 end-to-end: INSERT → Device → BOM → kosztorys', () => {
  const mapping = guessSystemMapping(LAYERS)
  const devices = devicesFromInserts(inserts, mapping, { drawingId: 'd1', idPrefix: 'k1' })
  const bom = buildBom({ devices, routes: [], trays: [] })
  const cost = buildCost(bom)

  it('mapuje tylko realne urządzenia (pomija strefy i podkład)', () => {
    expect(devices.length).toBe(7) // 3 + 2 + 2
  })

  it('BOM agreguje per typ z katalogu', () => {
    const get = (key: string) => bom.find((b) => b.catalogRef === key)
    expect(get('lan.outlet.2x')?.qty).toBe(3)
    expect(get('lan.ap')?.qty).toBe(2)
    expect(get('cctv.dome.4mp')?.qty).toBe(2)
  })

  it('kosztorys liczy się i jest dodatni (brutto > netto > 0)', () => {
    expect(cost.net).toBeGreaterThan(0)
    expect(cost.gross).toBeGreaterThan(cost.net)
    // 3·(42+38) + 2·(410+65) + 2·(520+85) = 240 + 950 + 1210 = 2400 netto
    expect(cost.net).toBeCloseTo(2400, 2)
  })

  it('zachowuje audytowalność (sourceRefs po Id urządzeń)', () => {
    const rj = bom.find((b) => b.catalogRef === 'lan.outlet.2x')
    expect(rj?.sourceRefs).toEqual(['k1-1', 'k1-2', 'k1-3'])
  })
})
