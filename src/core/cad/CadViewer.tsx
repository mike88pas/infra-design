/**
 * CadViewer — cienki wrapper React nad CadScene (PixiJS).
 *
 * Współdzielony przez aplikację desktop (Electron) i webowe demo: montuje scenę
 * raz, przeładowuje przy zmianie danych, synchronizuje widoczność warstw. Dostęp
 * imperatywny do sceny (np. kalibracja) przez `onReady`.
 */

import { useEffect, useRef } from 'react'
import type { DxfDocument } from '@domain/model/schema'
import { CadScene, type RenderSpace, type RenderDevice, type RenderRoute } from './'

export interface CadViewerProps {
  doc: DxfDocument | null
  spaces: RenderSpace[]
  devices?: RenderDevice[]
  routes?: RenderRoute[]
  layerVisibility?: Record<string, boolean>
  onHoverSpace?: (s: RenderSpace | null) => void
  onReady?: (scene: CadScene) => void
  className?: string
}

export function CadViewer({
  doc,
  spaces,
  devices,
  routes,
  layerVisibility,
  onHoverSpace,
  onReady,
  className
}: CadViewerProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<CadScene | null>(null)
  const readyRef = useRef(false)
  // Najświeższe dane/callbacki bez retriggerowania montażu sceny.
  const latest = useRef({ doc, spaces, devices, routes, layerVisibility, onHoverSpace, onReady })
  latest.current = { doc, spaces, devices, routes, layerVisibility, onHoverSpace, onReady }

  // Po każdym load trzeba na nowo nałożyć widoczność warstw (load tworzy je od zera).
  function applyVisibility(): void {
    const s = sceneRef.current
    const vis = latest.current.layerVisibility
    if (!s || !vis) return
    for (const [name, v] of Object.entries(vis)) s.setLayerVisible(name, v)
  }

  // Montaż sceny — raz.
  useEffect(() => {
    let cancelled = false
    const scene = new CadScene({ onHoverSpace: (s) => latest.current.onHoverSpace?.(s) })
    sceneRef.current = scene
    scene.mount(hostRef.current!).then(() => {
      if (cancelled) {
        scene.destroy()
        return
      }
      readyRef.current = true
      latest.current.onReady?.(scene)
      if (latest.current.doc) {
        scene.load(latest.current.doc, latest.current.spaces, latest.current.devices, latest.current.routes)
        applyVisibility()
      }
    })
    return () => {
      cancelled = true
      readyRef.current = false
      sceneRef.current = null
      scene.destroy()
    }
  }, [])

  // Przeładowanie danych (po load ponownie nakładamy widoczność warstw).
  useEffect(() => {
    if (readyRef.current && sceneRef.current && doc) {
      sceneRef.current.load(doc, spaces, devices, routes)
      applyVisibility()
    }
  }, [doc, spaces, devices, routes])

  // Synchronizacja widoczności warstw.
  useEffect(() => {
    if (!readyRef.current || !sceneRef.current || !layerVisibility) return
    for (const [name, vis] of Object.entries(layerVisibility)) {
      sceneRef.current.setLayerVisible(name, vis)
    }
  }, [layerVisibility])

  return <div ref={hostRef} className={className} />
}
