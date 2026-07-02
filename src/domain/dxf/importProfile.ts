/**
 * Profil importu rzutu (F2) — kontrakt WARTOŚCI POCZĄTKOWYCH, które projektant
 * potwierdza w kreatorze importu zanim DXF zamieni się w urządzenia/BOM.
 *
 * Automatyka nie zna wszystkiego (nazwa projektu, numer kondygnacji, skala, które
 * warstwy to ściany, jak mapować warstwy na systemy, narzuty kosztorysu) — te dane
 * pochodzą od użytkownika. `buildDefaultProfile` wypełnia sensowne domyślne z heurystyk;
 * formularz pozwala je poprawić; `devicesFromInserts`/`polygonize`/`buildCost` je konsumują.
 */

import type { DxfLayer, Units } from '@domain/model/schema'
import { guessWallLayers } from './layerMapping'
import { guessSystemMapping, type LayerSystemMap } from './systemMapping'

export interface ImportProfile {
  // ── Projekt / rysunek ──
  projectName: string
  client: string
  drawingName: string
  /** Numer kondygnacji (parter = 0, podziemie ujemne, dach = osobno). */
  level: number

  // ── Jednostki / skala ──
  units: Units
  /** Ile milimetrów przypada na jednostkę modelu (kalibracja). mm→1, m→1000. */
  unitMm: number
  /** Skala rysunku do tabelki PN (np. „1:100") — opisowa, nie wpływa na obliczenia. */
  scaleText: string

  // ── Geometria pomieszczeń ──
  /**
   * Źródło pomieszczeń:
   *  - 'area'     — etykiety pól (A-AREA, czyste),
   *  - 'walls'    — rekonstrukcja ze ścian (polygonize),
   *  - 'schedule' — TABELA „Zestawienie" (numer|nazwa|m²) + etykiety-numery na rzucie;
   *                 dla DWG zwektoryzowanych z PDF (brak warstw pól ani PST_*).
   */
  roomSource: 'area' | 'walls' | 'schedule'
  /** Tokeny warstw etykiet pól (dla roomSource='area'). */
  areaLayers: string[]
  /** Tokeny warstw ścian do `polygonize`/trasowania (dopasowanie po podłańcuchu). */
  wallLayers: string[]
  /** Tokeny warstw drzwi — otwory „przebijają” ściany w routerze (kabel idzie przez drzwi). */
  doorLayers: string[]
  /** Wejść w bloki INSERT (podkład architektoniczny bywa jednym blokiem). */
  explodeBlocks: boolean
  /** (schedule) Mnożnik pozycji etykiet (zwykle 1.0 — kalibracja idzie przez `unitMm`). */
  scheduleScale: number
  /** (schedule) Nagłówek kolumny nazwy w tabeli zestawienia. */
  scheduleHeaderName: string
  /** (schedule) Nagłówek kolumny powierzchni w tabeli zestawienia. */
  scheduleHeaderArea: string

  // ── Instalacje ──
  /** Tryb: 'extract' = odczytaj naniesione urządzenia; 'autodesign' = zaprojektuj od zera. */
  mode: 'extract' | 'autodesign'
  /** Auto-design: gęstość gniazd LAN (1 gniazdo 2×RJ45 na N m²). */
  autoM2PerOutlet: number
  /** Auto-design: 1 AP na N m² (w pomieszczeniach ≥ autoApMinM2). */
  autoM2PerAp: number
  /** Auto-design: AP tylko w pomieszczeniach ≥ N m². */
  autoApMinM2: number
  /** Auto-design: kamera gdy pomieszczenie ≥ N m² (lub nazwa-klucz). */
  autoCamMinM2: number
  /** Auto-design: słowa kluczowe nazw pomieszczeń z kamerą (wejście, hol, korytarz…). */
  autoCamKeywords: string[]
  /** Warstwa → system/typ urządzenia (null = pomiń). Do potwierdzenia w UI (tryb extract). */
  systemMapping: LayerSystemMap

