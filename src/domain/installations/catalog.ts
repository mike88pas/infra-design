/**
 * Katalog produktów instalacji (F2) — realni producenci, ceny rynkowe PL (netto).
 *
 * LAN bierne oparte o FibrainDATA (polski producent okablowania strukturalnego — klient):
 * keystone XR200 (moduł kat.6A), przełącznica XPS00, system puszek GIP/SUP/RAM, adaptery
 * XB-45KA45D, szafy SRS/SSRS + akcesoria. LAN czynne: Alcatel-Lucent OmniSwitch / OmniAccess
 * Stellar (z realnych kosztorysów inwestorskich klienta). CCTV: Hikvision. Korytka: Baks.
 *
 * Ceny i symbole pochodzą z realnych kosztorysów inwestorskich (Fibrain/Alcatel, PL netto,
 * poł. 2026). Do potwierdzenia ofertą dystrybutora przed wyceną wiążącą. Robocizna to
 * przybliżony nakład montażu (kalibracja KNR + stawka rbg u klienta).
 *
 * `category` odpowiada podziałowi kosztorysu inwestorskiego klienta: Pasywne / Aktywne /
 * Telefony. `components` rozkłada jedną „logiczną" pozycję (np. gniazdo) na realne SKU —
 * to ten rozkład trafia do zestawienia materiałowego (XLSX) jak u klienta.
 */

import type { SystemKey } from '@domain/model/schema'

/** Kategoria kosztorysu inwestorskiego (podział arkuszy u klienta). */
export type KosztorysCategory = 'pasywne' | 'aktywne' | 'telefony'

/** Pojedyncza realna pozycja SKU (składnik dekompozycji lub pozycja infrastruktury). */
export interface SkuLine {
  /** Symbol producenta (Towar w kosztorysie). */
  sku: string
  /** Nazwa handlowa (Nazwa w kosztorysie). */
  name: string
  unit: string
  /** Cena netto [PLN/jedn.]. */
  priceNet: number
  /** Krotność na 1 jednostkę pozycji logicznej. */
  qtyPer: number
  category: KosztorysCategory
}

export interface CatalogEntry {
  key: string
  system: SystemKey
  description: string
  /** Producent (np. 'FibrainDATA', 'Alcatel-Lucent', 'Hikvision', 'ZPAS'). */
  manufacturer?: string
  /** Symbol/model produktu (np. 'XR200', 'OAW-AP1301H-RW'). */
  model?: string
  unit: string
  /** Kod nakładu KNR (placeholder do potwierdzenia z klientem). */
  knr: string
  /** Cena materiału [PLN/jedn.] netto. */
  matPrice: number
  /** Robocizna [PLN/jedn.]. */
  laborPrice: number
  /** Kategoria kosztorysu (Pasywne/Aktywne/Telefony). */
  category: KosztorysCategory
  /** Wysokość montażowa w szafie 19" [U] — tylko pozycje rackowe (panel/switch/NVR). */
  uSize?: number
  /**
   * Rozkład pozycji na realne SKU. Gdy obecny — do zestawienia/kosztorysu materiałowego
   * trafiają te SKU (×qtyPer×ilość). Gdy brak — pozycja idzie „as is" (model jako SKU).
   */
  components?: SkuLine[]
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
  // ── LAN bierne — FibrainDATA (okablowanie strukturalne) ──
  'lan.outlet.2x': {
    key: 'lan.outlet.2x', system: 'lan', category: 'pasywne',
    description: 'Gniazdo logiczne 2×RJ45 kat.6A ekran. (puszka 45 + suport + ramka + 2× moduł + adapter)',
    manufacturer: 'FibrainDATA', model: 'XR200 (×2) + XB-45KA45D-02',
    unit: 'kpl', knr: 'KNR EM-01 0201', matPrice: 85, laborPrice: 45,
    components: [
      { sku: 'GIP-2', name: 'PUSZKA 45 S/T 2MOD.', unit: 'szt', priceNet: 7.53, qtyPer: 1, category: 'pasywne' },
      { sku: 'SUP-2', name: 'EM SUPORT 2MOD', unit: 'szt', priceNet: 4.05, qtyPer: 1, category: 'pasywne' },
      { sku: 'RAM-2', name: 'EM RAMKA 2MOD', unit: 'szt', priceNet: 3.93, qtyPer: 1, category: 'pasywne' },
      { sku: 'XR200', name: 'FIBRAIN DATA MODUŁ KAT. 6A EKRANOWANY, BEZ ADAPTERA', unit: 'szt', priceNet: 26.99, qtyPer: 2, category: 'pasywne' },
      { sku: 'XB-45KA45D-02', name: 'EBOX ADAPTER 2MOD. 2*RJ45 SKOŚNY Z PLAKIETKĄ OPISOWĄ', unit: 'szt', priceNet: 11.55, qtyPer: 1, category: 'pasywne' }
    ]
  },
  'lan.outlet.1x': {
    key: 'lan.outlet.1x', system: 'lan', category: 'pasywne',
    description: 'Gniazdo logiczne 1×RJ45 kat.6A ekran. (puszka 45 + suport + ramka + moduł + adapter)',
    manufacturer: 'FibrainDATA', model: 'XR200 + XB-45KA45D-01',
    unit: 'kpl', knr: 'KNR EM-01 0201', matPrice: 50, laborPrice: 38,
    components: [
      { sku: 'GIP-2', name: 'PUSZKA 45 S/T 2MOD.', unit: 'szt', priceNet: 7.53, qtyPer: 1, category: 'pasywne' },
      { sku: 'SUP-2', name: 'EM SUPORT 2MOD', unit: 'szt', priceNet: 4.05, qtyPer: 1, category: 'pasywne' },
      { sku: 'RAM-2', name: 'EM RAMKA 2MOD', unit: 'szt', priceNet: 3.93, qtyPer: 1, category: 'pasywne' },
      { sku: 'XR200', name: 'FIBRAIN DATA MODUŁ KAT. 6A EKRANOWANY, BEZ ADAPTERA', unit: 'szt', priceNet: 26.99, qtyPer: 1, category: 'pasywne' },
      { sku: 'XB-45KA45D-01', name: 'EBOX ADAPTER 2MOD. 1*RJ45 SKOŚNY Z PLAKIETKĄ OPISOWĄ', unit: 'szt', priceNet: 9.21, qtyPer: 1, category: 'pasywne' }
    ]
  },
  'cable.utp.cat6': {
    key: 'cable.utp.cat6', system: 'lan', category: 'pasywne',
    description: 'Kabel instalacyjny kat.6A S/FTP 4P LSOH (drut)',
    manufacturer: 'FibrainDATA', model: 'XR1431048130',
    unit: 'm', knr: 'KNR EM-01 0105', matPrice: 4.99, laborPrice: 1.9,
    components: [
      { sku: 'XR1431048130', name: 'FIBRAINDATA KABEL INSTALACYJNY CAT.6A S/FTP 4P LSOH', unit: 'm', priceNet: 4.99, qtyPer: 1, category: 'pasywne' }
    ]
  },

