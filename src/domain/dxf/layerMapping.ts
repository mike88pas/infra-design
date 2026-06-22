/**
 * Mapowanie warstw DXF → role semantyczne.
 *
 * Biura CAD nazywają warstwy różnie (WALLS, A-WALL, SCIANY, MUR…). Heurystyka po
 * nazwie daje PODPOWIEDŹ — projektant potwierdza/zmienia w UI. Profil mapowań
 * (per biuro) można zapisać i reużyć (F1: tylko heurystyka + ręczna korekta).
 */

import type { DxfLayer } from '../model/schema'

export type LayerRole = 'walls' | 'doors' | 'windows' | 'rooms' | 'text' | 'other'

interface RolePattern {
  role: LayerRole
  re: RegExp
}

// Kolejność ma znaczenie — pierwszy trafiony wzorzec wygrywa.
const PATTERNS: RolePattern[] = [
  { role: 'walls', re: /(wall|scian|ścian|mur|a-wall|wand)/i },
  { role: 'doors', re: /(door|drzwi|a-door|tür|tur)/i },
  { role: 'windows', re: /(window|okno|okna|a-glaz|fenster)/i },
  { role: 'rooms', re: /(room|pomiesz|space|a-area|raum)/i },
  { role: 'text', re: /(text|txt|opis|label|annot|a-anno)/i }
]

/** Zgaduje rolę warstwy po nazwie (podpowiedź dla UI mapowania). */
export function guessLayerRole(name: string): LayerRole {
  for (const p of PATTERNS) if (p.re.test(name)) return p.role
  return 'other'
}

/**
 * Domyślne warstwy ścian do `polygonize`. Jeśli żadna nazwa nie pasuje do
 * wzorca ścian — zwraca pustą tablicę (sidecar użyje wszystkich warstw).
 */
export function guessWallLayers(layers: DxfLayer[]): string[] {
  return layers.filter((l) => guessLayerRole(l.name) === 'walls').map((l) => l.name)
}

/** Wstępne mapowanie wszystkich warstw (nazwa → rola) dla panelu UI. */
export function guessLayerRoles(layers: DxfLayer[]): Record<string, LayerRole> {
  const out: Record<string, LayerRole> = {}
  for (const l of layers) out[l.name] = guessLayerRole(l.name)
  return out
}
