/**
 * CadScene — platform-agnostyczny renderer rzutu (PixiJS v8 + RBush).
 *
 * Rdzeń CAD nie wie nic o Electronie ani o instalacjach: dostaje czyste dane
 * (DxfDocument + wykryte pomieszczenia) i renderuje je w WebGL. Ten sam kod
 * napędza aplikację desktop (dane z sidecara) oraz webowe demo (dane zapieczone
 * do JSON). Współrzędne wejściowe to jednostki modelu DXF (Y w górę).
 *
 * Cechy F1:
 *   - rysowanie encji pogrupowane per warstwa (batch + przełączanie widoczności),
 *   - pan/zoom (zoom do kursora), dopasowanie do widoku (fit),
 *   - RBush: indeks przestrzenny pomieszczeń → hit-test pod kursorem,
 *   - LOD: ukrywanie tekstu DXF poniżej progu czytelności przy oddaleniu,
 *   - etykiety pomieszczeń o stałym rozmiarze ekranowym (counter-scale).
 */

import { Application, Container, Graphics, Text } from 'pixi.js'
import RBush from 'rbush'
import type { BBox, DxfDocument, DxfEntity, Point } from '@domain/model/schema'

const DEG2RAD = Math.PI / 180

/** Pomieszczenie w formie renderowalnej (po nadaniu Id z polygonize). */
export interface RenderSpace {
  id: string
  name: string
  polygon: Point[]
  area: number
}

export interface CadSceneOptions {
  /** Kolor tła (hex liczbowy). */
  background?: number
  /** Callback najechania na pomieszczenie (null = zejście z obszaru). */
  onHoverSpace?: (space: RenderSpace | null) => void
}

interface SpaceIndexNode {
  minX: number
  minY: number
  maxX: number
  maxY: number
  space: RenderSpace
}

/** Próg widoczności tekstu DXF: ukryj gdy wysokość < tylu px na ekranie. */
const TEXT_MIN_PX = 6

export class CadScene {
  private app: Application
  private world = new Container() // świat transformowany (pan/zoom)
  private layerContainers = new Map<string, Container>()
  private textContainer = new Container()
  private spacesContainer = new Container()
  private spaceLabels: Text[] = []
  private highlight = new Graphics()
  private spaceIndex = new RBush<SpaceIndexNode>()

  private scale = 1
  private tx = 0
  private ty = 0
  private bbox: BBox = { minX: 0, minY: 0, maxX: 1, maxY: 1 }
  private hovered: RenderSpace | null = null
  private dragging = false
  private lastPointer = { x: 0, y: 0 }
  private measureMode = false
  private measureA: Point | null = null
  private measureGfx = new Graphics()
  private onMeasure: ((modelDist: number, a: Point, b: Point) => void) | null = null
  private resizeObs: ResizeObserver | null = null
  private readonly opts: CadSceneOptions

  constructor(opts: CadSceneOptions = {}) {
    this.opts = opts
    this.app = new Application()
  }

  /** Inicjalizacja WebGL i podpięcie do kontenera DOM. */
  async mount(parent: HTMLElement): Promise<void> {
    await this.app.init({
      background: this.opts.background ?? 0x0b1220,
      antialias: true,
      resizeTo: parent,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1
    })
    parent.appendChild(this.app.canvas)

    this.world.addChild(this.spacesContainer)
    this.world.addChild(this.highlight)
    this.world.addChild(this.textContainer)
    this.world.addChild(this.measureGfx)
    this.app.stage.addChild(this.world)

    this.bindInteractions()
    this.resizeObs = new ResizeObserver(() => this.applyTransform())
    this.resizeObs.observe(parent)
  }

