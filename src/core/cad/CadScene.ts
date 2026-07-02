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

// CSP desktopu (script-src 'self', bez 'unsafe-eval') blokuje domyślny PixiJS (używa eval/
// new Function przy syncu uniformów/shaderów) → renderer pada, czarny ekran. Ten moduł
// podmienia te ścieżki na polyfille bez eval (self-install przy imporcie). MUSI być przed
// pierwszym użyciem Application.
import 'pixi.js/unsafe-eval'
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

/** Urządzenie do narysowania na rzucie (symbol per system/typ). */
export interface RenderDevice {
  id: string
  system: string
  typeKey: string
  position: Point
  rotation: number
  /** Opcjonalny podpis nad symbolem (np. „IDF" przy szafie). */
  label?: string
}

/** Trasa kablowa do narysowania (polilinia). */
export interface RenderRoute {
  id: string
  system: string
  path: Point[]
}

/** Strefy pokrycia kamery (DORI) — wieloboki od najszerszej do najwęższej. */
export interface RenderCoverage {
  deviceId: string
  /** System (filtry widoczności) — dla kamer 'cctv'. */
  system: string
  bands: Array<{ level: string; polygon: Point[] }>
}

/** Koryto kablowe (magistrala) do narysowania. */
export interface RenderTray {
  id: string
  /** Ścieżka w JEDNOSTKACH MODELU (uwaga: Tray.path w bundlu jest w mm — przelicza helper). */
  path: Point[]
  /** Szerokość koryta w jednostkach świata (widthMm / unitMm). */
  widthWorld: number
  /** Szerokość nominalna [mm] — do etykiety. */
  widthMm: number
}

/** Dodatkowe warstwy rysunku (pokrycie kamer, koryta). */
export interface RenderExtras {
  coverage?: RenderCoverage[]
  trays?: RenderTray[]
}

/** Metryczka rysunku wykonawczego (ramka + tabelka PN). */
export interface SheetInfo {
  projectName?: string
  drawingName?: string
  client?: string
  level?: number
  /** Skala rysunku, np. „1:100". */
  scaleText?: string
  /** Data w formacie tekstowym (np. „2026-06-30"). */
  date?: string
  /** Projektant (pole + miejsce na podpis — software NIE autoryzuje projektu). */
  designer?: string
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
  private deviceLabels: Text[] = []
  private coverageContainer = new Container() // strefy pokrycia kamer (pod trasami)
  private traysContainer = new Container() // koryta kablowe (pod kablami, nad pokryciem)
  private routesContainer = new Container() // trasy kablowe (pod urządzeniami)
  private devicesContainer = new Container() // symbole urządzeń (nad podkładem)
  private legendContainer = new Container() // legenda (stały rozmiar ekranowy)
  private frameGfx = new Graphics() // ramka rysunku (stały rozmiar ekranowy)
  private titleBlock = new Container() // tabelka PN (prawy-dolny róg)
  private titleBlockSize = { w: 300, h: 132 }
  private sheet: SheetInfo | null = null
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
  // Cykl życia: app.init() jest async; React StrictMode (dev) montuje→odmontowuje→montuje,
  // więc destroy() bywa wołany ZANIM init() się dokończy. Bez tych flag app.destroy() leci na
  // niezainicjalizowanym PixiJS → `_cancelResize is not a function` → czarny ekran.
  private initialized = false
  private destroyRequested = false

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
    // Odmontowano w trakcie init() (StrictMode/szybki unmount) → posprzątaj i nie montuj.
    if (this.destroyRequested) {
      this.app.destroy(true, { children: true })
      return
    }
    this.initialized = true
    parent.appendChild(this.app.canvas)

    this.world.addChild(this.spacesContainer)
    this.world.addChild(this.coverageContainer) // pokrycie kamer nad wypełnieniami pomieszczeń
    this.world.addChild(this.traysContainer) // koryta pod kablami (kabel leży w korycie)
    this.world.addChild(this.routesContainer) // trasy pod urządzeniami
    this.world.addChild(this.devicesContainer) // urządzenia nad trasami
    this.world.addChild(this.highlight)
    this.world.addChild(this.textContainer)
    this.world.addChild(this.measureGfx)
    this.app.stage.addChild(this.world)
    // Warstwa ekranowa (poza transformacją world: nie pan/zoom) — ramka, tabelka, legenda.
    this.app.stage.addChild(this.frameGfx)
    this.app.stage.addChild(this.titleBlock)
    this.app.stage.addChild(this.legendContainer)
    this.legendContainer.position.set(24, 24)

