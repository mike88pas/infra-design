/**
 * Infra Design — rdzeniowy model danych (kontrakt współdzielony front ↔ sidecar).
 *
 * Jedno źródło prawdy dla encji projektu. Każda paczka `.infra` zapisuje numer
 * `SCHEMA_VERSION`, na którym była utworzona — migracje i testy kontraktowe IPC
 * opierają się na tym numerze, żeby uniknąć rozjazdu TS ↔ Python.
 *
 * Warstwy:
 *   - GENERIC CAD CORE — pojęcia niezależne od instalacji (Project/Drawing/Layer/Space).
 *   - WERTYKAŁA INSTALACJE — Device/CableRoute/Tray/Circuit/Rack/Panel.
 *   - ZESTAWIENIA/KOSZTY — BomItem/CostItem.
 *   - NORMY/PRAWO — NormRule/Designer/ValidationResult.
 */

/** Wersja schematu paczki `.infra`. Bumpować przy każdej zmianie łamiącej zgodność. */
export const SCHEMA_VERSION = 1 as const

// ──────────────────────────────────────────────────────────────────────────
// Typy bazowe / geometria
// ──────────────────────────────────────────────────────────────────────────

export type Id = string

export interface Point {
  x: number
  y: number
}

export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Macierz afiniczna 2D (kalibracja skali/orientacji rzutu): [a, b, c, d, e, f]. */
export type Matrix2D = [number, number, number, number, number, number]

export const IDENTITY_MATRIX: Matrix2D = [1, 0, 0, 1, 0, 0]

/** Klucze obsługiwanych systemów instalacji (pilot: lan + cctv). */
export type SystemKey =
  | 'lan'
  | 'cctv'
  | 'sap'
  | 'dso'
  | 'sswin'
  | 'kd'
  | 'elec'
  | 'tray'
  | 'bms'

/** Klucz wertykały — pierwszą jest 'installations', później 'interior'/'architecture'. */
export type VerticalKey = 'installations' | 'interior' | 'architecture'

export type Units = 'mm' | 'm'

// ──────────────────────────────────────────────────────────────────────────
// GENERIC CAD CORE
// ──────────────────────────────────────────────────────────────────────────

export interface Designer {
  id: Id
  fullName: string
  /** Numer uprawnień budowlanych do projektowania. */
  licenseNo: string
  /** Specjalność (np. instalacyjna w zakresie sieci/instalacji elektrycznych). */
  specialty: string
  /** Okręgowa izba (PIIB). */
  chamber: string
  /** Software NIGDY nie podpisuje projektu — dokument ma jedynie miejsce na podpis. */
  signaturePlaceholder: true
}

export interface Layer {
  id: Id
  name: string
  visible: boolean
  locked: boolean
  color: string
  /** Jeśli warstwa należy do konkretnego systemu instalacji. */
  system?: SystemKey
}

export interface Space {
  id: Id
  drawingId: Id
  name: string
  /** Obrys pomieszczenia (z Shapely polygonize lub korekty ręcznej). */
  polygon: Point[]
  area: number
  height?: number
  /** Typ pomieszczenia wpływa na reguły (DORI, klasy, dobór urządzeń). */
  type?: string
}

export interface Drawing {
  id: Id
  projectId: Id
  name: string
  /** Numer kondygnacji. */
  level: number
  /** Ścieżka do oryginalnego DXF wewnątrz paczki. */
  sourceDxfRef: string
  layers: Layer[]
  /** Kalibracja skali/orientacji. */
  transform: Matrix2D
  bbox: BBox
}

export interface Project {
  id: Id
  name: string
  client: string
  units: Units
  createdAt: string
  updatedAt: string
  designerId: Id | null
  /** Aktywne wertykały (na start tylko 'installations'). */
  activeVerticals: VerticalKey[]
  /** Aktywne systemy instalacji w projekcie. */
  activeSystems: SystemKey[]
  schemaVersion: number
}

// ──────────────────────────────────────────────────────────────────────────
// IMPORT DXF (transport sidecar → front) — geometria do renderowania
// ──────────────────────────────────────────────────────────────────────────
//
// To NIE są encje persystowane w paczce `.infra` (te trzyma Drawing + osadzony
// DXF w sourceDxfRef). To lekki, renderowalny zrzut z ezdxf: tagowana unia encji
// w jednostkach modelu DXF. Renderer (src/core/cad) i sidecar dzielą ten kontrakt.

