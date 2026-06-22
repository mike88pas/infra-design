/**
 * Most do Pythonowego sidecara geometrii (ezdxf / Shapely / A*).
 *
 * Protokół: newline-delimited JSON przez stdio.
 *   request : { "id": number, "method": string, "params": object }\n
 *   response: { "id": number, "ok": true, "result": any }\n
 *           | { "id": number, "ok": false, "error": string }\n
 *
 * W F0 obsługujemy tylko `ping` (handshake — sidecar zwraca wersję ezdxf).
 * Kolejne metody (importDxf, polygonize, route, export) dochodzą w F1+.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  DxfDocument,
  ExtractDevicesResult,
  ExtractRoomsResult,
  PolygonizeResult
} from '@domain/model/schema'

/** Punkt 2D w jednostkach modelu (parametry trasowania). */
interface Pt {
  x: number
  y: number
}

/** Pojedyncza trasa z route_cables (kontrakt z sidecarem). */
export interface SidecarRouteResult {
  routes: Array<{ sourceIndex: number; targetIndex: number; path: Pt[]; length: number; method: 'astar' | 'straight' }>
  cell: number
  grid: { w: number; h: number }
}

export interface SidecarOptions {
  /** Katalog z kodem sidecara (server.py). */
  scriptDir: string
  /** Polecenie Pythona (domyślnie z env INFRA_PYTHON lub 'python'). */
  python?: string
}

interface Pending {
  resolve: (v: any) => void
  reject: (e: Error) => void
}

export class SidecarBridge {
  private proc: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private buffer = ''
  private readonly python: string
  private readonly scriptPath: string

  constructor(opts: SidecarOptions) {
    this.python = opts.python ?? process.env.INFRA_PYTHON ?? 'python'
    this.scriptPath = join(opts.scriptDir, 'server.py')
  }

  isRunning(): boolean {
    return this.proc !== null
  }

  start(): void {
    if (this.proc) return
    if (!existsSync(this.scriptPath)) {
      throw new Error(`Nie znaleziono sidecara: ${this.scriptPath}`)
    }
    const proc = spawn(this.python, [this.scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.proc = proc

    proc.stdout.setEncoding('utf-8')
    proc.stdout.on('data', (chunk: string) => this.onData(chunk))
    proc.stderr.setEncoding('utf-8')
    proc.stderr.on('data', (chunk: string) => {
      // logi diagnostyczne sidecara — nie mieszają się z protokołem (idą na stderr)
      console.error('[sidecar]', chunk.trimEnd())
    })
    proc.on('exit', (code) => {
      this.proc = null
      const err = new Error(`Sidecar zakończył działanie (kod ${code})`)
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
    })
    proc.on('error', (err) => {
      this.proc = null
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
    })
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line)
        const p = this.pending.get(msg.id)
        if (!p) continue
        this.pending.delete(msg.id)
        if (msg.ok) p.resolve(msg.result)
        else p.reject(new Error(msg.error ?? 'Błąd sidecara'))
      } catch {
        console.error('[sidecar] niepoprawna linia JSON:', line)
      }
    }
  }

  request<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = 15000): Promise<T> {
    if (!this.proc) {
      try {
        this.start()
      } catch (e) {
        return Promise.reject(e as Error)
      }
    }
    const id = this.nextId++
    const payload = JSON.stringify({ id, method, params }) + '\n'
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timeout sidecara dla metody '${method}'`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        }
      })
      this.proc!.stdin.write(payload)
    })
  }

  /** Handshake F0 — sidecar zwraca { pong: true, ezdxf, python }. */
  ping(): Promise<{ pong: boolean; ezdxf: string; python: string }> {
    return this.request('ping')
  }

  /** Import rzutu DXF → warstwy + encje + bbox (timeout dłuższy: ciężkie pliki). */
  importDxf(path: string): Promise<DxfDocument> {
    return this.request('import_dxf', { path }, 120_000)
  }

  /** Wykrycie pomieszczeń z segmentów ścian (Shapely polygonize). */
  polygonize(params: {
    path: string
    wallLayers?: string[]
    explodeBlocks?: boolean
    snap?: number
    minArea?: number
  }): Promise<PolygonizeResult> {
    return this.request('polygonize', params, 120_000)
  }

  /** Ekstrakcja symboli urządzeń (INSERT-y) z warstwą, pozycją i atrybutami. */
  extractDevices(params: {
    path: string
    layers?: string[]
    includeAttribs?: boolean
  }): Promise<ExtractDevicesResult> {
    return this.request('extract_devices', params, 120_000)
  }

  /** Wykaz pomieszczeń z etykiet pól (numer/nazwa/metraż). */
  extractRooms(params: {
    path: string
    areaLayers?: string[]
    explodeBlocks?: boolean
  }): Promise<ExtractRoomsResult> {
    return this.request('extract_rooms', params, 120_000)
  }

  /** Trasowanie kabli A* od urządzeń do najbliższej szafy. */
  routeCables(params: {
    path: string
    sources: Pt[]
    targets: Pt[]
    wallLayers?: string[]
    explodeBlocks?: boolean
    cell?: number
    inflate?: number
  }): Promise<SidecarRouteResult> {
    return this.request('route_cables', params, 180_000)
  }

  stop(): void {
    if (this.proc) {
      this.proc.kill()
      this.proc = null
    }
  }
}
