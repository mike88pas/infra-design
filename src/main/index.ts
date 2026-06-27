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
import * as keystore from './crypto/keystore'
import { createEmptyBundle, createEmptyProject, type ProjectBundle } from '@domain/model/schema'

let mainWindow: BrowserWindow | null = null
let sidecar: SidecarBridge | null = null

function sidecarScriptDir(): string {
  // dev: <root>/sidecar/geometry (Python + server.py)
  return join(app.getAppPath(), 'sidecar', 'geometry')
}

function getSidecar(): SidecarBridge {
  if (!sidecar) {
    // Produkcja: samodzielny sidecar server.exe (PyInstaller) w extraResources/sidecar/.
    // Dev: Python + server.py z drzewa repo.
    const exePath = app.isPackaged ? join(process.resourcesPath, 'sidecar', 'server.exe') : undefined
    sidecar = new SidecarBridge({
      scriptDir: sidecarScriptDir(),
      exePath,
      allowedRoots: securityRoots()
    })
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
    // Ikona okna/paska zadań. Prod: resources/icon.png z extraResources (process.resourcesPath);
    // dev: z drzewa repo. Windows i tak użyje ikony .exe (electron-builder) dla skrótów/taskbara.
    icon: app.isPackaged
      ? join(process.resourcesPath, 'icon.png')
      : join(app.getAppPath(), 'resources', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Blokada nawigacji i otwierania okien — renderer ma zostać przy swoim ładunku
  // (brak wycieku do zewnętrznych URL-i, brak okien-skoczków).
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-attach-webview', (e) => e.preventDefault())

  // Obserwowalność tylko w trybie debug (INFRA_DEBUG): konsola renderera + crashe → stdout,
  // oraz DevTools. Domyślnie cicho (produkcja).
  if (process.env.INFRA_DEBUG) {
    const levels = ['LOG', 'WARN', 'ERROR']
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      const src = (sourceId || '').split('/').pop()
      console.log(`[renderer-console ${levels[level] ?? level}] ${message} (${src}:${line})`)
    })
    mainWindow.webContents.on('render-process-gone', (_e, details) => {
      console.log(`[renderer-GONE] reason=${details.reason} exitCode=${details.exitCode}`)
    })
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Strażnik: wrażliwe kanały działają dopiero po odblokowaniu hasłem. */
function ensureUnlocked(): void {
  if (!keystore.isUnlocked()) throw new Error('Aplikacja zablokowana — odblokuj hasłem')
}

// ── Brama dostępu (logowanie) ──────────────────────────────────────────────
function registerSecurityIpc(): void {
  // Stan bramy: czy hasło już ustawione i czy odblokowano.
  ipcMain.handle('security:status', async () => ({
    initialized: keystore.isInitialized(),
    unlocked: keystore.isUnlocked()
  }))

  // Pierwsze uruchomienie — ustaw hasło (i odblokuj).
  ipcMain.handle('security:setup', async (_e, password: string) => {
    keystore.setupPassword(password)
    return { ok: true }
  })

  // Odblokowanie istniejącym hasłem.
  ipcMain.handle('security:unlock', async (_e, password: string) => {
    const ok = keystore.unlock(password)
    return { ok }
  })

  // Zablokuj (usuń klucz z pamięci).
  ipcMain.handle('security:lock', async () => {
    keystore.lock()
    return { ok: true }
  })
}

// ── Rejestracja kanałów IPC ────────────────────────────────────────────────
function registerIpc(): void {
  // Handshake z sidecarem (F0): zwraca wersję ezdxf.
  ipcMain.handle('sidecar:ping', async () => {
    return getSidecar().ping()
  })

  // Nowy pusty projekt.
  ipcMain.handle('project:new', async (_e, name: string) => {
    ensureUnlocked()
    const project = createEmptyProject({
      id: randomUUID(),
      name: name || 'Nowy projekt',
      now: new Date().toISOString()
    })
    return createEmptyBundle(project)
  })

  // Zapis do pliku .infra (z dialogiem jeśli brak ścieżki).
  ipcMain.handle('project:save', async (_e, bundle: ProjectBundle, filePath?: string) => {
    ensureUnlocked()
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
    await saveProject(target, bundle, keystore.getMasterKey())
    return { saved: true, filePath: target }
  })

  // Wczytanie z pliku .infra (z dialogiem jeśli brak ścieżki).
  ipcMain.handle('project:open', async (_e, filePath?: string) => {
    ensureUnlocked()
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
    const { bundle, migratedFromPlain } = await loadProject(target, keystore.getMasterKey())
    return { opened: true, filePath: target, bundle, migratedFromPlain }
  })

  // Import rzutu DXF (z dialogiem jeśli brak ścieżki) → DxfDocument.
  ipcMain.handle('dxf:import', async (_e, filePath?: string, opts?: { maxRenderEntities?: number }) => {
    ensureUnlocked()
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
    const doc = await getSidecar().importDxf(target, roots, opts?.maxRenderEntities)
    return { imported: true, filePath: target, doc }
  })

  // Wykrycie pomieszczeń z DXF (Shapely polygonize) → DetectedPolygon[].
  ipcMain.handle(
    'dxf:polygonize',
    async (
      _e,
      params: { path: string; wallLayers?: string[]; explodeBlocks?: boolean; snap?: number; minArea?: number }
    ) => {
      ensureUnlocked()
      const _allowedRoots = authorizeReadFile(params.path)
      return getSidecar().polygonize({ ...params, _allowedRoots })
    }
  )

  // Ekstrakcja symboli urządzeń (INSERT-y) z DXF → ExtractDevicesResult.
  ipcMain.handle(
    'dxf:extractDevices',
    async (_e, params: { path: string; layers?: string[]; includeAttribs?: boolean }) => {
      ensureUnlocked()
      const _allowedRoots = authorizeReadFile(params.path)
      return getSidecar().extractDevices({ ...params, _allowedRoots })
    }
  )

  // Wykaz pomieszczeń z etykiet pól → ExtractRoomsResult.
  ipcMain.handle(
    'dxf:extractRooms',
    async (_e, params: { path: string; areaLayers?: string[]; explodeBlocks?: boolean }) => {
      ensureUnlocked()
      const _allowedRoots = authorizeReadFile(params.path)
      return getSidecar().extractRooms({ ...params, _allowedRoots })
    }
  )

  // Wykaz pomieszczeń z TABELI „Zestawienie" + etykiet-numerów (DWG z PDF, bez warstw pól).
  ipcMain.handle(
    'dxf:extractRoomsSchedule',
    async (
      _e,
      params: {
        path: string
        explodeBlocks?: boolean
        scale?: number
        headerName?: string
        headerArea?: string
      }
    ) => {
      ensureUnlocked()
      const _allowedRoots = authorizeReadFile(params.path)
      return getSidecar().extractRoomsSchedule({ ...params, _allowedRoots })
    }
  )

  // Eksport rysunku instalacji do DXF (z dialogiem zapisu).
  ipcMain.handle(
    'dxf:export',
    async (_e, params: Omit<Parameters<SidecarBridge['exportDxf']>[0], 'path'>) => {
      ensureUnlocked()
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

  // Eksport elewacji szaf 19" do DXF.
  ipcMain.handle(
    'rack:export',
    async (
      _e,
      params: {
        racks: Array<{ name: string; uHeight: number; units: Array<{ uPos: number; uSize: number; label: string }> }>
        meta?: Record<string, string>
      }
    ) => {
      ensureUnlocked()
      const res = await dialog.showSaveDialog(mainWindow!, {
        title: 'Eksportuj elewację szaf (DXF)',
        defaultPath: 'Elewacja szaf.dxf',
        filters: [{ name: 'DXF', extensions: ['dxf'] }]
      })
      if (res.canceled || !res.filePath) return { exported: false }
      vouchPath(res.filePath)
      const _allowedRoots = authorizeWriteFile(res.filePath)
      const out = await getSidecar().exportRackElevation({
        path: res.filePath,
        racks: params.racks,
        meta: params.meta ?? {},
        _allowedRoots
      })
      return { exported: true, ...out }
    }
  )

  // Eksport kosztorysu/zestawienia inwestorskiego do XLSX (format klienta).
  ipcMain.handle('kosztorys:export', async (_e, params: { kosztorys: unknown; meta?: { project?: string } }) => {
    ensureUnlocked()
    const res = await dialog.showSaveDialog(mainWindow!, {
      title: 'Eksportuj kosztorys inwestorski (XLSX)',
      defaultPath: `Kosztorys inwestorski_${params.meta?.project || 'projekt'}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    })
    if (res.canceled || !res.filePath) return { exported: false }
    vouchPath(res.filePath)
    const _allowedRoots = authorizeWriteFile(res.filePath)
    const out = await getSidecar().exportKosztorys({
      path: res.filePath,
      kosztorys: params.kosztorys,
      _allowedRoots
    })
    return { exported: true, ...out }
  })

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
      ensureUnlocked()
      const _allowedRoots = authorizeReadFile(params.path)
      return getSidecar().routeCables({ ...params, _allowedRoots })
    }
  )
}

app.whenReady().then(() => {
  registerSecurityIpc()
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
