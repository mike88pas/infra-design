/**
 * Wyprowadzenie tras nośnych (koryt kablowych) z geometrii kabli — do BOM/kosztorysu.
 *
 * Problem: `autoDesign`/sidecar dają trasy kabli (home‑run każdego urządzenia do szafy), ale nie
 * korytka. Kosztorys koryt potrzebuje METRÓW koryta i SZEROKOŚCI — a te wynikają z tego, gdzie
 * KABLE BIEGNĄ RAZEM. Tu liczymy „kościec" (backbone): wspólne odcinki tras niosące ≥2 kable
 * dostają korytko; pojedynczy „drop" do gniazda zostaje samym kablem (realistycznie).
 *
 * Kluczowa rzecz dla poprawnej wyceny: **deduplikacja** — wspólny korytarz, którym biegnie 27
 * kabli, liczymy jako JEDEN odcinek koryta, nie 27×. Szerokość dobieramy wg wypełnienia
 * (PN‑EN 61537, ≤40%): liczba kabli na odcinku × przekrój kabla / przekrój koryta.
 *
 * Wejście: `CableRoute[]` (path w jednostkach modelu) + `unitMm`. Wynik: `Tray[]` (path w mm) —
 * konsumuje go `buildBom` (sumuje po szerokości → `tray.perforated.{100,200}` z katalogu).
 */

import type { CableRoute, Tray } from '@domain/model/schema'

export interface DeriveTraysOptions {
  drawingId?: string
  level?: number
  /** Kwantyzacja końców odcinków [mm] do dedupu wspólnych tras (domyślnie 50). */
  gridMm?: number
  /** Minimalna liczba kabli, by odcinek dostał korytko (domyślnie 2 = magistrala). */
  minCables?: number
  /** Średnica zewnętrzna kabla [mm] do wypełnienia (Cat6A ≈ 7,2). */
  cableOdMm?: number
}

/** Dostępne korytka (szerokość → wysokość) zgodne z katalogiem `tray.perforated.{w}`. */
const TRAY_TIERS: Array<{ w: number; h: number }> = [
  { w: 100, h: 42 },
  { w: 200, h: 60 }
]
const FILL_LIMIT = 0.4 // PN‑EN 61537

/** Dobór szerokości koryta i wypełnienia dla `n` kabli o przekroju `cableArea` [mm²]. */
function pickTray(n: number, cableArea: number): { widthMm: number; fillPercent: number } {
  for (const t of TRAY_TIERS) {
    const cap = Math.floor((t.w * t.h * FILL_LIMIT) / cableArea)
    if (n <= cap) return { widthMm: t.w, fillPercent: (n * cableArea) / (t.w * t.h) * 100 }
  }
  const last = TRAY_TIERS[TRAY_TIERS.length - 1]
  // Przekroczono pojemność największego — i tak je bierzemy; norma wykaże >40% (sygnał projektowy).
  return { widthMm: last.w, fillPercent: (n * cableArea) / (last.w * last.h) * 100 }
}

interface Edge {
  ax: number
  ay: number
  bx: number
  by: number
  count: number
}

/**
 * Buduje korytka (Tray[]) z tras kablowych: backbone (odcinki niosące ≥minCables kabli),
 * zdeduplikowany i scalony we współliniowe biegi; szerokość wg szczytowej liczby kabli.
 */
