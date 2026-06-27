/**
 * DRIVER / test integracyjny „pełny PW" trybu `schedule` (DWG zwektoryzowany z PDF).
 *
 * NIE jest to test jednostkowy — to headless odtworzenie pipeline'u z App.runImport
 * na realnym pliku klienta. Plik klienta NIE jest w repo (NDA) — ścieżkę podaje się
 * przez env, a gdy jej brak, test się POMIJA (skip). Brak danych klienta w kodzie.
 *
 *   INFRA_PYTHON=...python.exe \
 *   INFRA_DESIGN_DXF_DIR="C:\\...\\DXF" \
 *   npx vitest run tests/design-uniwersytet.run.test.ts
 *
 * Wejście pomieszczeń: TABELA „Zestawienie" + etykiety-numery (extract_rooms_schedule),
 * bo plik nie ma warstw pól ani PST_*. Kalibracja 1:100 → unitMm=100 (1 jedn.=100 mm).
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { SidecarBridge } from '../src/main/sidecar'
import { autoDesign } from '@domain/installations/autodesign'
import { buildCableRoutes } from '@domain/installations/routing'
import { buildBom } from '@domain/installations/bom'
import { buildCost, PLN } from '@domain/installations/cost'
import { runAudit } from '@domain/norms/audit'
import { INSTALLATION_RULES } from '@domain/norms/rules'
import { guessLevel } from '@domain/dxf/importProfile'
import type { ProjectBundle, Device } from '@domain/model/schema'

// Ścieżka do katalogu z DXF klienta — wyłącznie z env (poza repo, NDA).
const DXF_DIR = process.env.INFRA_DESIGN_DXF_DIR ?? ''
const PROJECT_NAME = process.env.INFRA_DESIGN_PROJECT ?? 'Realny projekt klienta'
const OUT_DIR = DXF_DIR ? join(dirname(DXF_DIR), 'EKSPORT_INSTALACJE') : ''

// Kalibracja / reguły (nadpisywalne wytycznymi klienta)
const UNIT_MM = Number(process.env.INFRA_UNIT_MM ?? 100) // 1:100 — 1 jedn. (mm papieru) = 100 mm realnych
const SPACING = 800 / UNIT_MM // 0.8 m odstępu rozkładania urządzeń (jak App.runImport: 800/unitMm)
const SYMBOL = 3 // pół-bok symbolu na arkuszu

describe('PW schedule — pełny pipeline (headless, plik klienta z env)', () => {
  const hasFile = DXF_DIR !== '' && existsSync(DXF_DIR)
  it.skipIf(!hasFile)('projektuje LAN+CCTV dla wszystkich kondygnacji', async () => {
    mkdirSync(OUT_DIR, { recursive: true })
    const allowed = [DXF_DIR, OUT_DIR]
    const bridge = new SidecarBridge({
      scriptDir: resolve(__dirname, '../sidecar/geometry'),
      allowedRoots: allowed
    })

    const files = readdirSync(DXF_DIR).filter((f) => f.toLowerCase().endsWith('.dxf')).sort()
    const rulesNoDori = INSTALLATION_RULES.filter((r) => r.id !== 'cctv.dori.target')

    const report: any[] = []
    const tot = { rooms: 0, devices: 0, cableM: 0, net: 0, gross: 0 }

    for (const fname of files) {
      const path = join(DXF_DIR, fname)
      const level = guessLevelFromName(fname)
      const drawingId = `drw-${level}`

      // 1) Pomieszczenia z zestawienia + etykiet
      const rr = await bridge.extractRoomsSchedule({ path, scale: 1.0, _allowedRoots: allowed })
      const rooms = rr.rooms

      // 2) Auto-projekt LAN+CCTV
      const ad = autoDesign(rooms, { drawingId, idPrefix: `L${level}`, spacing: SPACING })
      const devices: Device[] = ad.devices
      const targets = ad.cabinets.map((c) => c.at)
      const cabinetIds = ad.cabinets.map((c) => c.id)

      // 3) Trasy A* (otwarta siatka — zaszumionej geometrii NIE traktujemy jako ścian)
      let routes: ReturnType<typeof buildCableRoutes> = []
      let routedAstar = 0
      if (devices.length && targets.length) {
        const rc = await bridge.routeCables({
          path,
          sources: devices.map((d) => d.position),
          targets,
          wallLayers: ['__NOWALL__'],
          explodeBlocks: false,
          _allowedRoots: allowed
        })
        routedAstar = rc.routes.filter((r) => r.method === 'astar').length
        routes = buildCableRoutes({ devices, routes: rc.routes, unitMm: UNIT_MM, cabinetIds })
      }

      // 4) BOM + kosztorys
      const bom = buildBom({ devices, routes, trays: [] }, { cableSparePct: 5 })
      const cost = buildCost(bom, { overheadPct: 12, vatPct: 23 })

      // 4b) Audyt norm (kanał LAN ≤ 90 m)
      const validations = runAudit(
        { devices, routes, trays: [], circuits: [] } as unknown as ProjectBundle,
        rulesNoDori
      )
      const failed = validations.filter((v) => v.status === 'fail')

      // 5) Eksport DXF overlay
      const outPath = join(OUT_DIR, fname.replace(/\.dxf$/i, '_INSTALACJE.dxf'))
      const byType = countTypes(devices)
      await bridge.exportDxf({
        path: outPath,
        devices: devices.map((d) => ({ system: d.system, typeKey: d.typeKey, position: d.position })),
        routes: routes.map((r) => ({ path: r.path, system: r.system })),
        rooms: rooms.map((r) => ({ name: [r.number, r.name].filter(Boolean).join(' '), at: r.at })),
        cabinets: ad.cabinets.map((c) => c.at),
        legend: Object.entries(byType).map(([label, count]) => ({ label, count })),
        meta: {
          project: PROJECT_NAME,
          drawing: fname.replace(/\.dxf$/i, ''),
          designer: '<projektant z uprawnieniami PIIB>',
          license: '<nr uprawnień>'
        },
        symbolSize: SYMBOL,
        _allowedRoots: allowed
      })

      const cableM = routes.reduce((s, r) => s + r.length, 0)
      const areaM2 = rooms.reduce((s, r) => s + (r.areaM2 ?? 0), 0)
      tot.rooms += rooms.length
      tot.devices += devices.length
      tot.cableM += cableM
      tot.net += cost.net
      tot.gross += cost.gross
      report.push({
        level,
        drawing: fname,
        rooms: rooms.length,
        areaM2: round(areaM2),
        devices: devices.length,
        byType,
        cabinet: ad.cabinets[0]?.name,
        cableM: Math.round(cableM),
        routedAstar,
        net: Math.round(cost.net),
        gross: Math.round(cost.gross),
        auditErrors: failed.filter((v) => v.severity === 'error').length,
        auditWarnings: failed.filter((v) => v.severity === 'warn').length,
        export: outPath
      })
      expect(rooms.length).toBeGreaterThan(0)
      expect(devices.length).toBeGreaterThan(0)
    }

    bridge.stop()

    // Raport
    const lines: string[] = []
    lines.push(`=== ${PROJECT_NAME} — podsumowanie autodesign LAN+CCTV (schedule) ===\n`)
    for (const r of report) {
      lines.push(
        `KONDYGNACJA ${r.level}  [${r.drawing}]\n` +
          `  pomieszczenia: ${r.rooms}  (${r.areaM2} m²)\n` +
          `  urządzenia: ${r.devices}  ${JSON.stringify(r.byType)}\n` +
          `  szafa: ${r.cabinet}\n` +
          `  kabel: ${r.cableM} m  (A*: ${r.routedAstar})\n` +
          `  kosztorys: netto ${PLN(r.net)}  brutto ${PLN(r.gross)}\n` +
          `  audyt norm: błędy=${r.auditErrors} ostrzeżenia=${r.auditWarnings}\n` +
          `  → ${r.export}\n`
      )
    }
    lines.push(
      `\n=== RAZEM: ${tot.rooms} pomieszczeń, ${tot.devices} urządzeń, ` +
        `${Math.round(tot.cableM)} m kabla, netto ${PLN(tot.net)}, brutto ${PLN(tot.gross)} ===`
    )
    const txt = lines.join('\n')
    console.log('\n' + txt + '\n')
    writeFileSync(join(OUT_DIR, 'PODSUMOWANIE.txt'), txt, 'utf-8')
    writeFileSync(join(OUT_DIR, 'raport.json'), JSON.stringify(report, null, 2), 'utf-8')
  }, 600_000)
})

function guessLevelFromName(f: string): number {
  const u = f.toUpperCase()
  if (/PARTER/.test(u)) return 0
  if (/III/.test(u)) return 3
  if (/II/.test(u)) return 2
  if (/\bI\b|PI-TRA/.test(u)) return 1
  return guessLevel(f)
}
function countTypes(devices: Device[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const d of devices) m[d.typeKey] = (m[d.typeKey] ?? 0) + 1
  return m
}
function round(n: number): number {
  return Math.round(n * 100) / 100
}
