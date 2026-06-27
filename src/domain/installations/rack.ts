/**
 * Zagospodarowanie szaf 19" (elewacja rack) — z urządzeń projektu buduje model `Rack`
 * (rozmieszczenie paneli, switchy i organizerów w jednostkach U). Podstawa rysunku
 * „Widok/Elewacja szaf" (jak w realnych projektach SOS klienta).
 *
 * Heurystyka (konfigurowalna): porty LAN dzielimy na szafy (1 szafa na kondygnację / cel
 * tras). W każdej szafie, od dołu: przełącznice HD (24 porty/1U) + organizer, następnie
 * switche dostępowe (24 porty/1U) + organizer. Projektant weryfikuje przed realizacją.
 */

import type { Device, Rack, RackUnit } from '@domain/model/schema'
import { CATALOG } from './catalog'

export interface RackOptions {
  /** Porty na 1 przełącznicę/switch (domyślnie 24). */
  portsPerPanel?: number
  /** Wysokość szafy w U (domyślnie 42). */
  uHeight?: number
}

/** Liczba portów RJ45 wnoszona przez urządzenie. */
function portsOf(d: Device): number {
  if (d.typeKey === 'lan.outlet.2x') return 2
  if (d.typeKey === 'lan.outlet.1x') return 1
  return 0
}

const uSizeOf = (key: string, fallback = 1) => CATALOG[key]?.uSize ?? fallback

/** Buduje model szaf z urządzeń + listy szaf (cele tras autodesign). */
export function buildRacks(
  devices: Device[],
  cabinets: Array<{ id: string; name: string }>,
  opts: RackOptions = {}
): Rack[] {
  const portsPerPanel = opts.portsPerPanel ?? 24
  const uHeight = opts.uHeight ?? 42
  const totalPorts = devices.reduce((s, d) => s + portsOf(d), 0)
  if (totalPorts <= 0) return []

  const cabs = cabinets.length ? cabinets : [{ id: 'rack-1', name: 'Szafa IDF' }]
  const portsPerCab = Math.ceil(totalPorts / cabs.length)

  const panelLabel = CATALOG['lan.patchpanel.24']?.model ?? 'Przełącznica HD'
  const switchLabel = CATALOG['lan.switch.24p']?.model ?? 'Switch 24p'

  return cabs.map((cab, ci) => {
    const ports = ci === cabs.length - 1 ? totalPorts - portsPerCab * (cabs.length - 1) : portsPerCab
    const panels = Math.max(1, Math.ceil(ports / portsPerPanel))
    const switches = Math.max(1, Math.ceil(ports / portsPerPanel))

    const units: RackUnit[] = []
    let u = 1
    const place = (size: number, label: string): void => {
      if (u + size - 1 > uHeight) return // szafa pełna
      units.push({ uPos: u, uSize: size, label })
      u += size
    }
    // Część bierna: przełącznice + organizery poziome
    for (let i = 0; i < panels; i++) {
      place(uSizeOf('lan.patchpanel.24'), `${panelLabel} 24×RJ45 #${i + 1}`)
      place(1, 'Organizer poziomy ORG-VP-1U')
    }
    // Część czynna: switche + organizery
    for (let i = 0; i < switches; i++) {
      place(uSizeOf('lan.switch.24p'), `${switchLabel} #${i + 1}`)
      place(1, 'Organizer poziomy ORG-VP-1U')
    }

    return { id: cab.id, name: cab.name, uHeight, units }
  })
}
