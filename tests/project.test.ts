import { describe, it, expect } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import { saveProject, loadProject } from '../src/main/project'
import { createEmptyBundle, createEmptyProject, SCHEMA_VERSION } from '../src/domain/model/schema'

describe('Paczka .infra (SQLite/sql.js) — round-trip', () => {
  it('zapisuje i wczytuje projekt bez utraty danych', async () => {
    const project = createEmptyProject({ id: 'test-123', name: 'Pilot LAN', now: '2026-06-21T10:00:00.000Z' })
    project.client = 'Firma Instalacyjna sp. z o.o.'
    const bundle = createEmptyBundle(project)

    const file = join(tmpdir(), `infra-test-${Date.now()}.infra`)
    try {
      await saveProject(file, bundle)
      const loaded = await loadProject(file)
      expect(loaded.project.id).toBe('test-123')
      expect(loaded.project.name).toBe('Pilot LAN')
      expect(loaded.project.client).toBe('Firma Instalacyjna sp. z o.o.')
      expect(loaded.project.activeSystems).toEqual(['lan', 'cctv'])
      expect(loaded.project.schemaVersion).toBe(SCHEMA_VERSION)
    } finally {
      await rm(file, { force: true })
    }
  })
})
