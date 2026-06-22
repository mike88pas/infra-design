/**
 * Pomieszczenia z etykiet pól DXF (F2) → Space[] modelu + przypisanie urządzeń.
 *
 * Źródłem są etykiety A-AREA (numer/nazwa/oficjalny metraż), wyłuskane przez
 * sidecar `extract_rooms`. To autorytatywny wykaz architekta — czystszy niż
 * polygonize ze ścian. Przypisanie urządzenia → pomieszczenie idzie po najbliższym
 * środku etykiety (MVP; docelowo punkt-w-obrysie, gdy mamy obrysy pomieszczeń).
 */

import type { DxfRoom, Id, Point, Space } from '@domain/model/schema'

export interface RoomSpaces {
  spaces: Space[]
  /** Zwraca id pomieszczenia najbliższego punktowi (środek etykiety). */
  assign: (at: Point) => Id | undefined
}

function dist2(a: Point, b: Point): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/** Buduje Space[] z wykazu pomieszczeń + funkcję przypisania po najbliższym środku. */
export function roomsToSpaces(rooms: DxfRoom[], drawingId: Id): RoomSpaces {
  const spaces: Space[] = rooms.map((r, i) => ({
    id: `${drawingId}::room::${r.number || i + 1}`,
    drawingId,
    name: [r.number, r.name].filter(Boolean).join(' ') || `Pom. ${i + 1}`,
    polygon: r.tag, // ramka etykiety jako marker (brak obrysu pomieszczenia w źródle)
    // area w mm² (konwencja modelu); metraż z etykiety jest w m² → ×1e6.
    area: r.areaM2 != null ? r.areaM2 * 1_000_000 : 0,
    type: undefined
  }))

  const centers = rooms.map((r) => r.at)

  const assign = (at: Point): Id | undefined => {
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < centers.length; i++) {
      const d = dist2(at, centers[i])
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return best >= 0 ? spaces[best].id : undefined
  }

  return { spaces, assign }
}
