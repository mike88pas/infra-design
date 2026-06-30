/**
 * Trasowanie kabli na siatce (port logiki sidecara `_route_cables` do TypeScript).
 *
 * Wierny odpowiednik algorytmu z `sidecar/geometry/server.py`, liczony w przeglądarce
 * (web demo nie ma Pythona): rasteryzacja ścian do siatki przeszkód + multi‑source
 * Dijkstra od szaf (celów) jednym przebiegiem, backtracking parent dla każdego urządzenia.
 *
 * Różnica świadoma: domyślnie ruch 4‑sąsiedztwo (poziom/pion) + scalanie współliniowych
 * komórek → trasy mają tylko kąty proste, jak realne koryta kablowe. `diagonal:true`
 * włącza 8‑sąsiedztwo (jak sidecar) na przyszłość.
 *
 * Moduł czysty (bez zależności runtime) — reużywalny w web i desktopie.
 */

import type { Point } from '@domain/model/schema'

export interface Segment {
  a: Point
  b: Point
}

export interface GridBBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface GridRouteOptions {
  /** Maks. liczba komórek na dłuższym boku (jak `_ROUTE_MAX_CELLS_SIDE=220`). */
  maxCells?: number
  /** Pogrubienie ścian w komórkach (trzyma kable z dala od muru). */
  inflate?: number
}

export interface RouteResult {
  /** Polilinia trasy w jednostkach modelu (urządzenie → szafa). */
  path: Point[]
  /** Długość w jednostkach modelu (komórki × rozmiar komórki). */
  length: number
  method: 'grid' | 'straight'
}

/** Liczba slotów kierunku w stanie (0 = brak/seed, 1..4 = +x/-x/+y/-y). */
const DIRS = 5
/** Kara za zmianę kierunku (< koszt kroku 1.0 → długość pozostaje optymalna, turns minimalne). */
const TURN_PENALTY = 0.49
/** Wektory kierunków indeksowane 1..4. */
const DIR_VEC: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
]

/** Min‑heap par (klucz dystansu, indeks komórki). */
class MinHeap {
  private keys: number[] = []
  private vals: number[] = []

  get size(): number {
    return this.vals.length
  }

  push(key: number, val: number): void {
    this.keys.push(key)
    this.vals.push(val)
    let i = this.vals.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.keys[p] <= this.keys[i]) break
      this.swap(i, p)
      i = p
    }
  }

  pop(): number {
    const n = this.vals.length
    const top = this.vals[0]
    const lastKey = this.keys.pop() as number
    const lastVal = this.vals.pop() as number
    if (n > 1) {
      this.keys[0] = lastKey
      this.vals[0] = lastVal
      let i = 0
      const len = this.vals.length
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let s = i
        if (l < len && this.keys[l] < this.keys[s]) s = l
        if (r < len && this.keys[r] < this.keys[s]) s = r
        if (s === i) break
        this.swap(i, s)
        i = s
      }
    }
    return top
  }

  private swap(i: number, j: number): void {
    const k = this.keys[i]
    this.keys[i] = this.keys[j]
    this.keys[j] = k
    const v = this.vals[i]
    this.vals[i] = this.vals[j]
    this.vals[j] = v
  }
}

/**
 * Router siatkowy: buduje siatkę z bbox + ścian, liczy Dijkstrę od `seeds` (szaf),
 * a `routeFrom(p)` zwraca trasę z urządzenia do najbliższej szafy.
 */
export class GridRouter {
  readonly cell: number
  readonly w: number
  readonly h: number
  private readonly minX: number
  private readonly minY: number
  private readonly blocked: Uint8Array
  private readonly dist: Float32Array
  private readonly parent: Int32Array
  private readonly seeds: Point[]