  /** Wczytuje rysunek + pomieszczenia i dopasowuje widok. */
  load(doc: DxfDocument, spaces: RenderSpace[]): void {
    this.clear()
    this.bbox = doc.bbox

    // Szerokość linii w jednostkach świata (stała px wymagałaby przerysowań —
    // dobieramy względem rozmiaru rysunku, co daje czysty wygląd w pełnym zoomie).
    const diag = Math.hypot(doc.bbox.maxX - doc.bbox.minX, doc.bbox.maxY - doc.bbox.minY) || 1
    const lw = diag * 0.0006

    const colorByLayer = new Map(doc.layers.map((l) => [l.name, this.hex(l.color)]))
    const visByLayer = new Map(doc.layers.map((l) => [l.name, l.visible]))

    // Jedna Graphics na warstwę (batch) — poza tekstem.
    const layerGfx = new Map<string, Graphics>()
    const gfxFor = (layer: string): Graphics => {
      let g = layerGfx.get(layer)
      if (!g) {
        g = new Graphics()
        layerGfx.set(layer, g)
        const c = new Container()
        c.addChild(g)
        c.visible = visByLayer.get(layer) ?? true
        this.layerContainers.set(layer, c)
        // warstwy pod pomieszczeniami? nie — geometria na wierzchu wypełnień
        this.world.addChildAt(c, this.world.getChildIndex(this.textContainer))
      }
      return g
    }

    for (const e of doc.entities) {
      const color = colorByLayer.get(e.layer) ?? 0xc8c8c8
      if (e.t === 'text') {
        this.addText(e, color)
      } else {
        this.drawEntity(gfxFor(e.layer), e, color, lw)
      }
    }

    // Pomieszczenia: wypełnienie + obrys + etykieta o stałym rozmiarze.
    const idxNodes: SpaceIndexNode[] = []
    for (const s of spaces) {
      if (s.polygon.length < 3) continue
      const g = new Graphics()
      const flat = s.polygon.map((p) => ({ x: p.x, y: p.y }))
      g.poly(flat).fill({ color: 0x38bdf8, alpha: 0.08 }).stroke({ width: lw * 1.5, color: 0x38bdf8, alpha: 0.5 })
      this.spacesContainer.addChild(g)

      const c = centroid(s.polygon)
      const areaM2 = s.area / 1_000_000 // mm² → m² (model w mm)
      const label = new Text({
        text: `${s.name}\n${areaM2.toFixed(1)} m²`,
        style: { fontFamily: 'sans-serif', fontSize: 14, fill: 0xe2e8f0, align: 'center' }
      })
      label.anchor.set(0.5)
      label.position.set(c.x, c.y)
      this.spaceLabels.push(label)
      this.spacesContainer.addChild(label)

      const b = bboxOf(s.polygon)
      idxNodes.push({ minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY, space: s })
    }
    this.spaceIndex.clear()
    this.spaceIndex.load(idxNodes)

    this.fit()
  }

  /** Lista warstw aktualnie wczytanych (do panelu UI). */
  layerNames(): string[] {
    return [...this.layerContainers.keys()]
  }

  setLayerVisible(name: string, visible: boolean): void {
    const c = this.layerContainers.get(name)
    if (c) c.visible = visible
    // tekst DXF jest w osobnym kontenerze keyowanym per encja-warstwa — patrz addText
    const tc = this.layerContainers.get(`text:${name}`)
    if (tc) tc.visible = visible
  }

  /** Dopasowanie rysunku do widoku (margines 8%). */
  fit(): void {
    // screen = wymiary LOGICZNE (CSS px) — spójne z mapowaniem kursora;
    // renderer.width/height byłyby fizyczne (×devicePixelRatio) → przesunięcie na hi-DPI.
    const { width, height } = this.app.renderer.screen
    const bw = this.bbox.maxX - this.bbox.minX || 1
    const bh = this.bbox.maxY - this.bbox.minY || 1
    const s = Math.min(width / bw, height / bh) * 0.92
    this.scale = s
    const cx = (this.bbox.minX + this.bbox.maxX) / 2
    const cy = (this.bbox.minY + this.bbox.maxY) / 2
    this.tx = width / 2 - s * cx
    this.ty = height / 2 + s * cy // Y odwrócone
    this.applyTransform()
  }

