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

/** Zapisuje ProjectBundle do pliku `.infra` (SQLite). */
export async function saveProject(filePath: string, bundle: ProjectBundle): Promise<void> {
  const SQL = await getSql()
  const db = new SQL.Database()
  try {
    writeBundle(db, bundle)
    const data = db.export() // Uint8Array
    await writeFile(filePath, Buffer.from(data))
  } finally {
    db.close()
  }
}

/** Wczytuje ProjectBundle z pliku `.infra`. */
export async function loadProject(filePath: string): Promise<ProjectBundle> {
  const SQL = await getSql()
  const fileBuf = await readFile(filePath)
  const db = new SQL.Database(new Uint8Array(fileBuf))
  try {
    const res = db.exec('SELECT json FROM doc WHERE id = 1')
    if (!res.length || !res[0].values.length) {
      throw new Error('Plik .infra nie zawiera danych projektu')
    }
    const json = res[0].values[0][0] as string
    const bundle = JSON.parse(json) as ProjectBundle
    if (bundle.project.schemaVersion > SCHEMA_VERSION) {
      throw new Error(
        `Plik utworzony nowszą wersją schematu (${bundle.project.schemaVersion} > ${SCHEMA_VERSION})`
      )
    }
    return bundle
  } finally {
    db.close()
  }
}
