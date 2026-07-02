/**
 * Preload — bezpieczny most między izolowanym rendererem a procesem głównym.
 * Wystawia wyłącznie wąskie, typowane API (`window.infra`), bez dostępu do Node.
 */

import { contextBridge, ipcRenderer } from 'electron'
import type {
  ProjectBundle,
  DxfDocument,
  PolygonizeResult,
  ExtractDevicesResult,
  ExtractRoomsResult
} from '@domain/model/schema'
import type { SidecarRouteResult } from '../main/sidecar'

const api = {
  sidecar: {
    ping: (): Promise<{ pong: boolean; ezdxf: string; python: string }> =>
      ipcRenderer.invoke('sidecar:ping')
  },
  // Brama dostępu (logowanie) — hasło chroni i szyfruje projekty at-rest.
  security: {
    status: (): Promise<{ initialized: boolean; unlocked: boolean }> =>
      ipcRenderer.invoke('security:status'),
    setup: (password: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('security:setup', password),
    unlock: (password: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('security:unlock', password),
    lock: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('security:lock')
  },
  dxf: {
    import: (
      filePath?: string,
      opts?: { maxRenderEntities?: number }
    ): Promise<{ imported: boolean; filePath?: string; doc?: DxfDocument }> =>
      ipcRenderer.invoke('dxf:import', filePath, opts),
    polygonize: (params: {
      path: string
      wallLayers?: string[]
      explodeBlocks?: boolean
      snap?: number
      minArea?: number
    }): Promise<PolygonizeResult> => ipcRenderer.invoke('dxf:polygonize', params),
    extractDevices: (params: {
      path: string
      layers?: string[]
      includeAttribs?: boolean
    }): Promise<ExtractDevicesResult> => ipcRenderer.invoke('dxf:extractDevices', params),
    extractRooms: (params: {
      path: string
      areaLayers?: string[]
      explodeBlocks?: boolean
    }): Promise<ExtractRoomsResult> => ipcRenderer.invoke('dxf:extractRooms', params),
    extractRoomsSchedule: (params: {
      path: string
      explodeBlocks?: boolean
      scale?: number
      headerName?: string
      headerArea?: string
    }): Promise<ExtractRoomsResult & { table_rows: number; plan_labels: number; unmatched: string[] }> =>
      ipcRenderer.invoke('dxf:extractRoomsSchedule', params),
    routeCables: (params: {
      path: string
      sources: { x: number; y: number }[]
      targets: { x: number; y: number }[]
      wallLayers?: string[]
      doorLayers?: string[]
      doorClear?: number
      explodeBlocks?: boolean
      cell?: number
      inflate?: number
    }): Promise<SidecarRouteResult> => ipcRenderer.invoke('dxf:routeCables', params),
    export: (params: {
      devices: Array<{ system: string; typeKey: string; position: { x: number; y: number } }>
      routes: Array<{ path: { x: number; y: number }[]; system: string }>
      trays?: Array<{ path: { x: number; y: number }[]; widthDraw: number; widthMm: number }>
      rooms: Array<{ name: string; at: { x: number; y: number } }>
      cabinets: { x: number; y: number }[]
      legend: Array<{ label: string; count: number }>
      meta: Record<string, string>
    }): Promise<{ exported: boolean; path?: string; devices?: number; routes?: number }> =>
      ipcRenderer.invoke('dxf:export', params)
  },
  kosztorys: {
    export: (params: {
      kosztorys: unknown
      meta?: { project?: string }
    }): Promise<{ exported: boolean; path?: string; sheets?: number; rows?: number }> =>
      ipcRenderer.invoke('kosztorys:export', params)
  },
  rack: {
    export: (params: {
      racks: Array<{ name: string; uHeight: number; units: Array<{ uPos: number; uSize: number; label: string }> }>
      meta?: Record<string, string>
    }): Promise<{ exported: boolean; path?: string; racks?: number; units?: number }> =>
      ipcRenderer.invoke('rack:export', params)
  },
  project: {
    new: (name: string): Promise<ProjectBundle> => ipcRenderer.invoke('project:new', name),
    save: (
      bundle: ProjectBundle,
      filePath?: string
    ): Promise<{ saved: boolean; filePath?: string }> =>
      ipcRenderer.invoke('project:save', bundle, filePath),
    open: (
      filePath?: string
    ): Promise<{
      opened: boolean
      filePath?: string
      bundle?: ProjectBundle
      migratedFromPlain?: boolean
    }> => ipcRenderer.invoke('project:open', filePath)
  }
}

export type InfraApi = typeof api

contextBridge.exposeInMainWorld('infra', api)