  /**
   * Tryb kalibracji skali: użytkownik klika dwa punkty; po drugim kliknięciu
   * dostajesz odległość w jednostkach modelu (UI dzieli realny wymiar przez nią).
   */
  startMeasure(onComplete: (modelDist: number, a: Point, b: Point) => void): void {
    this.measureMode = true
    this.measureA = null
    this.onMeasure = onComplete
    this.measureGfx.clear()
  }

  cancelMeasure(): void {
    this.measureMode = false
    this.measureA = null
    this.onMeasure = null
    this.measureGfx.clear()
  }

  destroy(): void {
    this.resizeObs?.disconnect()
    this.app.destroy(true, { children: true })
  }

  // ── rysowanie encji ──────────────────────────────────────────────────────

  private drawEntity(g: Graphics, e: DxfEntity, color: number, lw: number): void {
    switch (e.t) {
      case 'line':
        g.moveTo(e.a.x, e.a.y).lineTo(e.b.x, e.b.y).stroke({ width: lw, color })
        break
      case 'polyline': {
        if (!e.pts.length) break
        g.moveTo(e.pts[0].x, e.pts[0].y)
        for (let i = 1; i < e.pts.length; i++) g.lineTo(e.pts[i].x, e.pts[i].y)
        if (e.closed) g.closePath()
        g.stroke({ width: lw, color })
        break
      }
      case 'circle':
        g.circle(e.c.x, e.c.y, e.r).stroke({ width: lw, color })
        break
      case 'arc':
        g.arc(e.c.x, e.c.y, e.r, e.start * DEG2RAD, e.end * DEG2RAD).stroke({ width: lw, color })
        break
      case 'insert':
        // F1: blok jako marker (rozwinięcie wstawień dochodzi później)
        g.circle(e.at.x, e.at.y, lw * 4).stroke({ width: lw, color })
        break
    }
  }

  private addText(e: Extract<DxfEntity, { t: 'text' }>, color: number): void {
    const key = `text:${e.layer}`
    let c = this.layerContainers.get(key)
    if (!c) {
      c = new Container()
      this.layerContainers.set(key, c)
      this.textContainer.addChild(c)
    }
    const t = new Text({
      text: e.text,
      style: { fontFamily: 'sans-serif', fontSize: Math.max(e.height || 1, 1), fill: color }
    })
    t.scale.set(1, -1) // świat ma odwrócone Y — odwracamy tekst z powrotem
    t.position.set(e.at.x, e.at.y)
    c.addChild(t)
  }

  // ── interakcje: pan/zoom/hover ─────────────────────────────────────────────

  private bindInteractions(): void {
    const canvas = this.app.canvas
    canvas.addEventListener('wheel', (ev) => this.onWheel(ev), { passive: false })
    canvas.addEventListener('pointerdown', (ev) => this.onPointerDown(ev))
    canvas.addEventListener('pointermove', (ev) => this.onPointerMove(ev))
    canvas.addEventListener('pointerup', () => (this.dragging = false))
    canvas.addEventListener('pointerleave', () => {
      this.dragging = false
      this.setHover(null)
    })
  }

  private onWheel(ev: WheelEvent): void {
    ev.preventDefault()
    const rect = this.app.canvas.getBoundingClientRect()
    const sx = ev.clientX - rect.left
    const sy = ev.clientY - rect.top
    const wx = (sx - this.tx) / this.scale
    const wy = (this.ty - sy) / this.scale
    const factor = Math.exp(-ev.deltaY * 0.0015)
    const next = clamp(this.scale * factor, 1e-6, 1e6)
    this.scale = next
    this.tx = sx - next * wx
    this.ty = sy + next * wy
    this.applyTransform()
  }

