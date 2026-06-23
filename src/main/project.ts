/**
 * Paczka `.infra` — projekt zapisany jako baza SQLite.
 *
 * Używamy sql.js (SQLite skompilowany do WASM) — realny SQLite bez natywnej
 * kompilacji (zero problemów z ABI Electron / node-gyp w CI). Plik `.infra`
 * to po prostu zrzut bazy zapisany na dysk.
 *
 * Struktura F0 (celowo minimalna, normalizacja tabel dochodzi w F1):
 *   meta(key TEXT PRIMARY KEY, value TEXT)   -- schema_version, created_at, ...
 *   doc(id INTEGER PRIMARY KEY, json TEXT)   -- jeden wiersz: cały ProjectBundle
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { SCHEMA_VERSION, type ProjectBundle } from '@domain/model/schema'
import { parseProjectBundle, MAX_JSON_BYTES } from '@domain/model/validate'
import { encryptBundle, decryptBundle, isEncrypted, isLegacyPlain } from './crypto/container'

const require = createRequire(import.meta.url)

let sqlPromise: Promise<SqlJsStatic> | null = null

function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    // Lokalizujemy sql-wasm.wasm obok pliku JS pakietu sql.js.
    const distDir = dirname(require.resolve('sql.js'))
    sqlPromise = initSqlJs({ locateFile: (f: string) => join(distDir, f) })
  }
  return sqlPromise
}

function writeBundle(db: Database, bundle: ProjectBundle): void {
  db.run('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)')
  db.run('CREATE TABLE IF NOT EXISTS doc (id INTEGER PRIMARY KEY, json TEXT)')
  const now = new Date().toISOString()
  db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['schema_version', String(SCHEMA_VERSION)])
  db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['saved_at', now])
  db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['project_name', bundle.project.name])
  db.run('DELETE FROM doc')
  db.run('INSERT INTO doc (id, json) VALUES (1, ?)', [JSON.stringify(bundle)])
}

/**
 * Wynik wczytania paczki — bundle + informacja, czy plik był jeszcze niezaszyfrowany
 * (stara paczka). UI może wtedy zaproponować ponowny zapis (już zaszyfrowany).
 */
export interface LoadedProject {
  bundle: ProjectBundle
  migratedFromPlain: boolean
}

/**
 * Zapisuje ProjectBundle do pliku `.infra`. Bajty bazy SQLite są szyfrowane at-rest
 * kluczem głównym (AES-256-GCM, patrz crypto/container.ts). Klucz dostarcza proces
 * główny z keystore — paczka NIGDY nie leży jawnie na dysku.
 */
export async function saveProject(filePath: string, bundle: ProjectBundle, key: Buffer): Promise<void> {
  const SQL = await getSql()
  const db = new SQL.Database()
  try {
    writeBundle(db, bundle)
    const data = db.export() // Uint8Array (jawny SQLite)
    const enc = encryptBundle(key, data) // kontener INFRA1
    await writeFile(filePath, enc)
  } finally {
    db.close()
  }
}

/**
 * Wczytuje ProjectBundle z pliku `.infra`. Obsługuje zaszyfrowane paczki (INFRA1)
 * oraz — wstecznie — stare jawne pliki SQLite (oznaczane jako `migratedFromPlain`).
 * Zawartość jest walidowana (parseProjectBundle) zanim trafi do aplikacji.
 */
export async function loadProject(filePath: string, key: Buffer): Promise<LoadedProject> {
  const SQL = await getSql()
  const fileBuf = await readFile(filePath)

  let sqliteBytes: Uint8Array
  let migratedFromPlain = false
  if (isEncrypted(fileBuf)) {
    sqliteBytes = new Uint8Array(decryptBundle(key, fileBuf))
  } else if (isLegacyPlain(fileBuf)) {
    sqliteBytes = new Uint8Array(fileBuf) // stara paczka — wczytaj, zaproponuj re-save
    migratedFromPlain = true
  } else {
    throw new Error('Nierozpoznany format pliku .infra (ani zaszyfrowany, ani SQLite)')
  }

  const db = new SQL.Database(sqliteBytes)
  try {
    const res = db.exec('SELECT json FROM doc WHERE id = 1')
    if (!res.length || !res[0].values.length) {
      throw new Error('Plik .infra nie zawiera danych projektu')
    }
    const json = res[0].values[0][0] as string
    if (typeof json !== 'string' || json.length > MAX_JSON_BYTES) {
      throw new Error('Dane projektu są uszkodzone lub zbyt duże')
    }
    const bundle = parseProjectBundle(JSON.parse(json))
    if (bundle.project.schemaVersion > SCHEMA_VERSION) {
      throw new Error(
        `Plik utworzony nowszą wersją schematu (${bundle.project.schemaVersion} > ${SCHEMA_VERSION})`
      )
    }
    return { bundle, migratedFromPlain }
  } finally {
    db.close()
  }
}