/** Encja DXF spłaszczona do renderowania (kąty łuków w stopniach, CCW). */
export type DxfEntity =
  | { t: 'line'; layer: string; a: Point; b: Point }
  | { t: 'polyline'; layer: string; pts: Point[]; closed: boolean }
  | { t: 'circle'; layer: string; c: Point; r: number }
  | { t: 'arc'; layer: string; c: Point; r: number; start: number; end: number }
  | { t: 'insert'; layer: string; at: Point; name: string; rotation: number; sx: number; sy: number }
  | { t: 'text'; layer: string; at: Point; text: string; height: number }

export interface DxfLayer {
  name: string
  /** Kolor warstwy jako hex (#rrggbb) — z indeksu ACI lub true-color DXF. */
  color: string
  visible: boolean
}

/** Wynik metody sidecara `import_dxf`. */
export interface DxfDocument {
  layers: DxfLayer[]
  entities: DxfEntity[]
  bbox: BBox
  units: Units
  /** Liczba encji (także po ewentualnym przycięciu dużych plików). */
  entityCount: number
  /** Jeśli sidecar przyciął encje (ochrona pamięci) — ile pominięto. */
  truncated?: number
}

/** Pojedynczy wykryty wielobok pomieszczenia (przed nadaniem Id po stronie TS). */
export interface DetectedPolygon {
  points: Point[]
  area: number
}

/** Wynik metody sidecara `polygonize` — surowe wieloboki (TS → Space[]). */
export interface PolygonizeResult {
  polygons: DetectedPolygon[]
  /** Tolerancja snapowania użyta do domknięcia narożników (jedn. modelu). */
  snapTolerance: number
}

/**
 * Symbol urządzenia z DXF (blok INSERT z modelspace) — transport z sidecara
 * (`extract_devices`). Symbole bywają blokami anonimowymi (*U34), więc system/typ
 * klasyfikujemy po WARSTWIE (src/domain/dxf/systemMapping.ts), nie po nazwie bloku.
 */
export interface DxfInsert {
  layer: string
  name: string
  at: Point
  rotation: number
  sx: number
  sy: number
  /** Atrybuty bloku (ATTRIB), np. { IDFX: 'PPD1.1/X1/', NR: '12' } → props urządzenia. */
  attribs: Record<string, string>
}

/** Wynik metody sidecara `extract_devices`. */
export interface ExtractDevicesResult {
  inserts: DxfInsert[]
  count: number
}

// ──────────────────────────────────────────────────────────────────────────
// WERTYKAŁA: INSTALACJE
// ──────────────────────────────────────────────────────────────────────────

export interface PortRef {
  deviceId: Id
  port: string
}

export interface Device {
  id: Id
  drawingId: Id
  spaceId?: Id
  system: SystemKey
  /** Klucz typu urządzenia, np. 'cctv.dome.4mp', 'lan.outlet.2x', 'sap.detector.smoke'. */
  typeKey: string
  position: Point
  rotation: number
  /** Parametry zależne od typu (IP, FOV, doriTarget, grade, …). */
  props: Record<string, unknown>
  /** Odwołanie do konkretnego produktu w katalogu (CNBOP itd.). */
  catalogRef?: Id
  connections: PortRef[]
}

export interface Tray {
  id: Id
  drawingId: Id
  path: Point[]
  type: string
  widthMm: number
  /** Wynik kalkulacji wypełnienia (PN-EN 61537). */
  fillPercent?: number
  level: number
}

export interface CableRoute {
  id: Id
  system: SystemKey
  /** Geometria trasy (po auto-routingu A* lub korekcie ręcznej). */
  path: Point[]
  trayId?: Id
  cableType: string
  /** Długość liczona z `path`. */
  length: number
  from: PortRef
  to: PortRef
}

export interface Circuit {
  id: Id
  name: string
  phase: string
  breaker: string
  conductorMm2: number
  lengthM: number
  loadW: number
  /** Wynik kalkulacji spadku napięć (PN-HD 60364-5-52). */
  voltageDropPct?: number
  panelId: Id
  devices: Id[]
}

export interface RackUnit {
  uPos: number
  uSize: number
  deviceId?: Id
  label: string
}

export interface Rack {
  id: Id
  name: string
  uHeight: number
  units: RackUnit[]
}