export function deriveTrays(routes: CableRoute[], unitMm: number, opts: DeriveTraysOptions = {}): Tray[] {
  const Q = opts.gridMm ?? 50
  const minCables = opts.minCables ?? 2
  const od = opts.cableOdMm ?? 7.2
  const cableArea = Math.PI * (od / 2) ** 2
  const qr = (v: number): number => Math.round((v * unitMm) / Q) * Q // model → mm → siatka

  // 1) Krokowanie każdej trasy na jednostkowe odcinki siatki (Q) + licznik kabli na każdym.
  // Krokowanie (a nie całe segmenty) jest kluczowe: dwie trasy wchodzące w korytarz w różnych
  // punktach mają segmenty RÓŻNEJ długości, ale wspólny fragment daje IDENTYCZNE Q-odcinki →
  // liczniki się sumują (poprawny dedup częściowego nakładania).
  const seg = new Map<string, Edge>()
  for (const r of routes) {
    const seen = new Set<string>() // jeden kabel liczy dany odcinek raz
    const p = r.path
    for (let i = 0; i < p.length - 1; i++) {
      const x0 = p[i].x * unitMm
      const y0 = p[i].y * unitMm
      const x1 = p[i + 1].x * unitMm
      const y1 = p[i + 1].y * unitMm
      const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / Q))
      let px = qr(p[i].x)
      let py = qr(p[i].y)
      for (let s = 1; s <= steps; s++) {
        const t = s / steps
        const cx = Math.round((x0 + (x1 - x0) * t) / Q) * Q
        const cy = Math.round((y0 + (y1 - y0) * t) / Q) * Q
        if (cx === px && cy === py) continue
        // Kanoniczna kolejność końców (a < b) — ten sam odcinek z dwóch tras → ten sam klucz.
        const swap = px > cx || (px === cx && py > cy)
        const ax = swap ? cx : px
        const ay = swap ? cy : py
        const bx = swap ? px : cx
        const by = swap ? py : cy
        const key = `${ax},${ay},${bx},${by}`
        if (!seen.has(key)) {
          seen.add(key)
          const e = seg.get(key)
          if (e) e.count++
          else seg.set(key, { ax, ay, bx, by, count: 1 })
        }
        px = cx
        py = cy
      }
    }
  }

  // 2) Backbone — tylko odcinki nośne (≥ minCables).
  const backbone = [...seg.values()].filter((e) => e.count >= minCables)
  if (!backbone.length) return []

  // 3) Grupowanie po prostej (kierunek + odsunięcie prostopadłe) i scalanie współliniowych biegów.
  interface Run {
    ux: number
    uy: number
    perp: number
    start: number
    end: number
    count: number
  }
  const byLine = new Map<string, Run[]>()
  for (const e of backbone) {
    const dx = e.bx - e.ax
    const dy = e.by - e.ay
    const len = Math.hypot(dx, dy)
    const ux = dx / len
    const uy = dy / len
    const perp = e.ax * -uy + e.ay * ux // p·n, n = (-uy, ux) — stałe na całej prostej
    const lineKey = `${Math.round(ux * 1e4)},${Math.round(uy * 1e4)},${Math.round(perp / (Q / 2))}`
    const ta = e.ax * ux + e.ay * uy
    const tb = e.bx * ux + e.by * uy
    const arr = byLine.get(lineKey) ?? []
    arr.push({ ux, uy, perp, start: Math.min(ta, tb), end: Math.max(ta, tb), count: e.count })
    byLine.set(lineKey, arr)
  }

  // 4) Union przedziałów na każdej prostej → biegi koryta (mniej, dłuższych Tray).
  const trays: Tray[] = []
  let idx = 0
  for (const runs of byLine.values()) {
    runs.sort((a, b) => a.start - b.start)
    let cur: Run | null = null
    const flush = (): void => {
      if (!cur) return
      const { widthMm, fillPercent } = pickTray(cur.count, cableArea)
      const pt = (t: number): { x: number; y: number } => ({
        x: t * cur!.ux + cur!.perp * -cur!.uy,
        y: t * cur!.uy + cur!.perp * cur!.ux
      })
      trays.push({
        id: `${opts.drawingId ?? 'drw'}::tray-${idx++}`,
        drawingId: opts.drawingId ?? 'drw',
        path: [pt(cur.start), pt(cur.end)],
        type: 'perforated',
        widthMm,
        fillPercent: Math.round(fillPercent * 10) / 10,
        level: opts.level ?? 0
      })
      cur = null
    }
    for (const r of runs) {
      if (cur && r.start <= cur.end + Q) {
        cur.end = Math.max(cur.end, r.end)
        cur.count = Math.max(cur.count, r.count) // szerokość wg szczytu na biegu
      } else {
        flush()
        cur = { ...r }
      }
    }
    flush()
  }

  return trays
}

/** Suma metrów koryt (po szerokości) — szybki podgląd przed BOM. */
export function trayMetersByWidth(trays: Tray[]): Record<number, number> {
  const out: Record<number, number> = {}
  for (const t of trays) {
    let mm = 0
    for (let i = 1; i < t.path.length; i++) {
      mm += Math.hypot(t.path[i].x - t.path[i - 1].x, t.path[i].y - t.path[i - 1].y)
    }
    out[t.widthMm] = (out[t.widthMm] ?? 0) + mm / 1000
  }
  return out
}
