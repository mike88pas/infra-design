/**
 * Electron Main — orkiestracja okna, IPC i nadzór sidecara geometrii.
 *
 * Renderer jest izolowany (contextIsolation, brak nodeIntegration); cała
 * komunikacja idzie przez kanały IPC zdefiniowane tutaj i wystawione w preload.
 */

import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { SidecarBridge } from './sidecar'
import { saveProject, loadProject } from './project'
import { securityRoots, vouchPath, authorizeReadFile, authorizeWriteFile } from './paths'
import { createEmptyBundle, createEmptyProject, type ProjectBundle } from '@domain/model/schema'

let mainWindow: BrowserWindow | null = null
let sidecar: SidecarBridge | null = null

function sidecarScriptDir(): string {
  // dev: <root>/sidecar/geometry ; prod: rozpakowane zasoby (dochodzi w F6 packaging)
  return join(app.getAppPath(), 'sidecar', 'geometry')
}

function getSidecar(): SidecarBridge {
  if (!sidecar) {
    sidecar = new SidecarBridge({ scriptDir: sidecarScriptDir(), allowedRoots: securityRoots() })
  }
  return sidecar
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    backgroundColor: '#0b1220',
    title: 'Infra Design',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── Rejestracja kanałów IPC ────────────────────────────────────────────────
function registerIpc(): void {
  // Handshake z sidecarem (F0): zwraca wersję ezdxf.
  ipcMain.handle('sidecar:ping', async () => {
    return getSidecar().ping()
  })

  // Nowy pusty projekt.
  ipcMain.handle('project:new', async (_e, name: string) => {
    const project = createEmptyProject({
      id: randomUUID(),
      name: name || 'Nowy projekt',
      now: new Date().toISOString()
    })
    return createEmptyBundle(project)
  })

  // Zapis do pliku .infra (z dialogiem jeśli brak ścieżki).
  ipcMain.handle('project:save', async (_e, bundle: ProjectBundle, filePath?: string) => {
    let target = filePath
    if (!target) {
      const res = await dialog.showSaveDialog(mainWindow!, {
        title: 'Zapisz projekt Infra Design',
        defaultPath: `${bundle.project.name || 'projekt'}.infra`,
        filters: [{ name: 'Infra Design', extensions: ['infra'] }]
      })
      if (res.canceled || !res.filePath) return { saved: false }
      target = res.filePath
    }
    await saveProject(target, bundle)
    return { saved: true, filePath: target }
  })

  // Wczytanie z pliku .infra (z dialogiem jeśli brak ścieżki).
  ipcMain.handle('project:open', async (_e, filePath?: string) => {
    let target = filePath
    if (!target) {
      const res = await dialog.showOpenDialog(mainWindow!, {
        title: 'Otwórz projekt Infra Design',
        properties: ['openFile'],
        filters: [{ name: 'Infra Design', extensions: ['infra'] }]
      })
      if (res.canceled || !res.filePaths.length) return { opened: false }
      target = res.filePaths[0]
    }
    const bundle = await loadProject(target)
    return { opened: true, filePath: target, bundle }
  })

  // Import rzutu DXF (z dialogiem jeśli brak ścieżki) → DxfDocument.
  ipcMain.handle('dxf:import', async (_e, filePath?: string) => {
    let target = filePath
    if (!target) {
      const res = await dialog.showOpenDialog(mainWindow!, {
        title: 'Importuj rzut DXF',
        properties: ['openFile'],
        filters: [{ name: 'DXF', extensions: ['dxf'] }]
      })
      if (res.canceled || !res.filePaths.length) return { imported: false }
      target = res.filePaths[0]
      vouchPath(target) // plik wybrany przez użytkownika → zaufany
    }
    const roots = authorizeReadFile(target)
    const doc = await getSidecar().importDxf(target, roots)
    return { imported: true, filePath: target, doc }
  })

  // Wykrycie pomieszczeń z DXF (Shapely polygonize) → DetectedPolygon[].
  ipcMain.handle(
    'dxf:polygonize',
    async (
      _e,
      params: { path: string; wallLayers?: string[]; explodeBlocks?: boolean; snap?: number; minArea?: number }
    ) => {
      const _allowedRoots = authorizeReadFile(params.path)
      return getSidecar().polygonize({ ...params, _allowedRoots })
    }
  )

  // Ekstrakcja symboli urządzeń (INSERT-y) z DXF → ExtractDevicesResult.
  ipcMain.handle(
    'dxf:extractDevices',
    async (_e, params: { path: string; layers?: string[]; includeAttribs?: boolean }) => {
      const _allowedRoots = authorizeReadFile(params.path)
      return getSidecar().extractDevices({ ...params, _allowedRoots })
    }
  )

  // Wykaz pomieszczeń z etykiet pól → ExtractRoomsResult.
  ipcMain.handle(
    'dxf:extractRooms',
    async (_e, params: { path: string; areaLayers?: string[]; explodeBlocks?: boolean }) => {
      const _allowedRoots = authorizeReadFile(params.path)
      return getSidecar().extractRooms({ ...params, _allowedRoots })
    }
  )

  // Eksport rysunku instalacji do DXF (z dialogiem zapisu).
  ipcMain.handle(
    'dxf:export',
    async (_e, params: Omit<Parameters<SidecarBridge['exportDxf']>[0], 'path'>) => {
      const res = await dialog.showSaveDialog(mainWindow!, {
        title: 'Eksportuj rysunek instalacji (DXF)',
        defaultPath: `${params.meta?.drawing || 'instalacja'}.dxf`,
        filters: [{ name: 'DXF', extensions: ['dxf'] }]
      })
      if (res.canceled || !res.filePath) return { exported: false }
      vouchPath(res.filePath)
      const _allowedRoots = authorizeWriteFile(res.filePath)
      const out = await getSidecar().exportDxf({ ...params, path: res.filePath, _allowedRoots })
      return { exported: true, ...out }
    }
  )

  // Trasowanie kabli A* (urządzenia → szafy) → SidecarRouteResult.
  ipcMain.handle(
    'dxf:routeCables',
    async (
      _e,
      params: {
        path: string
        sources: { x: number; y: number }[]
        targets: { x: number; y: number }[]
        wallLayers?: string[]
        explodeBlocks?: boolean
        cell?: number
        inflate?: number
      }
    ) => {
      const _allowedRoots = authorizeReadFile(params.path)
      return getSidecar().routeCables({ ...params, _allowedRoots })
    }
  )
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  sidecar?.stop()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => sidecar?.stop())
