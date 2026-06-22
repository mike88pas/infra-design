/**
 * Wertykała INSTALACJE (F2) — rejestruje typy urządzeń LAN i CCTV w rdzeniu CAD
 * przez `PluginRegistry`. To pierwsza wertykała; kolejne (wnętrza/architektura)
 * dochodzą tym samym mechanizmem bez zmian w rdzeniu.
 *
 * Reguły norm NIE są tu zaszyte — silnik norm ładuje je z `rules/*.yaml` (dane).
 */

import type { DeviceTypeDef, PluginRegistry, VerticalDef } from '@core/plugins/registry'

/** Typy urządzeń LAN (pilot F2). */
export const LAN_DEVICE_TYPES: DeviceTypeDef[] = [
  { typeKey: 'lan.outlet.2x', system: 'lan', label: 'Gniazdo 2×RJ45', symbol: 'lan-outlet', defaultProps: { ports: 2, cat: 6 } },
  { typeKey: 'lan.outlet.1x', system: 'lan', label: 'Gniazdo 1×RJ45', symbol: 'lan-outlet', defaultProps: { ports: 1, cat: 6 } },
  { typeKey: 'lan.ap', system: 'lan', label: 'Access Point (PoE)', symbol: 'lan-ap', defaultProps: { poe: true } }
]

/** Typy urządzeń CCTV (gotowe pod F4; props pod regułę DORI). */
export const CCTV_DEVICE_TYPES: DeviceTypeDef[] = [
  { typeKey: 'cctv.dome.4mp', system: 'cctv', label: 'Kamera kopułkowa 4 Mpx', symbol: 'cctv-dome', defaultProps: { mp: 4, fov: 110, doriTarget: 125, doriResolutionPxM: 0 } },
  { typeKey: 'cctv.bullet.4mp', system: 'cctv', label: 'Kamera tubowa 4 Mpx', symbol: 'cctv-bullet', defaultProps: { mp: 4, fov: 90, doriTarget: 250, doriResolutionPxM: 0 } }
]

/** Definicja wertykały instalacji do rejestracji w core. */
export function installationsVertical(): VerticalDef {
  return {
    key: 'installations',
    label: 'Instalacje',
    systems: ['lan', 'cctv', 'tray'],
    deviceTypes: [...LAN_DEVICE_TYPES, ...CCTV_DEVICE_TYPES],
    // Reguły norm ładuje silnik z rules/*.yaml (dane, nie kod).
    rules: []
  }
}

/** Rejestruje wertykałę instalacji w podanym rejestrze (idempotentnie bezpieczne na świeżym rejestrze). */
export function registerInstallations(registry: PluginRegistry): void {
  registry.register(installationsVertical())
}

export { buildBom } from './bom'
export { buildCost, PLN } from './cost'
export { CATALOG, catalogEntry } from './catalog'