  constructor(bbox: GridBBox, segments: Segment[], seeds: Point[], opts: GridRouteOptions = {}) {
    const maxCells = opts.maxCells ?? 220
    const inflate = opts.inflate ?? 1
    this.seeds = seeds

    const width = Math.max(1e-6, bbox.maxX - bbox.minX)
    const height = Math.max(1e-6, bbox.maxY - bbox.minY)
    this.cell = Math.max(width, height) / maxCells
    this.minX = bbox.minX
    this.minY = bbox.minY
    this.w = Math.floor(width / this.cell) + 2
    this.h = Math.floor(height / this.cell) + 2

    this.blocked = new Uint8Array(this.w * this.h)
    this.rasterize(segments, inflate)

    // Stan = komórka × kierunek (0=brak/seed, 1..4 = +x/-x/+y/-y). Kara za zakręt
    // wymusza minimalną liczbę załamań (czyste L/Z zamiast schodków na siatce).
    this.dist = new Float32Array(this.w * this.h * DIRS).fill(Infinity)
    this.parent = new Int32Array(this.w * this.h * DIRS).fill(-1)
    this.dijkstra(seeds)
  }

  private cellX(x: number): number {
    return Math.min(this.w - 1, Math.max(0, Math.floor((x - this.minX) / this.cell)))
  }

  private cellY(y: number): number {
    return Math.min(this.h - 1, Math.max(0, Math.floor((y - this.minY) / this.cell)))
  }

  private idxOf(cx: number, cy: number): number {
    return cy * this.w + cx
  }

  /** Środek komórki w jednostkach modelu. */
  private pointOf(idx: number): Point {
    const cx = idx % this.w
    const cy = Math.floor(idx / this.w)
    return { x: this.minX + (cx + 0.5) * this.cell, y: this.minY + (cy + 0.5) * this.cell }
  }

  /** Rasteryzacja segmentów ścian → komórki blocked (+ inflate). */
  private rasterize(segments: Segment[], inflate: number): void {
    for (const s of segments) {
      const ax = s.a.x
      const ay = s.a.y
      const bx = s.b.x
      const by = s.b.y
      const steps = Math.max(1, Math.ceil((Math.abs(bx - ax) + Math.abs(by - ay)) / this.cell))
      for (let i = 0; i <= steps; i++) {
        const t = i / steps
        const cx = this.cellX(ax + (bx - ax) * t)
        const cy = this.cellY(ay + (by - ay) * t)
        this.blocked[this.idxOf(cx, cy)] = 1
      }
    }
    if (inflate > 0) {
      const base: number[] = []
      for (let i = 0; i < this.blocked.length; i++) if (this.blocked[i]) base.push(i)
      for (const i of base) {
        const cx = i % this.w
        const cy = Math.floor(i / this.w)
        for (let dx = -inflate; dx <= inflate; dx++) {
          for (let dy = -inflate; dy <= inflate; dy++) {
            const nx = cx + dx
            const ny = cy + dy
            if (nx >= 0 && nx < this.w && ny >= 0 && ny < this.h) this.blocked[this.idxOf(nx, ny)] = 1
          }
        }
      }
    }
  }

  /** Czy punkt (i otoczka `margin` komórek) jest wolny — do bezpiecznego rozsuwu tras. */
  isFree(p: Point, margin = 0): boolean {
    const cx = this.cellX(p.x)
    const cy = this.cellY(p.y)
    for (let dx = -margin; dx <= margin; dx++) {
      for (let dy = -margin; dy <= margin; dy++) {
        const nx = cx + dx
        const ny = cy + dy
        if (nx < 0 || nx >= this.w || ny < 0 || ny >= this.h) return false
        if (this.blocked[this.idxOf(nx, ny)]) return false
      }
    }
    return true
  }