  // ── Trasowanie ──
  /** Trasować kable A* od urządzeń do szaf (cięższe obliczeniowo). */
  doRouting: boolean
  /** Tokeny warstw szaf/rozdzielni (cele tras). */
  targetLayers: string[]

  // ── Kosztorys ──
  cableSparePct: number
  overheadPct: number
  vatPct: number
}

/** Wyłuskuje numer kondygnacji z nazwy pliku (K+1→1, K-1→-1, U12/K-1→-1, DACH→100). */
export function guessLevel(fileName: string): number {
  const f = fileName.toUpperCase()
  if (/DACH|ROOF/.test(f)) return 100 // umowny „dach”
  const m = f.match(/K\s*([+-])\s*(\d+)/) // K+1, K-1
  if (m) return (m[1] === '-' ? -1 : 1) * parseInt(m[2], 10)
  const u = f.match(/\bU\s*(\d)/) // U1.. (podziemie)
  if (u) return -parseInt(u[1], 10)
  return 0
}

export interface DefaultProfileInput {
  layers: DxfLayer[]
  units: Units
  fileName?: string
  projectName?: string
  client?: string
}

/** Buduje domyślny profil z heurystyk (start dla kreatora importu). */
export function buildDefaultProfile(input: DefaultProfileInput): ImportProfile {
  const fileName = input.fileName ?? ''
  const wall = guessWallLayers(input.layers)
  // Źródło pomieszczeń: A-AREA → 'area'; DWG z PDF (warstwy PDF_*, bez warstw pól)
  // → 'schedule' (tabela zestawienia); inaczej rekonstrukcja ze ścian.
  const roomSource: ImportProfile['roomSource'] = input.layers.some((l) => /area/i.test(l.name))
    ? 'area'
    : input.layers.some((l) => /^PDF_|PDF_/i.test(l.name))
      ? 'schedule'
      : 'walls'
  // Kalibracja: rzut zwektoryzowany z PDF (schedule) jest w skali ARKUSZA 1:100 — 1 jednostka
  // = 1 mm papieru = 100 mm realnych → unitMm=100. Inaczej długości kabli i rozstaw urządzeń
  // wychodzą 100× za małe. (Pole edytowalne + narzędzie kalibracji dla innych skal.)
  const unitMm = roomSource === 'schedule' ? 100 : input.units === 'm' ? 1000 : 1
  return {
    projectName: input.projectName ?? '',
    client: input.client ?? '',
    drawingName: fileName.replace(/\.dxf$/i, ''),
    level: guessLevel(fileName),
    units: input.units,
    unitMm,
    scaleText: '1:100',
    roomSource,
    areaLayers: ['AREA'],
    scheduleScale: 1.0,
    scheduleHeaderName: 'Pomieszczenie',
    scheduleHeaderArea: 'Powierzchnia',
    // Domyślnie tokeny ścian z warstw; gdy brak — generyczny token 'WALL' (łapie A-WALL po eksplozji).
    wallLayers: wall.length ? wall : ['WALL'],
    // Drzwi: tokeny domyślne łapią A-DOOR / DRZWI po podłańcuchu (otwory w ścianach dla tras).
    doorLayers: ['DOOR', 'DRZWI'],
    explodeBlocks: true,
    systemMapping: guessSystemMapping(input.layers),
    // Tryb: gdy rysunek ma warstwy urządzeń (PST_…) → odczyt; inaczej projektuj od zera.
    mode: Object.values(guessSystemMapping(input.layers)).some((m) => m !== null) ? 'extract' : 'autodesign',
    autoM2PerOutlet: 10,
    // Reguły AP/CCTV — spójne z DEFAULT_AUTODESIGN_RULES; wytyczne klienta nadpisują w kreatorze.
    autoM2PerAp: 100,
    autoApMinM2: 30,
    autoCamMinM2: 40,
    autoCamKeywords: ['wejśc', 'wejsc', 'foyer', 'hol', 'korytarz', 'scena', 'magazyn', 'recepcj', 'klatka'],
    doRouting: true,
    targetLayers: ['szaf', 'rack'],
    cableSparePct: 5,
    overheadPct: 12,
    vatPct: 23
  }
}