  // ── LAN czynne — Alcatel-Lucent OmniAccess Stellar (AP) ──
  'lan.ap': {
    key: 'lan.ap', system: 'lan', category: 'aktywne',
    description: 'Punkt dostępowy Wi-Fi Stellar (PoE), montaż sufitowy/ścienny + uchwyt',
    manufacturer: 'Alcatel-Lucent', model: 'OAW-AP1301H-RW',
    unit: 'szt', knr: 'KNR EM-01 0410', matPrice: 2284.2, laborPrice: 90,
    components: [
      { sku: 'OAW-AP1301H-RW', name: 'OmniAccess AP1301H Stellar Wireless Access Point', unit: 'szt', priceNet: 2284.2, qtyPer: 1, category: 'aktywne' },
      { sku: 'OAW-AP-MNT-W', name: 'OmniAccess indoor mounting kit', unit: 'szt', priceNet: 105.75, qtyPer: 1, category: 'aktywne' }
    ]
  },

  // ── LAN bierne — panel/szafa (pozycje montowane w szafie 19", uSize) ──
  'lan.patchpanel.24': {
    key: 'lan.patchpanel.24', system: 'lan', category: 'pasywne',
    description: 'Przełącznica HD 19" ekranowana + uchwyt + 24× moduł kat.6A (wyposażona)',
    manufacturer: 'FibrainDATA', model: 'XPS00 + XMS00 + 24× XR200',
    unit: 'szt', knr: 'KNR EM-01 0210', matPrice: 334.98, laborPrice: 120, uSize: 1,
    components: [
      { sku: 'XPS00', name: 'PRZEŁACZNICA HD, EKRANOWANA, NIEWYPOSAŻONA', unit: 'szt', priceNet: 334.98, qtyPer: 1, category: 'pasywne' },
      { sku: 'XMS00', name: 'UCHWYT DO PRZEŁACZNICY HD POD MODUŁY PRZYŁĄCZENIOWE', unit: 'szt', priceNet: 37.5, qtyPer: 4, category: 'pasywne' },
      { sku: 'XR200', name: 'FIBRAIN DATA MODUŁ KAT. 6A EKRANOWANY, BEZ ADAPTERA', unit: 'szt', priceNet: 26.99, qtyPer: 24, category: 'pasywne' }
    ]
  },
  'lan.rack.42u': {
    key: 'lan.rack.42u', system: 'lan', category: 'pasywne',
    description: 'Szafa ramowa stojąca 19" 42U 600×600 + cokół + panel wentylacyjny + listwy + organizery',
    manufacturer: 'FibrainDATA', model: 'SRS-42-6/6-S04-B',
    unit: 'szt', knr: 'KNR EM-01 0501', matPrice: 2836.84, laborPrice: 350,
    components: [
      { sku: 'SRS-42-6/6-S04-B', name: 'SZAFA RAMOWA STOJĄCA, 42U/600/600 DRZWI BLACHA', unit: 'szt', priceNet: 2836.84, qtyPer: 1, category: 'pasywne' },
      { sku: 'CKS-6/6-S04-B', name: 'COKÓŁ 100 MM, DO SZAFY O SZER 600 I GŁĘB 600 MM', unit: 'szt', priceNet: 337.05, qtyPer: 1, category: 'pasywne' },
      { sku: 'WTD-4T-S04-B', name: 'PANEL WENTYLACYJNY 4-WENTYLATOROWY DACHOWO-PODŁOGOWY', unit: 'szt', priceNet: 621.67, qtyPer: 1, category: 'pasywne' },
      { sku: 'PDU-9BB', name: 'LISTWA ZASILAJĄCA 19" 9 GNIAZD Z BOLCEM', unit: 'szt', priceNet: 133, qtyPer: 2, category: 'pasywne' },
      { sku: 'ORG-VP-1U-B-V2', name: 'FIBRAIN ORGANIZATOR POZIOMY KABLI 19" Z ZAMYKANĄ KLAPĄ', unit: 'szt', priceNet: 67.23, qtyPer: 4, category: 'pasywne' },
      { sku: 'ORG-HS-6U-B', name: 'FIBRAIN ORGANIZATOR PIONOWY BOCZNY KABLI 19" 6U', unit: 'szt', priceNet: 121.69, qtyPer: 2, category: 'pasywne' }
    ]
  },