  /** Najbliższa wolna komórka (BFS w kwadratach r=1..maxR), gdy źródło pada na ścianę. */
  private nearestFree(cx: number, cy: number, maxR = 8): number {
    if (cx >= 0 && cx < this.w && cy >= 0 && cy < this.h && !this.blocked[this.idxOf(cx, cy)]) {
      return this.idxOf(cx, cy)
    }
    for (let r = 1; r <= maxR; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx >= 0 && nx < this.w && ny >= 0 && ny < this.h && !this.blocked[this.idxOf(nx, ny)]) {
            return this.idxOf(nx, ny)
          }
        }
      }
    }
    return -1
  }

  /**
   * Multi‑source Dijkstra od wszystkich szaf naraz, w przestrzeni stanów
   * (komórka × kierunek) z karą za zakręt → trasy o minimalnej liczbie załamań.
   */
  private dijkstra(seeds: Point[]): void {
    const heap = new MinHeap()
    for (const s of seeds) {
      const seed = this.nearestFree(this.cellX(s.x), this.cellY(s.y))
      if (seed >= 0) {
        const st = seed * DIRS // dir=0 (brak): pierwszy ruch bez kary
        if (this.dist[st] > 0) {
          this.dist[st] = 0
          heap.push(0, st)
        }
      }
    }

    while (heap.size > 0) {
      const cur = heap.pop()
      const d = this.dist[cur]
      const cell = Math.floor(cur / DIRS)
      const dir = cur % DIRS
      const cx = cell % this.w
      const cy = Math.floor(cell / this.w)
      for (let m = 1; m <= 4; m++) {
        const [dx, dy] = DIR_VEC[m]
        const nx = cx + dx
        const ny = cy + dy
        if (nx < 0 || nx >= this.w || ny < 0 || ny >= this.h) continue
        const ni = this.idxOf(nx, ny)
        if (this.blocked[ni]) continue
        const nd = d + 1 + (dir !== 0 && m !== dir ? TURN_PENALTY : 0)
        const ns = ni * DIRS + m
        if (nd < this.dist[ns]) {
          this.dist[ns] = nd
          this.parent[ns] = cur
          heap.push(nd, ns)
        }
      }
    }
  }

  /** Trasa z punktu `p` do najbliższej szafy (po siatce, omijając ściany). */
  routeFrom(p: Point): RouteResult {
    const start = this.nearestFree(this.cellX(p.x), this.cellY(p.y))
    if (start < 0) return this.straightFallback(p)
    // Najlepszy stan w komórce startowej (po wszystkich kierunkach).
    let bestState = -1
    let bestD = Infinity
    for (let d = 0; d < DIRS; d++) {
      const st = start * DIRS + d
      if (this.dist[st] < bestD) {
        bestD = this.dist[st]
        bestState = st
      }
    }
    if (bestState < 0 || !Number.isFinite(bestD)) return this.straightFallback(p)

    // Backtrack stanów: start (urządzenie) → … → seed (szafa); zbierz komórki.
    const cells: number[] = []
    let cur = bestState
    let guard = this.w * this.h * DIRS
    cells.push(Math.floor(cur / DIRS))
    while (this.parent[cur] !== -1 && guard-- > 0) {
      cur = this.parent[cur]
      const cell = Math.floor(cur / DIRS)
      if (cell !== cells[cells.length - 1]) cells.push(cell)
    }
    const path = this.simplifyOrtho(cells).map((i) => this.pointOf(i))
    let length = 0
    for (let i = 0; i < path.length - 1; i++) {
      length += Math.abs(path[i + 1].x - path[i].x) + Math.abs(path[i + 1].y - path[i].y)
    }
    return { path, length, method: 'grid' }
  }

  /** Brak przejścia: prosta do najbliższej szafy (jak fallback sidecara). */
  private straightFallback(p: Point): RouteResult {
    let best = this.seeds[0]
    let bestD = Infinity
    for (const s of this.seeds) {
      const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    return { path: [p, best], length: Math.sqrt(bestD), method: 'straight' }
  }

  /** Scala współliniowe komórki w runy → polilinia tylko z załamaniami 90°. */
  private simplifyOrtho(cells: number[]): number[] {
    if (cells.length <= 2) return cells
    const kept: number[] = [cells[0]]
    for (let i = 1; i < cells.length - 1; i++) {
      const prev = kept[kept.length - 1]
      const cur = cells[i]
      const next = cells[i + 1]
      const dirA = this.dir(prev, cur)
      const dirB = this.dir(cur, next)
      if (dirA[0] !== dirB[0] || dirA[1] !== dirB[1]) kept.push(cur)
    }
    kept.push(cells[cells.length - 1])
    return kept
  }

  private dir(from: number, to: number): [number, number] {
    const fx = from % this.w
    const fy = Math.floor(from / this.w)
    const tx = to % this.w
    const ty = Math.floor(to / this.w)
    return [Math.sign(tx - fx), Math.sign(ty - fy)]
  }
}

/** Czy odcinki p1p2 i p3p4 się przecinają (do testów: trasa vs ściana). */
export function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d = (a: Point, b: Point, c: Point): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const d1 = d(p3, p4, p1)
  const d2 = d(p3, p4, p2)
  const d3 = d(p1, p2, p3)
  const d4 = d(p1, p2, p4)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  return false
}
