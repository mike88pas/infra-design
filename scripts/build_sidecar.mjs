#!/usr/bin/env node
/**
 * Buduje sidecar (PyInstaller → resources/sidecar/server.exe) PRZED pakowaniem aplikacji.
 *
 * Dlaczego osobny skrypt, a nie `npm run sidecar:build`: na Windows npm odpala skrypt przez
 * cmd.exe, gdzie ścieżka venva z ukośnikami (`sidecar/.venv/Scripts/python.exe`) bywa nieuznawana
 * → build się wywala. Tu wołamy interpreter przez Node (cross-platform) z normalizacją ścieżki.
 *
 * KRYTYCZNE: bez tego `electron-builder` pakuje ZAMROŻONY `server.exe` z poprzedniego buildu —
 * zmiany w `server.py` (np. wycinanie drzwi w routerze) NIE trafiają do .exe (cichy regres).
 * Skrypt przebudowuje sidecar tylko gdy binarka jest starsza niż źródła (albo `--force`).
 */
import { existsSync, statSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const ROOT = resolve(process.argv[2] ?? '.')
const SIDE_SRC = join(ROOT, 'sidecar', 'geometry')
const OUT = join(ROOT, 'resources', 'sidecar', 'server.exe')
const FORCE = process.argv.includes('--force')

const python = process.platform === 'win32'
  ? join(ROOT, 'sidecar', '.venv', 'Scripts', 'python.exe')
  : join(ROOT, 'sidecar', '.venv', 'bin', 'python')

if (!existsSync(python)) {
  console.error(`[sidecar] BRAK interpretera venv: ${python}\n` +
    `Utwórz środowisko sidecara (patrz sidecar/README.md) i spróbuj ponownie.`)
  process.exit(1)
}

/** Najnowszy mtime spośród plików .py w katalogu sidecara. */
function newestPySrc() {
  let newest = 0
  for (const f of readdirSync(SIDE_SRC)) {
    if (!f.endsWith('.py')) continue
    newest = Math.max(newest, statSync(join(SIDE_SRC, f)).mtimeMs)
  }
  return newest
}

if (!FORCE && existsSync(OUT) && statSync(OUT).mtimeMs >= newestPySrc()) {
  console.log('[sidecar] server.exe aktualny względem źródeł — pomijam build.')
  process.exit(0)
}

console.log('[sidecar] Buduję server.exe (PyInstaller)…')
const args = [
  '-m', 'PyInstaller', '--noconfirm', '--onefile', '--name', 'server',
  '--paths', 'sidecar/geometry', '--hidden-import', 'safepath',
  '--hidden-import', 'openpyxl', '--collect-submodules', 'openpyxl',
  '--distpath', 'resources/sidecar', '--workpath', 'build/pyi',
  '--specpath', 'build/pyi', 'sidecar/geometry/server.py'
]
// ELECTRON_RUN_AS_NODE psuje wywołania potomne na Windows — czyścimy dla pewności.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const res = spawnSync(python, args, { cwd: ROOT, stdio: 'inherit', env })
if (res.status !== 0) {
  console.error('[sidecar] Build sidecara NIE powiódł się — przerywam pakowanie.')
  process.exit(res.status ?? 1)
}
console.log('[sidecar] Gotowe:', OUT)
