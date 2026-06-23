/**
 * Walidacja paczki `.infra` po deserializacji (defense przeciw złośliwemu/uszkodzonemu
 * plikowi projektu). Plik `.infra` bywa wymieniany między ludźmi — wczytanie cudzej
 * paczki nie może doprowadzić do XSS (przez pola tekstowe renderowane w UI) ani do
 * wyczerpania pamięci (ogromne tablice/geometrie trafiające do PixiJS i sidecara).
 *
 * Walidator jest celowo bez zewnętrznych zależności (zod) — pełna kontrola i zero
 * nowych pakietów. Sprawdza strukturę „na tyle, by bezpiecznie wczytać i renderować".
 */

import {
  SCHEMA_VERSION,
  type ProjectBundle,
  type Project,
  type SystemKey,
  type VerticalKey,
  type Units
} from './schema'

/** Górny limit długości stringa JSON przed parsowaniem (~ rozmiar pliku). */
export const MAX_JSON_BYTES = 500 * 1024 * 1024

const MAX_STR = 4000
const ALLOWED_SYSTEMS: SystemKey[] = ['lan', 'cctv', 'sap', 'dso', 'sswin', 'kd', 'elec', 'tray', 'bms']
const ALLOWED_VERTICALS: VerticalKey[] = ['installations', 'interior', 'architecture']

// Limity rozmiaru kolekcji (ochrona przed OOM ze spreparowanego pliku).
const LIMITS: Record<string, number> = {
  designers: 10_000,
  drawings: 10_000,
  spaces: 50_000,
  devices: 200_000,
  trays: 100_000,
  routes: 200_000,
  circuits: 100_000,
  racks: 10_000,
  panels: 10_000,
  bom: 200_000,
  costs: 200_000,
  validations: 500_000
}
const MAX_POLY_POINTS = 100_000

function fail(msg: string): never {
  throw new Error(`Niepoprawna paczka projektu: ${msg}`)
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown, field: string, { max = MAX_STR, optional = false } = {}): string {
  if (v === undefined || v === null) {
    if (optional) return ''
    fail(`brak pola tekstowego '${field}'`)
  }
  if (typeof v !== 'string') fail(`pole '${field}' nie jest tekstem`)
  if (v.length > max) fail(`pole '${field}' przekracza limit długości`)
  return v
}

function finite(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`pole '${field}' nie jest skończoną liczbą`)
  return v
}

function arr(v: unknown, field: string): unknown[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) fail(`pole '${field}' nie jest tablicą`)
  const limit = LIMITS[field]
  if (limit !== undefined && v.length > limit) fail(`tablica '${field}' przekracza limit (${limit})`)
  return v
}

function checkPoints(v: unknown, field: string): void {
  if (v === undefined) return
  if (!Array.isArray(v)) fail(`'${field}' nie jest tablicą punktów`)
  if (v.length > MAX_POLY_POINTS) fail(`'${field}' ma za dużo punktów`)
  for (const p of v) {
    if (!isObj(p)) fail(`punkt w '${field}' nie jest obiektem`)
    finite(p.x, `${field}.x`)
    finite(p.y, `${field}.y`)
  }
}

function parseProject(raw: unknown): Project {
  if (!isObj(raw)) fail("brak obiektu 'project'")
  const sv = raw.schemaVersion
  if (typeof sv !== 'number' || !Number.isInteger(sv) || sv < 1) fail("niepoprawny 'schemaVersion'")
  if (sv > SCHEMA_VERSION) fail(`plik utworzony nowszą wersją schematu (${sv} > ${SCHEMA_VERSION})`)

  const units = raw.units
  if (units !== 'mm' && units !== 'm') fail("niepoprawne 'units'")

  const systems = arr(raw.activeSystems, 'activeSystems').map((s, i) => {
    if (!ALLOWED_SYSTEMS.includes(s as SystemKey)) fail(`niedozwolony system w activeSystems[${i}]`)
    return s as SystemKey
  })
  const verticals = arr(raw.activeVerticals, 'activeVerticals').map((s, i) => {
    if (!ALLOWED_VERTICALS.includes(s as VerticalKey)) fail(`niedozwolona wertykała activeVerticals[${i}]`)
    return s as VerticalKey
  })

  const designerId = raw.designerId
  if (designerId !== null && typeof designerId !== 'string') fail("niepoprawne 'designerId'")

  return {
    id: str(raw.id, 'project.id', { max: 200 }),
    name: str(raw.name, 'project.name', { max: 1000 }),
    client: str(raw.client, 'project.client', { max: 1000, optional: true }),
    units: units as Units,
    createdAt: str(raw.createdAt, 'project.createdAt', { max: 100, optional: true }),
    updatedAt: str(raw.updatedAt, 'project.updatedAt', { max: 100, optional: true }),
    designerId: (designerId as string | null) ?? null,
    activeVerticals: verticals,
    activeSystems: systems,
    schemaVersion: sv
  }
}

/**
 * Waliduje i normalizuje surowy obiekt do ProjectBundle. Rzuca Error z czytelnym
 * powodem przy danych niezgodnych ze schematem lub przekraczających limity.
 * Brakujące kolekcje są uzupełniane pustymi tablicami (tolerancja na stare paczki).
 */
export function parseProjectBundle(raw: unknown): ProjectBundle {
  if (!isObj(raw)) fail('paczka nie jest obiektem')

  const project = parseProject(raw.project)

  // Geometria, która trafia do renderera/sidecara — sprawdzamy skończoność liczb.
  const spaces = arr(raw.spaces, 'spaces')
  for (const s of spaces) {
    if (!isObj(s)) fail('element spaces nie jest obiektem')
    checkPoints(s.polygon, 'space.polygon')
  }
  const devices = arr(raw.devices, 'devices')
  for (const d of devices) {
    if (!isObj(d)) fail('element devices nie jest obiektem')
    if (isObj(d.position)) {
      finite(d.position.x, 'device.position.x')
      finite(d.position.y, 'device.position.y')
    }
  }
  const routes = arr(raw.routes, 'routes')
  for (const r of routes) {
    if (!isObj(r)) fail('element routes nie jest obiektem')
    checkPoints(r.path, 'route.path')
  }
  const trays = arr(raw.trays, 'trays')
  for (const t of trays) {
    if (!isObj(t)) fail('element trays nie jest obiektem')
    checkPoints(t.path, 'tray.path')
  }

  return {
    project,
    designers: arr(raw.designers, 'designers') as ProjectBundle['designers'],
    drawings: arr(raw.drawings, 'drawings') as ProjectBundle['drawings'],
    spaces: spaces as ProjectBundle['spaces'],
    devices: devices as ProjectBundle['devices'],
    trays: trays as ProjectBundle['trays'],
    routes: routes as ProjectBundle['routes'],
    circuits: arr(raw.circuits, 'circuits') as ProjectBundle['circuits'],
    racks: arr(raw.racks, 'racks') as ProjectBundle['racks'],
    panels: arr(raw.panels, 'panels') as ProjectBundle['panels'],
    bom: arr(raw.bom, 'bom') as ProjectBundle['bom'],
    costs: arr(raw.costs, 'costs') as ProjectBundle['costs'],
    validations: arr(raw.validations, 'validations') as ProjectBundle['validations']
  }
}
