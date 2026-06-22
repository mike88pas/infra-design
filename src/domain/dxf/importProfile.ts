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

  // ── Geometria pomieszczeń ──
  /** Źródło pomieszczeń: etykiety pól (A-AREA, czyste) lub rekonstrukcja ze ścian. */
  roomSource: 'area' | 'walls'
  /** Tokeny warstw etykiet pól (dla roomSource='area'). */
  areaLayers: string[]
  /** Tokeny warstw ścian do `polygonize`/trasowania (dopasowanie po podłańcuchu). */
  wallLayers: string[]
  /** Wejść w bloki INSERT (podkład architektoniczny bywa jednym blokiem). */
  explodeBlocks: boolean

  // ── Instalacje ──
  /** Warstwa → system/typ urządzenia (null = pomiń). Do potwierdzenia w UI. */
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
  return {
    projectName: input.projectName ?? '',
    client: input.client ?? '',
    drawingName: fileName.replace(/\.dxf$/i, ''),
    level: guessLevel(fileName),
    units: input.units,
    unitMm: input.units === 'm' ? 1000 : 1,
    // Etykiety pól (A-AREA) gdy są w rysunku — czystsze pomieszczenia niż ze ścian.
    roomSource: input.layers.some((l) => /area/i.test(l.name)) ? 'area' : 'walls',
    areaLayers: ['AREA'],
    // Domyślnie tokeny ścian z warstw; gdy brak — generyczny token 'WALL' (łapie A-WALL po eksplozji).
    wallLayers: wall.length ? wall : ['WALL'],
    explodeBlocks: true,
    systemMapping: guessSystemMapping(input.layers),
    doRouting: true,
    targetLayers: ['szaf', 'rack'],
    cableSparePct: 5,
    overheadPct: 12,
    vatPct: 23
  }
}
