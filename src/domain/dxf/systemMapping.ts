/**
 * Mapowanie warstw DXF → system instalacji + typ urządzenia (F2).
 *
 * Symbole urządzeń w projektach wykonawczych to często bloki anonimowe (*U34),
 * więc klasyfikacja idzie po NAZWIE WARSTWY. Konwencje biur bywają różne; tu
 * heurystyka pokrywa popularny układ `PST_*` (np. Teatr Rzeszów) + warianty
 * polsko/angielskie. To PODPOWIEDŹ — projektant potwierdza/poprawia w kreatorze importu.
 *
 * Wynik per warstwa:
 *   { system, typeKey }  — warstwa to urządzenia danego systemu,
 *   null                 — warstwa świadomie pomijana (legenda, podkład, strefy zasięgu),
 *   (brak klucza)        — niejednoznaczne, decyduje użytkownik.
 */

import type { SystemKey } from '@domain/model/schema'

export interface SystemTypeMapping {
  system: SystemKey
  typeKey: string
}

/** Mapa: nazwa warstwy → mapowanie (lub null = pomiń). Brak klucza = niejednoznaczne. */
export type LayerSystemMap = Record<string, SystemTypeMapping | null>

interface SystemPattern {
  re: RegExp
  system: SystemKey
  typeKey: string
}

/**
 * Warstwy świadomie pomijane (nie są punktami urządzeń):
 * zasięgi/strefy widzenia kamer, opisy wysokości, legenda, podkład architektoniczny.
 */
const IGNORE_RE =
  /(zasi[eę]g|stref|legend|podk[łl]ad|\bopis\b|wysoko[śs]|^0$|defpoints)/i

// Kolejność ma znaczenie — pierwszy trafiony wzorzec wygrywa.
const PATTERNS: SystemPattern[] = [
  // LAN — gniazda logiczne RJ-45 / okablowanie strukturalne
  { re: /(rj-?45|gniazd[ao].*log|log.*gniazd|okablowanie\s*struktural|patch)/i, system: 'lan', typeKey: 'lan.outlet.2x' },
  // LAN — punkty dostępowe Wi-Fi (AP)
  { re: /(\bap\b|access\s*point|punkt.*dost[eę]pow|wi-?fi)/i, system: 'lan', typeKey: 'lan.ap' },
  // CCTV — kamery / telewizja dozorowa (po odfiltrowaniu „zasięgów” przez IGNORE)
  { re: /(cctv|kamer|telewizj|\btvu\b|dozorow)/i, system: 'cctv', typeKey: 'cctv.dome.4mp' },
  // KD — kontrola dostępu / czytniki
  { re: /(kontrol.*dost[eę]p|\bkd\b|\bskd\b|czytnik)/i, system: 'kd', typeKey: 'kd.reader' },
  // KD — intercomy / domofony (wejścia)
  { re: /(intercom|domofon)/i, system: 'kd', typeKey: 'kd.intercom' },
  // LAN — punkty elektryczno-logiczne (PEL)
  { re: /(elektryczno\s*logiczn|\bpel\b)/i, system: 'lan', typeKey: 'lan.outlet.2x' }
]

/** Klasyfikuje pojedynczą warstwę. null = pomiń; undefined = niejednoznaczne. */
export function classifyLayer(name: string): SystemTypeMapping | null | undefined {
  if (IGNORE_RE.test(name)) return null
  for (const p of PATTERNS) {
    if (p.re.test(name)) return { system: p.system, typeKey: p.typeKey }
  }
  return undefined
}

/**
 * Buduje wstępną mapę warstwa→system/typ dla kreatora importu.
 * Tylko warstwy rozpoznane (urządzenie lub świadomy pominięcie) trafiają do mapy;
 * niejednoznaczne pomijamy — użytkownik je przypisze ręcznie.
 */
export function guessSystemMapping(layers: Array<{ name: string }>): LayerSystemMap {
  const out: LayerSystemMap = {}
  for (const l of layers) {
    const m = classifyLayer(l.name)
    if (m !== undefined) out[l.name] = m
  }
  return out
}
