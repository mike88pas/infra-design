/**
 * Katalog produktów instalacji (F2) — placeholder.
 *
 * W produkcie docelowym pozycje pochodzą z bazy `CatalogItem` (producenci, dopuszczenia
 * CNBOP) + cenniki importowane z DBF (Sekocenbud). Tu trzymamy lekki rejestr mapujący
 * `typeKey` urządzenia / typ kabla / typ korytka → opis, jednostkę, kod KNR i ceny.
 *
 * Mapowanie KNR/ceny jest świadomym placeholderem do walidacji u klienta (sekcja F ankiety).
 */

import type { SystemKey } from '@domain/model/schema'

export interface CatalogEntry {
  key: string
  system: SystemKey
  description: string
  unit: string
  /** Kod nakładu KNR (placeholder do potwierdzenia z klientem). */
  knr: string
  /** Cena materiału [PLN/jedn.]. */
  matPrice: number
  /** Robocizna [PLN/jedn.]. */
  laborPrice: number
}

/** Klucz kabla używany w `CableRoute.cableType` → pozycja katalogu. */
export const CABLE_KEYS: Record<string, string> = {
  'U/UTP kat.6 LSOH': 'cable.utp.cat6',
  'U/UTP kat.6 LSOH (IP)': 'cable.utp.cat6'
}

/** Klucz korytka → pozycja katalogu (po szerokości w mm). */
export function trayKey(widthMm: number): string {
  return `tray.perforated.${widthMm}`
}

export const CATALOG: Record<string, CatalogEntry> = {
  // ── LAN ──
  'lan.outlet.2x': { key: 'lan.outlet.2x', system: 'lan', description: 'Gniazdo logiczne 2×RJ45 kat.6 + osprzęt', unit: 'kpl', knr: 'KNR EM-01 0201', matPrice: 42, laborPrice: 38 },
  'lan.outlet.1x': { key: 'lan.outlet.1x', system: 'lan', description: 'Gniazdo logiczne 1×RJ45 kat.6 + osprzęt', unit: 'kpl', knr: 'KNR EM-01 0201', matPrice: 32, laborPrice: 34 },
  'lan.ap': { key: 'lan.ap', system: 'lan', description: 'Punkt dostępowy Wi-Fi (AP) PoE', unit: 'szt', knr: 'KNR EM-01 0410', matPrice: 410, laborPrice: 65 },
  'cable.utp.cat6': { key: 'cable.utp.cat6', system: 'lan', description: 'Kabel U/UTP kat.6 LSOH', unit: 'm', knr: 'KNR EM-01 0105', matPrice: 2.4, laborPrice: 1.9 },

  // ── CCTV (gotowe pod F4) ──
  'cctv.dome.4mp': { key: 'cctv.dome.4mp', system: 'cctv', description: 'Kamera kopułkowa IP 4 Mpx, IR, PoE', unit: 'szt', knr: 'KNR 5-08 0301', matPrice: 520, laborPrice: 85 },
  'cctv.bullet.4mp': { key: 'cctv.bullet.4mp', system: 'cctv', description: 'Kamera tubowa IP 4 Mpx, IR, PoE', unit: 'szt', knr: 'KNR 5-08 0301', matPrice: 560, laborPrice: 85 },
  'cctv.nvr.16': { key: 'cctv.nvr.16', system: 'cctv', description: 'Rejestrator NVR 16-kanałów', unit: 'szt', knr: 'KNR 5-08 0320', matPrice: 1850, laborPrice: 180 },

  // ── Trasy ──
  'tray.perforated.100': { key: 'tray.perforated.100', system: 'tray', description: 'Korytko kablowe perforowane 100 mm + podpory', unit: 'm', knr: 'KNR 5-08 0112', matPrice: 24, laborPrice: 16 },
  'tray.perforated.200': { key: 'tray.perforated.200', system: 'tray', description: 'Korytko kablowe perforowane 200 mm + podpory', unit: 'm', knr: 'KNR 5-08 0114', matPrice: 38, laborPrice: 20 }
}

export function catalogEntry(key: string): CatalogEntry | undefined {
  return CATALOG[key]
}
