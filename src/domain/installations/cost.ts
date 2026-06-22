/**
 * Silnik kosztorysu (F2) — mapuje `BomItem[]` → `CostItem[]` (model rdzenia) +
 * podsumowanie (materiał/robocizna/narzuty/VAT/brutto).
 *
 * Metoda uproszczona wg rozp. 2021/2458: wartość = Σ (ilość × cena jednostkowa),
 * z narzutem kosztów pośrednich + zysk (Kp+Z) i VAT. Ceny z katalogu (placeholder).
 */

import type { BomItem, CostItem } from '@domain/model/schema'
import { CATALOG } from './catalog'

export interface CostSummary {
  items: CostItem[]
  material: number
  labor: number
  net: number
  overheadPct: number
  overhead: number
  subtotal: number
  vatPct: number
  vat: number
  gross: number
}

export interface CostOptions {
  /** Koszty pośrednie + zysk [%] (domyślnie 12%). */
  overheadPct?: number
  /** Stawka VAT [%] (domyślnie 23%). */
  vatPct?: number
}

const r2 = (n: number) => Math.round(n * 100) / 100
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)

/** Buduje kosztorys z BOM. */
export function buildCost(bom: BomItem[], opts: CostOptions = {}): CostSummary {
  const overheadPct = opts.overheadPct ?? 12
  const vatPct = opts.vatPct ?? 23

  const items: CostItem[] = bom.map((b) => {
    const cat = b.catalogRef ? CATALOG[b.catalogRef] : undefined
    const matPrice = cat?.matPrice ?? 0
    const laborPrice = cat?.laborPrice ?? 0
    const total = r2(b.qty * (matPrice + laborPrice))
    return {
      id: `cost.${b.id}`,
      bomItemId: b.id,
      knrCode: cat?.knr,
      description: b.description,
      qty: b.qty,
      unit: b.unit,
      materialPrice: matPrice,
      laborPrice,
      total
    }
  })

  const material = r2(sum(bom.map((b) => b.qty * (b.catalogRef ? CATALOG[b.catalogRef]?.matPrice ?? 0 : 0))))
  const labor = r2(sum(bom.map((b) => b.qty * (b.catalogRef ? CATALOG[b.catalogRef]?.laborPrice ?? 0 : 0))))
  const net = r2(material + labor)
  const overhead = r2((net * overheadPct) / 100)
  const subtotal = r2(net + overhead)
  const vat = r2((subtotal * vatPct) / 100)
  const gross = r2(subtotal + vat)

  return { items, material, labor, net, overheadPct, overhead, subtotal, vatPct, vat, gross }
}

/** Formatowanie PLN (pl-PL). */
export const PLN = (n: number) =>
  n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł'
