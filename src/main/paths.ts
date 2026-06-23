/**
 * Polityka dostępu do plików (proces główny) — pierwsza brama przed sidecarem.
 *
 * Model: ścieżki wskazane przez użytkownika przez DIALOG są autoryzowane (Main za
 * nie ręczy — `vouchPath`). Ścieżki podane wprost przez renderer muszą leżeć w
 * bazowych korzeniach (`securityRoots`), inaczej są odrzucane. To uniemożliwia
 * skompromitowanemu rendererowi zmuszenie sidecara do czytania/zapisu dowolnego
 * pliku. Sidecar (safepath.py) powtarza tę walidację jako defense-in-depth.
 */

import { app } from 'electron'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, relative, isAbsolute, resolve } from 'node:path'

/** Katalogi-katalog vouchowane (z dialogów) — kanoniczne ścieżki katalogów. */
const vouchedDirs = new Set<string>()

let cachedRoots: string[] | null = null

/** Bazowe dozwolone korzenie: Documents/InfraDesign + temp (+ appPath w dev). */
export function securityRoots(): string[] {
  if (cachedRoots) return cachedRoots
  const roots: string[] = []
  try {
    roots.push(resolve(join(app.getPath('documents'), 'InfraDesign')))
  } catch {
    /* documents niedostępne — pomiń */
  }
  try {
    roots.push(resolve(app.getPath('temp')))
  } catch {
    /* temp niedostępne — pomiń */
  }
  // W dev fixtury/projekty testowe leżą w drzewie repo.
  if (!app.isPackaged) {
    try {
      roots.push(resolve(app.getAppPath()))
    } catch {
      /* pomiń */
    }
  }
  cachedRoots = roots
  return roots
}

function isWithin(p: string, root: string): boolean {
  const rel = relative(root, p)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function withinRoots(p: string): boolean {
  return securityRoots().some((r) => isWithin(p, r))
}

/**
 * Autoryzuj plik wybrany przez użytkownika w dialogu (open/save). Zapamiętuje jego
 * katalog jako zaufany, by kolejne operacje na tym samym pliku przeszły.
 */
export function vouchPath(p: string): void {
  try {
    const dir = realpathSync(dirname(p))
    vouchedDirs.add(dir)
  } catch {
    /* katalog nie istnieje — nic nie vouchujemy */
  }
}

/**
 * Autoryzuj ODCZYT istniejącego pliku. Zwraca dozwolone korzenie do przekazania
 * sidecarowi (katalog pliku). Rzuca, gdy plik jest nieautoryzowany.
 */
export function authorizeReadFile(p: string): string[] {
  if (!p || !existsSync(p)) throw new Error('Plik nie istnieje')
  const canonical = realpathSync(p)
  const dir = dirname(canonical)
  if (vouchedDirs.has(dir) || withinRoots(canonical)) return [dir]
  throw new Error(`Ścieżka nieautoryzowana: ${canonical}`)
}

/**
 * Autoryzuj ZAPIS pliku (eksport). Katalog docelowy musi istnieć i być zaufany
 * (vouchowany dialogiem) albo leżeć w korzeniach. Zwraca dozwolone korzenie.
 */
export function authorizeWriteFile(p: string): string[] {
  if (!p) throw new Error('Brak ścieżki zapisu')
  const parent = realpathSync(dirname(p)) // rzuca, gdy katalog nie istnieje
  if (vouchedDirs.has(parent) || withinRoots(parent)) return [parent]
  throw new Error(`Zapis nieautoryzowany: ${parent}`)
}
