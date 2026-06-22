import { describe, it, expect } from 'vitest'
import type { CableRoute, Device, Tray } from '@domain/model/schema'
import { buildBom } from './bom'
import { buildCost } from './cost'
import { PluginRegistry } from '@core/plugins/registry'
import { registerInstallations } from './index'

const dev = (id: string, typeKey: string, system: 'lan' | 'cctv'): Device => ({
  id,
  drawingId: 'd1',
  system,
  typeKey,
  position: { x: 0, y: 0 },
  rotation: 0,
  props: {},
  connections: []
})

const route = (id: string, length: number): CableRoute => ({
  id,
  system: 'lan',
  path: [],
  cableType: 'U/UTP kat.6 LSOH',
  length,
  from: { deviceId: id, port: 'a' },
  to: { deviceId: 'RK1', port: 'b' }
})

const tray = (id: string, lenMm: number): Tray => ({
  id,
  drawingId: 'd1',
  path: [
    { x: 0, y: 0 },
    { x: 0, y: lenMm }
  ],
  type: 'perforated',
  widthMm: 100,
  level: 0
})

const devices = [
  dev('L1', 'lan.outlet.2x', 'lan'),
  dev('L2', 'lan.outlet.2x', 'lan'),
  dev('L3', 'lan.outlet.2x', 'lan'),
  dev('AP1', 'lan.ap', 'lan'),
  dev('C1', 'cctv.dome.4mp', 'cctv'),
  dev('C2', 'cctv.dome.4mp', 'cctv')
]
const routes = [route('R1', 40), route('R2', 60)] // 100 m + 5% = 105
const trays = [tray('T1', 10000)] // 10 m

describe('buildBom — agregacja zestawienia', () => {
  const bom = buildBom({ devices, routes, trays })
  const get = (key: string) => bom.find((b) => b.catalogRef === key)

  it('grupuje urządzenia po typeKey', () => {
    expect(get('lan.outlet.2x')?.qty).toBe(3)
    expect(get('lan.ap')?.qty).toBe(1)
    expect(get('cctv.dome.4mp')?.qty).toBe(2)
  })

  it('sumuje kabel z tras + 5% zapasu (zaokrąglone w górę)', () => {
    expect(get('cable.utp.cat6')?.qty).toBe(105)
    expect(get('cable.utp.cat6')?.unit).toBe('m')
  })

  it('liczy korytka z długości path (mm → m)', () => {
    expect(get('tray.perforated.100')?.qty).toBe(10)
  })

  it('zapisuje sourceRefs (audytowalność)', () => {
    expect(get('lan.outlet.2x')?.sourceRefs).toEqual(['L1', 'L2', 'L3'])
  })
})

describe('buildCost — kosztorys z BOM', () => {
  const bom = buildBom({ devices, routes, trays })
  const cost = buildCost(bom)

  it('tworzy pozycję na każdą pozycję BOM z kodem KNR', () => {
    expect(cost.items.length).toBe(bom.length)
    expect(cost.items.every((i) => !!i.knrCode)).toBe(true)
  })

  it('net = materiał + robocizna, brutto = (net+narzut)·VAT', () => {
    expect(cost.net).toBeCloseTo(cost.material + cost.labor, 2)
    expect(cost.gross).toBeCloseTo(cost.subtotal * (1 + cost.vatPct / 100), 2)
    expect(cost.gross).toBeGreaterThan(cost.net)
  })

  it('konkretna pozycja: 3× gniazdo 2×RJ45 = 3·(42+38) = 240 zł', () => {
    const outlet = cost.items.find((i) => i.bomItemId === 'bom.lan.outlet.2x')
    expect(outlet?.total).toBe(240)
  })
})

describe('rejestr wertykały instalacji', () => {
  it('rejestruje LAN + CCTV i wystawia typy urządzeń', () => {
    const reg = new PluginRegistry()
    registerInstallations(reg)
    expect(reg.get('installations')?.label).toBe('Instalacje')
    expect(reg.findDeviceType('lan.outlet.2x')?.system).toBe('lan')
    expect(reg.findDeviceType('cctv.dome.4mp')?.system).toBe('cctv')
    expect(reg.deviceTypes().length).toBeGreaterThanOrEqual(5)
  })
})
