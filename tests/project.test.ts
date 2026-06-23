import { describe, it, expect } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rm, readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { saveProject, loadProject } from '../src/main/project'
import { isEncrypted } from '../src/main/crypto/container'
import { createEmptyBundle, createEmptyProject, SCHEMA_VERSION } from '../src/domain/model/schema'

const KEY = randomBytes(32)

describe('Paczka .infra (SQLite/sql.js, szyfrowana) — round-trip', () => {
  it('zapisuje (zaszyfrowane) i wczytuje projekt bez utraty danych', async () => {
    const project = createEmptyProject({ id: 'test-123', name: 'Pilot LAN', now: '2026-06-21T10:00:00.000Z' })
    project.client = 'Firma Instalacyjna sp. z o.o.'
    const bundle = createEmptyBundle(project)

    const file = join(tmpdir(), `infra-test-${Date.now()}.infra`)
    try {
      await saveProject(file, bundle, KEY)
      // Plik na dysku jest zaszyfrowany (kontener INFRA1), nie jawny SQLite.
      const raw = await readFile(file)
      expect(isEncrypted(raw)).toBe(true)

      const { bundle: loaded, migratedFromPlain } = await loadProject(file, KEY)
      expect(migratedFromPlain).toBe(false)
      expect(loaded.project.id).toBe('test-123')
      expect(loaded.project.name).toBe('Pilot LAN')
      expect(loaded.project.client).toBe('Firma Instalacyjna sp. z o.o.')
      expect(loaded.project.activeSystems).toEqual(['lan', 'cctv'])
      expect(loaded.project.schemaVersion).toBe(SCHEMA_VERSION)
    } finally {
      await rm(file, { force: true })
    }
  })

  it('odrzuca odczyt złym kluczem', async () => {
    const bundle = createEmptyBundle(createEmptyProject({ id: 'x', name: 'X', now: '2026-06-21T10:00:00.000Z' }))
    const file = join(tmpdir(), `infra-badkey-${Date.now()}.infra`)
    try {
      await saveProject(file, bundle, KEY)
      await expect(loadProject(file, randomBytes(32))).rejects.toThrow(/odszyfrowa/)
    } finally {
      await rm(file, { force: true })
    }
  })
})