  // ── LAN czynne — Alcatel-Lucent OmniSwitch (switch dostępowy PoE 24p) ──
  'lan.switch.24p': {
    key: 'lan.switch.24p', system: 'lan', category: 'aktywne',
    description: 'Switch dostępowy 24-port PoE 1RU (OmniSwitch)',
    manufacturer: 'Alcatel-Lucent', model: 'OS6560-P24X4-EU',
    unit: 'szt', knr: 'KNR EM-01 0420', matPrice: 23379.21, laborPrice: 200, uSize: 1,
    components: [
      { sku: 'OS6560-P24X4-EU', name: 'OS6560-P24X4 Gigabit Ethernet PoE chassis 1RU', unit: 'szt', priceNet: 23379.21, qtyPer: 1, category: 'aktywne' },
      { sku: 'PP5N-OS6560', name: '5 years Partner Support Plus for OS6560', unit: 'szt', priceNet: 1328.22, qtyPer: 1, category: 'aktywne' }
    ]
  },

  // ── CCTV — Hikvision ──
  'cctv.dome.4mp': {
    key: 'cctv.dome.4mp', system: 'cctv', category: 'aktywne',
    description: 'Kamera kopułkowa IP 4 Mpx, AcuSense, IR30, IK10, PoE',
    manufacturer: 'Hikvision', model: 'DS-2CD2143G2-I',
    unit: 'szt', knr: 'KNR 5-08 0301', matPrice: 560, laborPrice: 90
  },
  'cctv.bullet.4mp': {
    key: 'cctv.bullet.4mp', system: 'cctv', category: 'aktywne',
    description: 'Kamera tubowa IP 4 Mpx, AcuSense, IR, PoE',
    manufacturer: 'Hikvision', model: 'DS-2CD2043G2-I',
    unit: 'szt', knr: 'KNR 5-08 0301', matPrice: 540, laborPrice: 90
  },
  'cctv.nvr.16': {
    key: 'cctv.nvr.16', system: 'cctv', category: 'aktywne',
    description: 'Rejestrator NVR 16-kanałów 4K z 16-portowym switchem PoE',
    manufacturer: 'Hikvision', model: 'DS-7616NI-K2/16P',
    unit: 'szt', knr: 'KNR 5-08 0320', matPrice: 1450, laborPrice: 180, uSize: 2
  },

  // ── Trasy ──
  'tray.perforated.100': {
    key: 'tray.perforated.100', system: 'tray', category: 'pasywne',
    description: 'Korytko kablowe perforowane 100 mm + podpory',
    manufacturer: 'Baks', model: 'KCJ100',
    unit: 'm', knr: 'KNR 5-08 0112', matPrice: 24, laborPrice: 16
  },
  'tray.perforated.200': {
    key: 'tray.perforated.200', system: 'tray', category: 'pasywne',
    description: 'Korytko kablowe perforowane 200 mm + podpory',
    manufacturer: 'Baks', model: 'KCJ200',
    unit: 'm', knr: 'KNR 5-08 0114', matPrice: 38, laborPrice: 20
  }
}

export function catalogEntry(key: string): CatalogEntry | undefined {
  return CATALOG[key]
}
