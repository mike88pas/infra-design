/**
 * Budowa kosztorysu/zestawienia inwestorskiego w formacie klienta (Pasywne/Aktywne/Telefony).
 *
 * Wejście: BOM projektu (`BomItem[]`) + liczba szaf. Wynik: `KosztorysExport` — gotowe wiersze
 * arkuszy Kosztorys (Lp|Towar|Ilość|Cena|Waluta|Netto|Brutto|Nazwa) i Zestawienie
 * (Lp|Towar|Ilość|J.M|Nazwa) per kategoria + zbiorczy CAŁOŚĆ. Sidecar (openpyxl) tylko zapisuje.
 *
 * Dwa kroki modelowania, oba oparte o realne kosztorysy klienta (Fibrain/Alcatel):
 *  1. DEKOMPOZYCJA — każde „logiczne" urządzenie z BOM rozkładamy na realne SKU
 *     (`CatalogEntry.components`): gniazdo → puszka+suport+ramka+moduły+adapter itd.
 *  2. INFRASTRUKTURA — z liczby portów LAN dopełniamy część bierną i czynną szafy:
 *     przełącznice HD (24 porty/szt), switche dostępowe PoE (24 porty/szt), szafy 42U.
 *     Heurystyka projektowa (konfigurowalna) — projektant weryfikuje przed wyceną wiążącą.
 *
 * Netto = Ilość × Cena; Brutto = Netto × (1 + VAT). VAT domyślnie 23% (kosztorys materiałowy,
 * bez robocizny — zgodnie ze wzorcem klienta).
 */

import type { BomItem } from '@domain/model/schema'
import { CATALOG, type KosztorysCategory, type SkuLine } from './catalog'

export interface KosztorysRow {
  lp: number
  sku: string
  name: string
  unit: string
  qty: number
  price: number
  netto: number
  brutto: number
  category: KosztorysCategory
}

/** Wiersz zestawienia materiałowego (bez ceny). */
export interface ZestawienieRow {
  lp: number
  sku: string
  qty: number
  unit: string
  name: string
}

export interface KosztorysCategoryBlock {
  key: KosztorysCategory
  label: string
  /** Wiersze kosztorysu (Lp ciągłe w skali całego dokumentu). */
  kosztorys: KosztorysRow[]
  /** Wiersze zestawienia (Lp lokalne 1..N w obrębie kategorii). */
  zestawienie: ZestawienieRow[]
  netto: number
  brutto: number
}

export interface KosztorysExport {
  categories: KosztorysCategoryBlock[]
  /** Wszystkie wiersze kosztorysu po kolei (Lp ciągłe) — arkusz CAŁOŚĆ. */
  all: KosztorysRow[]
  total: { netto: number; brutto: number }
  vatPct: number
  meta: { project: string; generatedNote: string }
}

export interface KosztorysOptions {
  vatPct?: number
  /** Liczba szaf (cele tras z autodesign). Domyślnie 1, gdy są jakiekolwiek urządzenia LAN. */
  cabinetCount?: number
  /** Porty na 1 przełącznicę HD / switch dostępowy (domyślnie 24). */
  portsPerPanel?: number
  projectName?: string
}

