/**
 * PUBLICZNY katalog dla web demo — podmieniany za realny `@domain/installations/catalog`
 * przez plugin w `web/vite.config.ts` (build-time swap).
 *
 * DLACZEGO: realny katalog (produkt desktop) zawiera nazwy producentów i SKU odwzorowane
 * z kosztorysów referencyjnych klienta (NDA). Strona publiczna liczy demo na katalogu
 * o TYCH SAMYCH kluczach i realistycznych cenach rynkowych, ale z neutralnymi oznaczeniami
 * klasy produktu — bundle JS nie zdradza marek ani relacji dostawcowych.
 *
 * Kontrakt: musi eksportować to samo co realny catalog.ts (typy type-only — znikają
 * w buildzie, więc swap nie tworzy cyklu).
 */

import type { CatalogEntry, KosztorysCategory, SkuLine } from '@domain/installations/catalog'

export type { CatalogEntry, KosztorysCategory, SkuLine }

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
  'lan.outlet.2x': {
    key: 'lan.outlet.2x', system: 'lan', category: 'pasywne',
    description: 'Gniazdo logiczne 2×RJ45 kat.6A ekran. (komplet: puszka + suport + ramka + moduły)',
    model: 'PP-2xRJ45-6A',
    unit: 'kpl', knr: 'KNR EM-01 0201', matPrice: 85, laborPrice: 45
  },
  'lan.outlet.1x': {
    key: 'lan.outlet.1x', system: 'lan', category: 'pasywne',
    description: 'Gniazdo logiczne 1×RJ45 kat.6A ekran. (komplet)',
    model: 'PP-1xRJ45-6A',
    unit: 'kpl', knr: 'KNR EM-01 0201', matPrice: 50, laborPrice: 38
  },
  'cable.utp.cat6': {
    key: 'cable.utp.cat6', system: 'lan', category: 'pasywne',
    description: 'Kabel instalacyjny kat.6A S/FTP 4P LSOH (drut)',
    model: 'KAB-6A-SFTP',
    unit: 'm', knr: 'KNR EM-01 0105', matPrice: 5, laborPrice: 1.9
  },
  'lan.ap': {
    key: 'lan.ap', system: 'lan', category: 'aktywne',
    description: 'Punkt dostępowy Wi-Fi 6 (PoE), montaż sufitowy/ścienny + uchwyt',
    model: 'AP-WIFI6-POE',
    unit: 'szt', knr: 'KNR EM-01 0410', matPrice: 2290, laborPrice: 90
  },
  'lan.patchpanel.24': {
    key: 'lan.patchpanel.24', system: 'lan', category: 'pasywne',
    description: 'Przełącznica HD 19" ekranowana, 24× moduł kat.6A (wyposażona)',
    model: 'PPAN-24-6A',
    unit: 'szt', knr: 'KNR EM-01 0210', matPrice: 335, laborPrice: 120, uSize: 1
  },
  'lan.rack.42u': {
    key: 'lan.rack.42u', system: 'lan', category: 'pasywne',
    description: 'Szafa ramowa stojąca 19" 42U 600×600 + cokół + wentylacja + listwy + organizery',
    model: 'SZ-42U-66',
    unit: 'szt', knr: 'KNR EM-01 0501', matPrice: 2840, laborPrice: 350
  },
  'lan.switch.24p': {
    key: 'lan.switch.24p', system: 'lan', category: 'aktywne',
    description: 'Switch dostępowy 24-port PoE 1RU (klasa enterprise, 5 lat wsparcia)',
    model: 'SW-24P-POE',
    unit: 'szt', knr: 'KNR EM-01 0420', matPrice: 23400, laborPrice: 200, uSize: 1
  },
  'cctv.dome.4mp': {
    key: 'cctv.dome.4mp', system: 'cctv', category: 'aktywne',
    description: 'Kamera kopułkowa IP 4 Mpx, analityka, IR30, IK10, PoE',
    model: 'CAM-D4-IR',
    unit: 'szt', knr: 'KNR 5-08 0301', matPrice: 560, laborPrice: 90
  },
  'cctv.bullet.4mp': {
    key: 'cctv.bullet.4mp', system: 'cctv', category: 'aktywne',
    description: 'Kamera tubowa IP 4 Mpx, analityka, IR, PoE',
    model: 'CAM-B4-IR',
    unit: 'szt', knr: 'KNR 5-08 0301', matPrice: 540, laborPrice: 90
  },
  'cctv.nvr.16': {
    key: 'cctv.nvr.16', system: 'cctv', category: 'aktywne',
    description: 'Rejestrator NVR 16-kanałów 4K z 16-portowym switchem PoE',
    model: 'NVR-16-POE',
    unit: 'szt', knr: 'KNR 5-08 0320', matPrice: 1450, laborPrice: 180, uSize: 2
  },
  'tray.perforated.100': {
    key: 'tray.perforated.100', system: 'tray', category: 'pasywne',
    description: 'Korytko kablowe perforowane 100 mm + podpory',
    model: 'KOR-100',
    unit: 'm', knr: 'KNR 5-08 0112', matPrice: 24, laborPrice: 16
  },
  'tray.perforated.200': {
    key: 'tray.perforated.200', system: 'tray', category: 'pasywne',
    description: 'Korytko kablowe perforowane 200 mm + podpory',
    model: 'KOR-200',
    unit: 'm', knr: 'KNR 5-08 0114', matPrice: 38, laborPrice: 20
  }
}

export function catalogEntry(key: string): CatalogEntry | undefined {
  return CATALOG[key]
}