    this.bindInteractions()
    this.resizeObs = new ResizeObserver(() => this.applyTransform())
    this.resizeObs.observe(parent)
  }

  /** Wczytuje rysunek + pomieszczenia (+ opcjonalnie urządzenia/trasy/metryczkę/extras) i dopasowuje widok. */
  load(
    doc: DxfDocument,
    spaces: RenderSpace[],
    devices: RenderDevice[] = [],
    routes: RenderRoute[] = [],
    sheet: SheetInfo | null = null,
    extras: RenderExtras | null = null
  ): void {
    this.clear()
    this.bbox = doc.bbox
    this.sheet = sheet

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
      // Etykieta zwięzła: sam numer pomieszczenia (np. „0.14"), gdy nazwa nim się zaczyna —
      // inaczej pełna nazwa. Pełny opis (nazwa + metraż) w panelu / dymku po najechaniu.
      // 44 etykiet z numerem+nazwą+metrażem nachodziło na siebie (nieczytelne).
      const tok = s.name.split(/\s+/)[0]
      const labelText = /^[\d]/.test(tok) ? tok : s.name
      const label = new Text({
        text: labelText,
        style: { fontFamily: 'sans-serif', fontSize: 11, fill: 0xf1f5f9, align: 'center' }
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

    // Strefy pokrycia kamer (DORI, PN-EN 62676-4) — wypełnienia pod trasami/urządzeniami,
    // rysowane detection→identification (węższa strefa na wierzchu, ostrzejszy kolor).
    // Dedup: gdy po przycięciu do pokoju strefa ma TEN SAM obrys co węższa (mały pokój cały
    // w zasięgu), rysujemy tylko węższą (lepszy poziom) — bez tego 4 wypełnienia sumują się
    // w nieczytelną plamę.
    for (const cov of extras?.coverage ?? []) {
      const bands = cov.bands.filter((b) => b.polygon.length >= 3)
      for (let i = 0; i < bands.length; i++) {
        const next = bands[i + 1]
        if (next && Math.abs(polyArea(bands[i].polygon) - polyArea(next.polygon)) < 1e-6 + polyArea(next.polygon) * 0.01) {
          continue // szersza strefa niczego nie dodaje — pokrywa ją węższa (wyższa jakość)
        }
        const g = new Graphics()
        g.poly(bands[i].polygon.map((p) => ({ x: p.x, y: p.y }))).fill({
          color: this.doriColor(bands[i].level),
          alpha: 0.14
        })
        this.coverageContainer.addChild(g)
      }
    }

    // Koryta kablowe (magistrale) — grafitowe pasy o realnej szerokości + etykieta K{mm}.
    for (const t of extras?.trays ?? []) {
      if (t.path.length < 2) continue
      const g = new Graphics()
      g.moveTo(t.path[0].x, t.path[0].y)
      for (let i = 1; i < t.path.length; i++) g.lineTo(t.path[i].x, t.path[i].y)
      g.stroke({ width: Math.max(t.widthWorld, lw * 2), color: 0x475569, alpha: 0.45 })
      this.traysContainer.addChild(g)

      // Etykieta na środku najdłuższego segmentu (counter-scale przez deviceLabels).
      let bi = 0
      let bl = -1
      for (let i = 0; i < t.path.length - 1; i++) {
        const l = Math.hypot(t.path[i + 1].x - t.path[i].x, t.path[i + 1].y - t.path[i].y)
        if (l > bl) {
          bl = l
          bi = i
        }
      }
      const mid = {
        x: (t.path[bi].x + t.path[bi + 1].x) / 2,
        y: (t.path[bi].y + t.path[bi + 1].y) / 2
      }
      const lbl = new Text({
        text: `K${t.widthMm}`,
        style: { fontFamily: 'sans-serif', fontSize: 10, fontWeight: '600', fill: 0x94a3b8 }
      })
      lbl.anchor.set(0.5)
      lbl.position.set(mid.x, mid.y)
      this.deviceLabels.push(lbl)
      this.traysContainer.addChild(lbl)
    }

    // Trasy kablowe jako KORYTO: szara obudowa (casing) + kolorowy kabel na wierzchu.
    // Tam, gdzie wiele kabli biegnie korytarzem, obudowy nakładają się → efekt magistrali.
    for (const r of routes) {
      if (r.path.length < 2) continue
      const casing = new Graphics()
      casing.moveTo(r.path[0].x, r.path[0].y)
      for (let i = 1; i < r.path.length; i++) casing.lineTo(r.path[i].x, r.path[i].y)
      casing.stroke({ width: lw * 4.5, color: 0x64748b, alpha: 0.22 })
      this.routesContainer.addChild(casing)

      const cable = new Graphics()
      cable.moveTo(r.path[0].x, r.path[0].y)
      for (let i = 1; i < r.path.length; i++) cable.lineTo(r.path[i].x, r.path[i].y)
      cable.stroke({ width: lw * 1.6, color: this.systemColor(r.system), alpha: 0.9 })
      this.routesContainer.addChild(cable)
    }

    // Urządzenia — standardowe symbole CAD (gniazdo danych / AP Wi-Fi / kamera z polem widzenia).
    const ds = lw * 11 // pół-bok symbolu w jednostkach świata
    for (const d of devices) {
      const color = this.systemColor(d.system)
      const { x, y } = d.position
      const g = new Graphics()
      this.drawDeviceSymbol(g, d, x, y, ds, lw, color)
      this.devicesContainer.addChild(g)

      if (d.label) {
        const t = new Text({
          text: d.label,
          style: { fontFamily: 'sans-serif', fontSize: 11, fontWeight: '600', fill: 0xf1f5f9, align: 'center' }
        })
        t.anchor.set(0.5)
        t.position.set(x, y + ds * 2.6)
        this.deviceLabels.push(t)
        this.devicesContainer.addChild(t)
      }
    }

    this.buildLegend(devices)
    this.buildTitleBlock()
    this.fit()
  }

  /** Kolor strefy DORI (identification najostrzejsza → detection najsłabsza). */
  private doriColor(level: string): number {
    switch (level) {
      case 'identification':
        return 0x22c55e // zielony — najlepsza jakość obrazu
      case 'recognition':
        return 0xeab308 // żółty
      case 'observation':
        return 0xf97316 // pomarańczowy
      default:
        return 0xef4444 // detection — czerwony (tylko wykrycie)
    }
  }

  /** Kolor wiodący systemu instalacji (symbole + trasy). */
  private systemColor(system: string): number {
    switch (system) {
      case 'lan':
        return 0x38bdf8 // niebieski
      case 'cctv':
        return 0xef4444 // czerwony
      case 'sap':
        return 0xf59e0b // pomarańczowy (PPOŻ)
      case 'kd':
        return 0xa78bfa // fiolet
      default:
        return 0x94a3b8 // szary
    }
  }

  /** Standardowy symbol CAD urządzenia (linia + maska tła dla czytelności na podkładzie). */
  private drawDeviceSymbol(
    g: Graphics,
    d: RenderDevice,
    x: number,
    y: number,
    ds: number,
    lw: number,
    color: number
  ): void {
    const core = 0x0b1220 // kolor tła — maskuje podkład pod symbolem
    if (d.typeKey.startsWith('lan.ap')) {
      // Access Point: dysk + łuki Wi-Fi. KAŻDY łuk poprzedzony moveTo do jego początku —
      // bez tego PixiJS łączy bieżący punkt pióra (0,0) z łukiem → fałszywa linia z narożnika.
      g.circle(x, y, ds * 0.5).fill({ color: core, alpha: 0.95 }).stroke({ width: lw * 1.4, color })
      const arcAt = (r: number, a0: number, a1: number): void => {
        g.moveTo(x + r * Math.cos(a0), y + r * Math.sin(a0))
        g.arc(x, y, r, a0, a1).stroke({ width: lw * 1.1, color })
      }
      arcAt(ds * 0.95, Math.PI * 1.18, Math.PI * 1.82)
      arcAt(ds * 1.3, Math.PI * 1.22, Math.PI * 1.78)
    } else if (d.system === 'cctv') {
      // Kamera: klin pola widzenia + korpus + obiektyw.
      g.poly([
        { x, y },
        { x: x - ds * 1.7, y: y + ds * 0.8 },
        { x: x - ds * 1.7, y: y - ds * 0.8 }
      ]).fill({ color, alpha: 0.14 })
      g.rect(x - ds * 0.55, y - ds * 0.7, ds * 1.15, ds * 1.4).fill({ color: core, alpha: 0.96 }).stroke({ width: lw * 1.4, color })
      g.circle(x + ds * 0.05, y, ds * 0.32).stroke({ width: lw, color })
    } else {
      // Gniazdo danych (RJ45): zaokrąglony kwadrat + trójkąt kierunkowy.
      g.roundRect(x - ds, y - ds, ds * 2, ds * 2, ds * 0.4).fill({ color: core, alpha: 0.96 }).stroke({ width: lw * 1.4, color })
      g.poly([
        { x: x - ds * 0.45, y: y - ds * 0.5 },
        { x: x + ds * 0.55, y },
        { x: x - ds * 0.45, y: y + ds * 0.5 }
      ]).fill({ color })
    }
  }

  /** Tabelka PN (prawy-dolny róg) — projekt/rysunek/skala/data + miejsce na podpis projektanta. */
  private buildTitleBlock(): void {
    this.titleBlock.removeChildren().forEach((c) => c.destroy())
    if (!this.sheet) {
      this.titleBlock.visible = false
      return
    }
    this.titleBlock.visible = true
    const s = this.sheet
    const trim = (v: string): string => (v.length > 30 ? v.slice(0, 29) + '…' : v)
    const rows: [string, string][] = [
      ['Projekt', trim(s.projectName || '—')],
      ['Rysunek', trim(s.drawingName || '—')],
      ['Inwestor', trim(s.client || '—')],
      ['Kondygnacja', s.level == null ? '—' : String(s.level)],
      ['Skala', s.scaleText || '—'],
      ['Data', s.date || '—'],
      ['Projektant', trim((s.designer || '—') + '   podpis: ……')]
    ]
    const W = this.titleBlockSize.w
    const headH = 22
    const rowH = 15
    const H = headH + rows.length * rowH + 6
    this.titleBlockSize = { w: W, h: H }
    const padX = 10

    const bg = new Graphics()
    bg.roundRect(0, 0, W, H, 4).fill({ color: 0x0b1220, alpha: 0.93 }).stroke({ width: 1, color: 0x64748b, alpha: 0.8 })
    bg.rect(1, 1, W - 2, headH).fill({ color: 0x14233b, alpha: 0.95 })
    this.titleBlock.addChild(bg)

    const head = new Text({
      text: 'INFRADESIGN · The Best Agency',
      style: { fontFamily: 'sans-serif', fontSize: 12, fontWeight: '700', fill: 0x38bdf8 }
    })
    head.position.set(padX, 5)
    this.titleBlock.addChild(head)

    const sep = new Graphics().moveTo(padX + 86, headH + 2).lineTo(padX + 86, H - 4).stroke({ width: 0.6, color: 0x334155 })
    this.titleBlock.addChild(sep)

    rows.forEach((r, i) => {
      const y = headH + 4 + i * rowH
      const k = new Text({ text: r[0], style: { fontFamily: 'sans-serif', fontSize: 10, fill: 0x94a3b8 } })
      k.position.set(padX, y)
      const v = new Text({ text: r[1], style: { fontFamily: 'sans-serif', fontSize: 10, fontWeight: '600', fill: 0xe2e8f0 } })
      v.position.set(padX + 92, y)
      this.titleBlock.addChild(k)
      this.titleBlock.addChild(v)
    })
  }

  /** Rozkład warstwy ekranowej (ramka + tabelka) wg bieżących wymiarów widoku. */
  private layoutScreenOverlays(): void {
    const { width, height } = this.app.renderer.screen
    this.frameGfx.clear()
    if (this.sheet) {
      const m = 10
      this.frameGfx.rect(m, m, width - 2 * m, height - 2 * m).stroke({ width: 1.5, color: 0x64748b, alpha: 0.55 })
      this.frameGfx.rect(m + 5, m + 5, width - 2 * m - 10, height - 2 * m - 10).stroke({ width: 0.8, color: 0x64748b, alpha: 0.3 })
    }
    if (this.titleBlock.visible) {
      const m = 16
      this.titleBlock.position.set(width - this.titleBlockSize.w - m, height - this.titleBlockSize.h - m)
    }
  }

  /** Legenda (system → liczba urządzeń) — przyklejona do ekranu, lewy-górny róg. */
  private buildLegend(devices: RenderDevice[]): void {
    this.legendContainer.removeChildren().forEach((c) => c.destroy())
    if (!devices.length) return
    const byType = new Map<string, number>()
    for (const d of devices) byType.set(d.typeKey, (byType.get(d.typeKey) ?? 0) + 1)

    const NAME: Record<string, string> = {
      'lan.outlet.2x': 'Gniazdo 2×RJ45',
      'lan.outlet.1x': 'Gniazdo 1×RJ45',
      'lan.ap': 'Access Point',
      'cctv.dome.4mp': 'Kamera kopułkowa',
      'cctv.bullet.4mp': 'Kamera tubowa',
      'kd.reader': 'Czytnik KD',
      'kd.intercom': 'Interkom'
    }
    const W = 220
    const rowH = 18
    const headH = 22

    const bg = new Graphics()
    this.legendContainer.addChild(bg)
    const head = new Text({
      text: 'LEGENDA',
      style: { fontFamily: 'sans-serif', fontSize: 11, fontWeight: '700', fill: 0x94a3b8, letterSpacing: 1 }
    })
    head.position.set(10, 6)
    this.legendContainer.addChild(head)

    let row = 0
    for (const [typeKey, n] of byType) {
      const system = typeKey.split('.')[0]
      const color = this.systemColor(system)
      const y = headH + row * rowH
      // mini-glyph wg systemu (kwadrat/koło/trójkąt) — spójny z symbolami na rzucie
      const gl = new Graphics()
      const cx = 14
      const cy = y + 8
      if (typeKey.startsWith('lan.ap')) gl.circle(cx, cy, 5).fill({ color: 0x0b1220 }).stroke({ width: 1.4, color })
      else if (system === 'cctv')
        gl.poly([{ x: cx - 5, y: cy - 5 }, { x: cx + 5, y: cy - 5 }, { x: cx, y: cy + 5 }]).fill({ color: 0x0b1220 }).stroke({ width: 1.2, color })
      else gl.roundRect(cx - 5, cy - 5, 10, 10, 2).fill({ color: 0x0b1220 }).stroke({ width: 1.4, color })
      this.legendContainer.addChild(gl)

      const t = new Text({
        text: `${NAME[typeKey] ?? typeKey}  ·  ${n}`,
        style: { fontFamily: 'sans-serif', fontSize: 12, fill: 0xe2e8f0 }
      })
      t.position.set(28, y + 1)
      this.legendContainer.addChild(t)
      row++
    }
    bg.roundRect(0, 0, W, headH + row * rowH + 4, 6).fill({ color: 0x0b1220, alpha: 0.82 }).stroke({ width: 1, color: 0x334155, alpha: 0.7 })
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
    this.destroyRequested = true
    this.resizeObs?.disconnect()
    // Niszcz tylko, gdy init() się dokończył — inaczej PixiJS rzuca `_cancelResize is not a
    // function`. Gdy init jeszcze trwa, posprząta po sobie sam mount() (patrz destroyRequested).
    if (this.initialized) {
      this.initialized = false
      this.app.destroy(true, { children: true })
    }
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

    // Etykiety pomieszczeń/urządzeń: stały rozmiar ekranowy (kompensacja skali świata).
    const k = 1 / this.scale
    for (const lbl of this.spaceLabels) lbl.scale.set(k, -k)
    for (const lbl of this.deviceLabels) lbl.scale.set(k, -k)

    // LOD: ukryj tekst DXF gdy zbyt drobny by go czytać.
    for (const [key, c] of this.layerContainers) {
      if (!key.startsWith('text:')) continue
      const first = c.children[0] as Text | undefined
      if (!first) continue
      const px = (first.style.fontSize as number) * this.scale
      c.renderable = px >= TEXT_MIN_PX
    }

    // Warstwa ekranowa (ramka/tabelka) — przelicz pozycje wg rozmiaru widoku.
    this.layoutScreenOverlays()
  }

  private clear(): void {
    for (const c of this.layerContainers.values()) c.destroy({ children: true })
    this.layerContainers.clear()
    this.spacesContainer.removeChildren().forEach((c) => c.destroy())
    this.textContainer.removeChildren().forEach((c) => c.destroy())
    this.coverageContainer.removeChildren().forEach((c) => c.destroy())
    this.traysContainer.removeChildren().forEach((c) => c.destroy())
    this.routesContainer.removeChildren().forEach((c) => c.destroy())
    this.devicesContainer.removeChildren().forEach((c) => c.destroy())
    this.legendContainer.removeChildren().forEach((c) => c.destroy())
    this.titleBlock.removeChildren().forEach((c) => c.destroy())
    this.frameGfx.clear()
    this.spaceLabels = []
    this.deviceLabels = []
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

/** Pole wieloboku (shoelace, wartość bezwzględna). */
function polyArea(poly: Point[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a / 2)
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