const CATEGORY_ORDER: KosztorysCategory[] = ['pasywne', 'aktywne', 'telefony']
const CATEGORY_LABEL: Record<KosztorysCategory, string> = {
  pasywne: 'Pasywne',
  aktywne: 'Aktywne',
  telefony: 'Telefony'
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Liczba portów wnoszona przez pozycję BOM (gniazda → porty RJ45). */
function portsOf(b: BomItem): number {
  if (b.catalogRef === 'lan.outlet.2x') return b.qty * 2
  if (b.catalogRef === 'lan.outlet.1x') return b.qty * 1
  return 0
}

/** Pozycja logiczna (klucz katalogu + ilość) → przed dekompozycją na SKU. */
interface LogicalItem {
  catalogRef: string
  qty: number
}

/**
 * Dopełnia projekt infrastrukturą szafy z liczby portów LAN:
 * przełącznice HD, switche dostępowe PoE, szafy 42U. Zwraca pozycje logiczne.
 */
function deriveInfrastructure(bom: BomItem[], opts: KosztorysOptions): LogicalItem[] {
  const portsPerPanel = opts.portsPerPanel ?? 24
  const totalPorts = bom.reduce((s, b) => s + portsOf(b), 0)
  if (totalPorts <= 0) return []
  const panels = Math.ceil(totalPorts / portsPerPanel)
  const switches = Math.ceil(totalPorts / portsPerPanel)
  const hasLan = bom.some((b) => b.system === 'lan')
  const racks = Math.max(opts.cabinetCount ?? (hasLan ? 1 : 0), 0)
  const out: LogicalItem[] = []
  if (panels > 0) out.push({ catalogRef: 'lan.patchpanel.24', qty: panels })
  if (switches > 0) out.push({ catalogRef: 'lan.switch.24p', qty: switches })
  if (racks > 0) out.push({ catalogRef: 'lan.rack.42u', qty: racks })
  return out
}

/** Rozkłada pozycję logiczną na realne SKU (components) albo pojedynczą pozycję „as is". */
function expand(item: LogicalItem): SkuLine[] {
  const cat = CATALOG[item.catalogRef]
  if (!cat) return []
  if (cat.components && cat.components.length) {
    return cat.components.map((c) => ({ ...c, qtyPer: c.qtyPer * item.qty }))
  }
  // brak dekompozycji → model jako SKU
  return [
    {
      sku: cat.model ?? cat.key,
      name: cat.description,
      unit: cat.unit,
      priceNet: cat.matPrice,
      qtyPer: item.qty,
      category: cat.category
    }
  ]
}

/**
 * Buduje kosztorys/zestawienie inwestorskie z BOM projektu, w formacie klienta.
 */
export function buildKosztorys(bom: BomItem[], opts: KosztorysOptions = {}): KosztorysExport {
  const vatPct = opts.vatPct ?? 23
  const vatMul = 1 + vatPct / 100

  // 1. Pozycje logiczne: BOM (urządzenia + kabel + korytka) + infrastruktura szafy.
  const logical: LogicalItem[] = [
    ...bom.filter((b) => b.catalogRef).map((b) => ({ catalogRef: b.catalogRef as string, qty: b.qty })),
    ...deriveInfrastructure(bom, opts)
  ]

  // 2. Dekompozycja na SKU + agregacja po SKU (sumujemy ilości).
  const bySku = new Map<string, SkuLine>()
  for (const item of logical) {
    for (const sku of expand(item)) {
      const ex = bySku.get(sku.sku)
      if (ex) ex.qtyPer += sku.qtyPer
      else bySku.set(sku.sku, { ...sku })
    }
  }

  // 3. Grupowanie po kategorii + sort malejąco po wartości (jak u klienta).
  let lp = 0
  const categories: KosztorysCategoryBlock[] = []
  const all: KosztorysRow[] = []
  for (const key of CATEGORY_ORDER) {
    const lines = [...bySku.values()]
      .filter((s) => s.category === key)
      .sort((a, b) => b.priceNet * b.qtyPer - a.priceNet * a.qtyPer)
    if (!lines.length) continue

    const kosztorys: KosztorysRow[] = []
    const zestawienie: ZestawienieRow[] = []
    let zlp = 0
    let netto = 0
    for (const s of lines) {
      const qty = Math.round(s.qtyPer)
      const n = r2(qty * s.priceNet)
      const row: KosztorysRow = {
        lp: ++lp,
        sku: s.sku,
        name: s.name,
        unit: s.unit,
        qty,
        price: s.priceNet,
        netto: n,
        brutto: r2(n * vatMul),
        category: key
      }
      kosztorys.push(row)
      all.push(row)
      zestawienie.push({ lp: ++zlp, sku: s.sku, qty, unit: s.unit, name: s.name })
      netto += n
    }
    categories.push({
      key,
      label: CATEGORY_LABEL[key],
      kosztorys,
      zestawienie,
      netto: r2(netto),
      brutto: r2(netto * vatMul)
    })
  }

  const totalNet = r2(categories.reduce((s, c) => s + c.netto, 0))
  return {
    categories,
    all,
    total: { netto: totalNet, brutto: r2(totalNet * vatMul) },
    vatPct,
    meta: {
      project: opts.projectName ?? 'Projekt',
      generatedNote: 'Kosztorys materiałowy wygenerowany przez Infra Design — do weryfikacji przez projektanta.'
    }
  }
}
