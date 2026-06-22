/**
 * Katalog produktów instalacji (F2) — realni producenci, ceny rynkowe PL (netto).
 *
 * LAN oparte o FibrainDATA (polski producent okablowania strukturalnego — klient),
 * CCTV: Hikvision, AP: Ubiquiti UniFi, szafy: ZPAS. Ceny orientacyjne (rynek PL,
 * połowa 2026) do potwierdzenia ofertą/cennikiem dystrybutora przed wyceną wiążącą.
 * Robocizna to przybliżony nakład montażu (do kalibracji KNR + stawka rbg u klienta).
 *
 * Źródła cen: hurtownie teleinformatyczne PL (Fibrain XQ100.x), Ceneo/EC System
 * (Hikvision DS-2CD2143G2-I, DS-7616NI-K2/16P), sklep.ui.pl (Ubiquiti U6-Lite),
 * Allegro/dystrybutorzy (ZPAS 42U).
 */

import type { SystemKey } from '@domain/model/schema'

export interface CatalogEntry {
  key: string
  system: SystemKey
  description: string
  /** Producent (np. 'FibrainDATA', 'Hikvision', 'Ubiquiti', 'ZPAS'). */
  manufacturer?: string
  /** Symbol/model produktu (np. 'XQ100.400', 'DS-2CD2143G2-I', 'U6-Lite'). */
  model?: string
  unit: string
  /** Kod nakładu KNR (placeholder do potwierdzenia z klientem). */
  knr: string
  /** Cena materiału [PLN/jedn.] netto. */
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
  // ── LAN — FibrainDATA (okablowanie strukturalne) ──
  'lan.outlet.2x': {
    key: 'lan.outlet.2x', system: 'lan',
    description: 'Gniazdo logiczne 2×RJ45 kat.6 (2× keystone Quick + osprzęt natynk./podtynk.)',
    manufacturer: 'FibrainDATA', model: 'XQ100.400 (×2) + ramka',
    unit: 'kpl', knr: 'KNR EM-01 0201', matPrice: 85, laborPrice: 45
  },
  'lan.outlet.1x': {
    key: 'lan.outlet.1x', system: 'lan',
    description: 'Gniazdo logiczne 1×RJ45 kat.6 (keystone Quick + osprzęt)',
    manufacturer: 'FibrainDATA', model: 'XQ100.400 + ramka',
    unit: 'kpl', knr: 'KNR EM-01 0201', matPrice: 50, laborPrice: 38
  },
  'lan.ap': {
    key: 'lan.ap', system: 'lan',
    description: 'Punkt dostępowy Wi-Fi 6 (PoE), montaż sufitowy/ścienny',
    manufacturer: 'Ubiquiti', model: 'UniFi U6-Lite',
    unit: 'szt', knr: 'KNR EM-01 0410', matPrice: 470, laborPrice: 70
  },
  'cable.utp.cat6': {
    key: 'cable.utp.cat6', system: 'lan',
    description: 'Kabel U/UTP kat.6 LSOH 500 MHz, drut',
    manufacturer: 'FibrainDATA', model: 'XQ100.101',
    unit: 'm', knr: 'KNR EM-01 0105', matPrice: 2.6, laborPrice: 1.9
  },
  'lan.patchpanel.24': {
    key: 'lan.patchpanel.24', system: 'lan',
    description: 'Panel krosowy 19" 1U 24×RJ45 keystone (wyposażony)',
    manufacturer: 'FibrainDATA', model: 'SD 6×4 RJ45 1U + 24× keystone',
    unit: 'szt', knr: 'KNR EM-01 0210', matPrice: 320, laborPrice: 120
  },
  'lan.rack.42u': {
    key: 'lan.rack.42u', system: 'lan',
    description: 'Szafa stojąca 19" 42U 600×600, drzwi perforowane + akcesoria',
    manufacturer: 'ZPAS', model: 'WZ-IT-426060 42U',
    unit: 'szt', knr: 'KNR EM-01 0501', matPrice: 2640, laborPrice: 350
  },

  // ── CCTV — Hikvision ──
  'cctv.dome.4mp': {
    key: 'cctv.dome.4mp', system: 'cctv',
    description: 'Kamera kopułkowa IP 4 Mpx, AcuSense, IR30, IK10, PoE',
    manufacturer: 'Hikvision', model: 'DS-2CD2143G2-I',
    unit: 'szt', knr: 'KNR 5-08 0301', matPrice: 560, laborPrice: 90
  },
  'cctv.bullet.4mp': {
    key: 'cctv.bullet.4mp', system: 'cctv',
    description: 'Kamera tubowa IP 4 Mpx, AcuSense, IR, PoE',
    manufacturer: 'Hikvision', model: 'DS-2CD2043G2-I',
    unit: 'szt', knr: 'KNR 5-08 0301', matPrice: 540, laborPrice: 90
  },
  'cctv.nvr.16': {
    key: 'cctv.nvr.16', system: 'cctv',
    description: 'Rejestrator NVR 16-kanałów 4K z 16-portowym switchem PoE',
    manufacturer: 'Hikvision', model: 'DS-7616NI-K2/16P',
    unit: 'szt', knr: 'KNR 5-08 0320', matPrice: 1450, laborPrice: 180
  },

  // ── Trasy ──
  'tray.perforated.100': {
    key: 'tray.perforated.100', system: 'tray',
    description: 'Korytko kablowe perforowane 100 mm + podpory',
    manufacturer: 'Baks', model: 'KCJ100',
    unit: 'm', knr: 'KNR 5-08 0112', matPrice: 24, laborPrice: 16
  },
  'tray.perforated.200': {
    key: 'tray.perforated.200', system: 'tray',
    description: 'Korytko kablowe perforowane 200 mm + podpory',
    manufacturer: 'Baks', model: 'KCJ200',
    unit: 'm', knr: 'KNR 5-08 0114', matPrice: 38, laborPrice: 20
  }
}

export function catalogEntry(key: string): CatalogEntry | undefined {
  return CATALOG[key]
}
