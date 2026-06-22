/**
 * Preload — bezpieczny most między izolowanym rendererem a procesem głównym.
 * Wystawia wyłącznie wąskie, typowane API (`window.infra`), bez dostępu do Node.
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { ProjectBundle, DxfDocument, PolygonizeResult } from '@domain/model/schema'

const api = {
  sidecar: {
    ping: (): Promise<{ pong: boolean; ezdxf: string; python: string }> =>
      ipcRenderer.invoke('sidecar:ping')
  },
  dxf: {
    import: (
      filePath?: string
    ): Promise<{ imported: boolean; filePath?: string; doc?: DxfDocument }> =>
      ipcRenderer.invoke('dxf:import', filePath),
    polygonize: (params: {
      path: string
      wallLayers?: string[]
      snap?: number
      minArea?: number
    }): Promise<PolygonizeResult> => ipcRenderer.invoke('dxf:polygonize', params)
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
    ): Promise<{ opened: boolean; filePath?: string; bundle?: ProjectBundle }> =>
      ipcRenderer.invoke('project:open', filePath)
  }
}

export type InfraApi = typeof api

contextBridge.exposeInMainWorld('infra', api)
