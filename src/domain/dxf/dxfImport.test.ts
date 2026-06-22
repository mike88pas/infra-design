import { describe, it, expect } from 'vitest'
import type { DxfInsert, DxfLayer } from '@domain/model/schema'
import { classifyLayer, guessSystemMapping } from './systemMapping'
import { buildDefaultProfile, guessLevel } from './importProfile'
import { devicesFromInserts, countByTypeKey } from '@domain/installations/fromDxf'

// Warstwy jak w realnym pliku klienta (Teatr Rzeszów, konwencja PST_*).
const CLIENT_LAYERS: DxfLayer[] = [
  'PST_gniazda_RJ-45',
  'PST_gniazda AP',
  'PST_gniazda CCTV',
  'PST_zasięgi kamer',
  'PST_kontrola dostępu',
  'PST_intercomy',
  'PST_punkty elektryczno logiczne',
  'PST_AP_opis wysokości',
  'PST_Legenda',
  'PST_podkład',
  'PST_Strefy',
  'A-WALL',
  'PST_gniazda'
].map((name) => ({ name, color: '#ffffff', visible: true }))

describe('classifyLayer — warstwa → system/typ', () => {
  it('mapuje warstwy urządzeń na właściwy system i typ', () => {
    expect(classifyLayer('PST_gniazda_RJ-45')).toEqual({ system: 'lan', typeKey: 'lan.outlet.2x' })
    expect(classifyLayer('PST_gniazda AP')).toEqual({ system: 'lan', typeKey: 'lan.ap' })
    expect(classifyLayer('PST_gniazda CCTV')).toEqual({ system: 'cctv', typeKey: 'cctv.dome.4mp' })
    expect(classifyLayer('PST_kontrola dostępu')).toEqual({ system: 'kd', typeKey: 'kd.reader' })
    expect(classifyLayer('PST_intercomy')).toEqual({ system: 'kd', typeKey: 'kd.intercom' })
    expect(classifyLayer('PST_punkty elektryczno logiczne')).toEqual({ system: 'lan', typeKey: 'lan.outlet.2x' })
  })

  it('pomija (null) warstwy nie-urządzeniowe: zasięgi, legenda, podkład, opisy', () => {
    expect(classifyLayer('PST_zasięgi kamer')).toBeNull()
    expect(classifyLayer('PST_Legenda')).toBeNull()
    expect(classifyLayer('PST_podkład')).toBeNull()
    expect(classifyLayer('PST_Strefy')).toBeNull()
    expect(classifyLayer('PST_AP_opis wysokości')).toBeNull() // opis, nie punkt AP
  })

  it('zwraca undefined dla niejednoznacznych (użytkownik decyduje)', () => {
    expect(classifyLayer('PST_gniazda')).toBeUndefined()
    expect(classifyLayer('PST_RURA')).toBeUndefined()
  })
})

describe('guessSystemMapping — mapa dla kreatora', () => {
  const map = guessSystemMapping(CLIENT_LAYERS)

  it('zawiera rozpoznane i świadomie pominięte, bez niejednoznacznych', () => {
    expect(map['PST_gniazda_RJ-45']).toEqual({ system: 'lan', typeKey: 'lan.outlet.2x' })
    expect(map['PST_zasięgi kamer']).toBeNull()
    expect('PST_gniazda' in map).toBe(false) // niejednoznaczna — pominięta
  })
})

describe('guessLevel — numer kondygnacji z nazwy pliku', () => {
  it('czyta K+N / K-N / U / DACH', () => {
    expect(guessLevel('PW-IT-02-012_K+1_LAN.dxf')).toBe(1)
    expect(guessLevel('PW-IT-02-042_K+4_LAN.dxf')).toBe(4)
    expect(guessLevel('PW-IT-02-U12_K-1_LAN.dxf')).toBe(-1)
    expect(guessLevel('PW-IT-02-R02_DACH_LAN.dxf')).toBe(100)
  })
})

describe('buildDefaultProfile — wartości początkowe', () => {
  const profile = buildDefaultProfile({
    layers: CLIENT_LAYERS,
    units: 'mm',
    fileName: 'PW-IT-02-012_K+1_LAN.dxf',
    projectName: 'Teatr Rzeszów',
    client: 'Fibrain'
  })

  it('ustawia skalę, poziom, ściany, eksplozję i narzuty', () => {
    expect(profile.unitMm).toBe(1)
    expect(profile.level).toBe(1)
    expect(profile.explodeBlocks).toBe(true)
    expect(profile.wallLayers).toContain('A-WALL')
    expect(profile.vatPct).toBe(23)
    expect(profile.systemMapping['PST_gniazda CCTV']).toEqual({ system: 'cctv', typeKey: 'cctv.dome.4mp' })
  })
})

describe('devicesFromInserts — INSERT-y → Device[]', () => {
  const inserts: DxfInsert[] = [
    { layer: 'PST_gniazda_RJ-45', name: '*U1', at: { x: 1000, y: 2000 }, rotation: 0, sx: 1, sy: 1, attribs: { IDFX: 'PPD1.1/X1/', NR: '12' } },
    { layer: 'PST_gniazda_RJ-45', name: '*U2', at: { x: 1500, y: 2000 }, rotation: 90, sx: 1, sy: 1, attribs: {} },
    { layer: 'PST_gniazda CCTV', name: '*U3', at: { x: 5000, y: 5000 }, rotation: 0, sx: 1, sy: 1, attribs: {} },
    { layer: 'PST_zasięgi kamer', name: '*U4', at: { x: 5000, y: 5000 }, rotation: 0, sx: 1, sy: 1, attribs: {} }, // pomijana
    { layer: 'PST_podkład', name: 'ARCH', at: { x: 0, y: 0 }, rotation: 0, sx: 1, sy: 1, attribs: {} } // pomijana
  ]
  const mapping = guessSystemMapping(CLIENT_LAYERS)
  const devices = devicesFromInserts(inserts, mapping, { drawingId: 'd1', idPrefix: 'k1' })

  it('tworzy urządzenia tylko z warstw zmapowanych (pomija zasięgi/podkład)', () => {
    expect(devices.length).toBe(3)
    expect(devices.map((d) => d.system).sort()).toEqual(['cctv', 'lan', 'lan'])
  })

  it('przenosi atrybuty bloku do props (IDFX/NR → krosowanie)', () => {
    const rj = devices.find((d) => d.props.IDFX)
    expect(rj?.props).toEqual({ IDFX: 'PPD1.1/X1/', NR: '12' })
    expect(rj?.drawingId).toBe('d1')
    expect(rj?.id).toBe('k1-1')
  })

  it('zlicza per typeKey', () => {
    expect(countByTypeKey(devices)).toEqual({ 'lan.outlet.2x': 2, 'cctv.dome.4mp': 1 })
  })
})