  private onPointerDown(ev: PointerEvent): void {
    if (this.measureMode) {
      const rect = this.app.canvas.getBoundingClientRect()
      const w = {
        x: (ev.clientX - rect.left - this.tx) / this.scale,
        y: (this.ty - (ev.clientY - rect.top)) / this.scale
      }
      if (!this.measureA) {
        this.measureA = w
        this.measureGfx.clear().circle(w.x, w.y, 2 / this.scale).fill({ color: 0xfbbf24 })
      } else {
        const a = this.measureA
        const dist = Math.hypot(w.x - a.x, w.y - a.y)
        this.measureGfx
          .clear()
          .moveTo(a.x, a.y)
          .lineTo(w.x, w.y)
          .stroke({ width: 1.5 / this.scale, color: 0xfbbf24 })
        const cb = this.onMeasure
        this.cancelMeasure()
        cb?.(dist, a, w)
      }
      return
    }
    this.dragging = true
    this.lastPointer = { x: ev.clientX, y: ev.clientY }
  }

  private onPointerMove(ev: PointerEvent): void {
    if (this.dragging) {
      this.tx += ev.clientX - this.lastPointer.x
      this.ty += ev.clientY - this.lastPointer.y
      this.lastPointer = { x: ev.clientX, y: ev.clientY }
      this.applyTransform()
      return
    }
    if (!this.opts.onHoverSpace) return
    const rect = this.app.canvas.getBoundingClientRect()
    const wx = (ev.clientX - rect.left - this.tx) / this.scale
    const wy = (this.ty - (ev.clientY - rect.top)) / this.scale
    const hits = this.spaceIndex.search({ minX: wx, minY: wy, maxX: wx, maxY: wy })
    const found = hits.find((h) => pointInPolygon({ x: wx, y: wy }, h.space.polygon))?.space ?? null
    this.setHover(found)
  }

  private setHover(space: RenderSpace | null): void {
    if (space === this.hovered) return
    this.hovered = space
    this.highlight.clear()
    if (space) {
      this.highlight
        .poly(space.polygon.map((p) => ({ x: p.x, y: p.y })))
        .fill({ color: 0x38bdf8, alpha: 0.18 })
    }
    this.opts.onHoverSpace?.(space)
  }

  // ── transformacja świata + LOD + counter-scale etykiet ─────────────────────

  private applyTransform(): void {
    this.world.position.set(this.tx, this.ty)
    this.world.scale.set(this.scale, -this.scale)

    // Etykiety pomieszczeń: stały rozmiar ekranowy (kompensacja skali świata).
    const k = 1 / this.scale
    for (const lbl of this.spaceLabels) lbl.scale.set(k, -k)

    // LOD: ukryj tekst DXF gdy zbyt drobny by go czytać.
    for (const [key, c] of this.layerContainers) {
      if (!key.startsWith('text:')) continue
      const first = c.children[0] as Text | undefined
      if (!first) continue
      const px = (first.style.fontSize as number) * this.scale
      c.renderable = px >= TEXT_MIN_PX
    }
  }

  private clear(): void {
    for (const c of this.layerContainers.values()) c.destroy({ children: true })
    this.layerContainers.clear()
    this.spacesContainer.removeChildren().forEach((c) => c.destroy())
    this.textContainer.removeChildren().forEach((c) => c.destroy())
    this.spaceLabels = []
    this.highlight.clear()
    this.spaceIndex.clear()
    this.hovered = null
  }

  private hex(color: string): number {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(color)
    return m ? parseInt(m[1], 16) : 0xc8c8c8
  }
}

// ── pomocnicze geometryczne ──────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function centroid(poly: Point[]): Point {
  let x = 0
  let y = 0
  for (const p of poly) {
    x += p.x
    y += p.y
  }
  return { x: x / poly.length, y: y / poly.length }
}

function bboxOf(poly: Point[]): BBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of poly) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

function pointInPolygon(pt: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}
