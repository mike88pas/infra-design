/**
 * Budowanie urządzeń (Device[]) z symboli DXF (F2) — punkt styku F1↔F2.
 *
 * Wejście: INSERT-y z sidecara (`extract_devices`) + mapa warstwa→system/typ
 * (src/domain/dxf/systemMapping.ts, potwierdzona w kreatorze importu).
 * Wyjście: Device[] z modelu rdzenia — gotowe do BOM/kosztorysu/audytu.
 *
 * Atrybuty bloku (IDFX/NR — przypisanie portu do szafy) trafiają do `props`,
 * co później zasili schematy połączeń i krosowanie.
 */

import type { Device, DxfInsert, Id } from '@domain/model/schema'
import type { LayerSystemMap } from '@domain/dxf/systemMapping'

export interface DevicesFromInsertsOptions {
  /** Rysunek (kondygnacja), do którego należą urządzenia. */
  drawingId: Id
  /** Prefiks Id urządzeń (np. 'k1') — zapewnia unikalność między kondygnacjami. */
  idPrefix?: string
  /** Przypisanie do pomieszczeń (opcjonalne) — funkcja Point → spaceId. */
  spaceOf?: (at: { x: number; y: number }) => Id | undefined
}

/**
 * Mapuje INSERT-y na Device[]. Pomija warstwy bez mapowania (null = świadomie
 * pominięta, undefined/brak = niezmapowana). Atrybuty bloku → props.
 */
export function devicesFromInserts(
  inserts: DxfInsert[],
  mapping: LayerSystemMap,
  opts: DevicesFromInsertsOptions
): Device[] {
  const prefix = opts.idPrefix ?? 'dev'
  const out: Device[] = []
  let n = 0

  for (const ins of inserts) {
    const m = mapping[ins.layer]
    if (!m) continue // null (pomiń) lub undefined (niezmapowana)
    n++
    out.push({
      id: `${prefix}-${n}`,
      drawingId: opts.drawingId,
      spaceId: opts.spaceOf?.(ins.at),
      system: m.system,
      typeKey: m.typeKey,
      position: { x: ins.at.x, y: ins.at.y },
      rotation: ins.rotation,
      props: { ...ins.attribs },
      connections: []
    })
  }

  return out
}

/** Pomocniczo: zlicza urządzenia per typeKey (szybki podgląd przed BOM). */
export function countByTypeKey(devices: Device[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const d of devices) out[d.typeKey] = (out[d.typeKey] ?? 0) + 1
  return out
}