export interface Panel {
  id: Id
  name: string
  circuits: Id[]
  schematicRef?: string
}

// ──────────────────────────────────────────────────────────────────────────
// ZESTAWIENIA / KOSZTY
// ──────────────────────────────────────────────────────────────────────────

export interface BomItem {
  id: Id
  catalogRef?: Id
  description: string
  qty: number
  unit: string
  system: SystemKey
  /** Encje, z których zagregowano pozycję (devices/routes). */
  sourceRefs: Id[]
}

export interface CostItem {
  id: Id
  bomItemId?: Id
  /** Kod KNR (np. KNR 5-08, KNR EM-01). */
  knrCode?: string
  description: string
  qty: number
  unit: string
  laborNorm?: number
  materialPrice?: number
  laborPrice?: number
  total: number
}

// ──────────────────────────────────────────────────────────────────────────
// NORMY / WALIDACJA
// ──────────────────────────────────────────────────────────────────────────

export type Severity = 'error' | 'warn' | 'info'

/** Cel reguły — do jakiego rodzaju encji się stosuje. */
export type RuleTarget = 'device' | 'route' | 'circuit' | 'space' | 'tray' | 'project'

export interface NormRule {
  id: Id
  /** Oznaczenie normy, np. 'PN-EN 62676'. */
  norm: string
  /** Wersja/wydanie RuleSetu (audytowalność walidacji). */
  version: string
  system: SystemKey
  appliesTo: RuleTarget
  severity: Severity
  /** Predykat w mini-DSL (AST JSON) — patrz silnik norm. */
  predicate: RuleExpr
  message: string
  /** Punkt normy do dokumentu audytu. */
  reference: string
}

export interface ValidationResult {
  ruleId: Id
  targetId: Id
  status: 'pass' | 'fail'
  severity: Severity
  message: string
  reference: string
  /** Świadome odstępstwo projektanta z uzasadnieniem (zapisywane do projektu). */
  override?: { by: Id; reason: string; at: string }
}

// ──────────────────────────────────────────────────────────────────────────
// Mini-DSL reguł (deklaratywny, ewaluowany BEZ eval)
// ──────────────────────────────────────────────────────────────────────────

/**
 * RuleExpr — AST wyrażenia reguły. Interpreter (src/domain/norms/engine.ts)
 * ewaluuje to bezpiecznie, bez `eval`. Funkcje (`dori`, `voltageDrop`, …)
 * pochodzą z CalculatorRegistry.
 */
export type RuleExpr =
  | { kind: 'const'; value: number | string | boolean }
  | { kind: 'field'; path: string } // np. 'device.props.doriTarget'
  | { kind: 'call'; fn: string; args: RuleExpr[] } // np. dori(device, space)
  | { kind: 'cmp'; op: '>=' | '<=' | '>' | '<' | '==' | '!='; left: RuleExpr; right: RuleExpr }
  | { kind: 'and'; items: RuleExpr[] }
  | { kind: 'or'; items: RuleExpr[] }
  | { kind: 'not'; item: RuleExpr }

// ──────────────────────────────────────────────────────────────────────────
// Agregat projektu (to, co serializujemy do/z paczki `.infra`)
// ──────────────────────────────────────────────────────────────────────────

export interface ProjectBundle {
  project: Project
  designers: Designer[]
  drawings: Drawing[]
  spaces: Space[]
  devices: Device[]
  trays: Tray[]
  routes: CableRoute[]
  circuits: Circuit[]
  racks: Rack[]
  panels: Panel[]
  bom: BomItem[]
  costs: CostItem[]
  validations: ValidationResult[]
}

/** Tworzy pusty, poprawny projekt (used przez F0 „nowy projekt"). */
export function createEmptyProject(params: { id: Id; name: string; client?: string; now: string }): Project {
  return {
    id: params.id,
    name: params.name,
    client: params.client ?? '',
    units: 'mm',
    createdAt: params.now,
    updatedAt: params.now,
    designerId: null,
    activeVerticals: ['installations'],
    activeSystems: ['lan', 'cctv'],
    schemaVersion: SCHEMA_VERSION
  }
}

export function createEmptyBundle(project: Project): ProjectBundle {
  return {
    project,
    designers: [],
    drawings: [],
    spaces: [],
    devices: [],
    trays: [],
    routes: [],
    circuits: [],
    racks: [],
    panels: [],
    bom: [],
    costs: [],
    validations: []
  }
}
