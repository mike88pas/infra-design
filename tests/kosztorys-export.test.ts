/**
 * Testy kosztorysu inwestorskiego (format klienta: Pasywne/Aktywne/Telefony).
 *
 * 1) Domena `buildKosztorys` — dekompozycja na realne SKU, podział kategorii, ciągłe Lp
 *    w arkuszach Kosztorys, Netto=Ilość×Cena, Brutto=Netto×1,23, CAŁOŚĆ.
 * 2) Kontrakt eksportu XLSX (sidecar `export_kosztorys`) — odczyt zwrotny openpyxl:
 *    nazwy arkuszy + nagłówki. Pomijany, gdy interpreter sidecara niedostępny.
 *
 * NDA: dane syntetyczne — zero plików/ilości klienta.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildKosztorys } from '../src/domain/installations/kosztorysExport'
import { SidecarBridge } from '../src/main/sidecar'
import type { BomItem } from '../src/domain/model/schema'

// Syntetyczny BOM: 100 gniazd 2×RJ45 + kabel + 2 AP (urządzenia jak z autodesign).
const BOM: BomItem[] = [
  { id: 'bom.lan.outlet.2x', catalogRef: 'lan.outlet.2x', description: 'Gniazdo 2×RJ45', qty: 100, unit: 'kpl', system: 'lan', sourceRefs: [] },
  { id: 'bom.lan.ap', catalogRef: 'lan.ap', description: 'AP', qty: 2, unit: 'szt', system: 'lan', sourceRefs: [] },
  { id: 'bom.cable.utp.cat6', catalogRef: 'cable.utp.cat6', description: 'Kabel', qty: 1500, unit: 'm', system: 'lan', sourceRefs: [] }
]

describe('buildKosztorys — format inwestorski', () => {
  const k = buildKosztorys(BOM, { vatPct: 23, cabinetCount: 1 })

  it('dzieli pozycje na kategorie Pasywne/Aktywne', () => {
    const keys = k.categories.map((c) => c.key)
    expect(keys).toContain('pasywne')
    expect(keys).toContain('aktywne')
  })

  it('rozkłada gniazdo na realne SKU Fibrain (GIP-2, XR200, adapter)', () => {
    const pas = k.categories.find((c) => c.key === 'pasywne')!
    const skus = pas.kosztorys.map((r) => r.sku)
    expect(skus).toContain('GIP-2')
    expect(skus).toContain('XR200')
    expect(skus).toContain('XB-45KA45D-02')
    // 100 gniazd → 100 puszek GIP-2
    expect(pas.kosztorys.find((r) => r.sku === 'GIP-2')!.qty).toBe(100)
    // 100 gniazd × 2 moduły (faceplate) + infrastruktura paneli → ≥ 200
    expect(pas.kosztorys.find((r) => r.sku === 'XR200')!.qty).toBeGreaterThanOrEqual(200)
  })

  it('AP trafia do Aktywne jako OmniAccess Stellar', () => {
    const akt = k.categories.find((c) => c.key === 'aktywne')!
    expect(akt.kosztorys.map((r) => r.sku)).toContain('OAW-AP1301H-RW')
    expect(akt.kosztorys.find((r) => r.sku === 'OAW-AP1301H-RW')!.qty).toBe(2)
  })

  it('dopełnia infrastrukturę szafy (przełącznica, switch, szafa)', () => {
    const all = k.all.map((r) => r.sku)
    expect(all).toContain('XPS00') // przełącznica HD
    expect(all).toContain('OS6560-P24X4-EU') // switch dostępowy
    expect(all).toContain('SRS-42-6/6-S04-B') // szafa
  })

  it('Netto=Ilość×Cena, Brutto=Netto×1,23', () => {
    for (const r of k.all) {
      expect(r.netto).toBeCloseTo(r.qty * r.price, 1)
      expect(r.brutto).toBeCloseTo(r.netto * 1.23, 1)
    }
  })

  it('Lp ciągłe w arkuszach Kosztorys (CAŁOŚĆ)', () => {
    const lps = k.all.map((r) => r.lp)
    expect(lps).toEqual(Array.from({ length: lps.length }, (_, i) => i + 1))
  })

  it('suma total = suma kategorii (netto/brutto)', () => {
    const sumNet = k.categories.reduce((s, c) => s + c.netto, 0)
    expect(k.total.netto).toBeCloseTo(sumNet, 1)
    expect(k.total.brutto).toBeCloseTo(k.total.netto * 1.23, 1)
  })
})

// ── Kontrakt eksportu XLSX (sidecar) ────────────────────────────────────────

const ROOT = join(__dirname, '..')
function resolvePython(): string | null {
  const env = process.env.INFRA_PYTHON
  if (env && existsSync(env)) return env
  const venv = join(ROOT, 'sidecar', '.venv', 'Scripts', 'python.exe')
  if (existsSync(venv)) return venv
  const venvNix = join(ROOT, 'sidecar', '.venv', 'bin', 'python')
  if (existsSync(venvNix)) return venvNix
  return null
}

const python = resolvePython()
const tmp = mkdtempSync(join(tmpdir(), 'infra-kosztorys-'))
const bridge = python
  ? new SidecarBridge({ scriptDir: join(ROOT, 'sidecar', 'geometry'), python, allowedRoots: [tmp] })
  : null

afterAll(() => {
  bridge?.stop()
  try {
    rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe.skipIf(!python)('export_kosztorys → XLSX (kontrakt)', () => {
  it('zapisuje arkusze i nagłówki w formacie klienta', async () => {
    const k = buildKosztorys(BOM, { vatPct: 23, cabinetCount: 1, projectName: 'TEST' })
    const out = join(tmp, 'kosztorys.xlsx')
    const res = await bridge!.exportKosztorys({ path: out, kosztorys: k, _allowedRoots: [tmp] })
    expect(existsSync(res.path)).toBe(true)
    // CAŁOŚĆ (2) + para na kategorię (≥2 kategorie → ≥4) = ≥6 arkuszy
    expect(res.sheets).toBeGreaterThanOrEqual(6)

    // Odczyt zwrotny przez openpyxl: nazwy arkuszy + nagłówek Kosztorysu.
    const probe = [
      'import sys, json, openpyxl',
      'wb = openpyxl.load_workbook(sys.argv[1], data_only=True)',
      'ws = wb["KOSZTORYS CAŁOŚĆ"]',
      'rows = [[c.value for c in r] for r in ws.iter_rows()]',
      'hdr = rows[1]',
      'names = " ".join(str(r[7]) for r in rows[2:] if r and r[7])',
      'print(json.dumps({"sheets": wb.sheetnames, "hdr": hdr, "names": names}, ensure_ascii=True))'
    ].join('\n')
    const stdout = execFileSync(python!, ['-c', probe, res.path], {
      encoding: 'utf-8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    })
    const info = JSON.parse(stdout)
    expect(info.sheets).toContain('KOSZTORYS CAŁOŚĆ')
    expect(info.sheets).toContain('ZESTAWIENIE CAŁOŚĆ')
    expect(info.sheets).toContain('Kosztorys Pasywne')
    expect(info.hdr).toEqual(['Lp.', 'Towar', 'Ilość', 'Cena', 'Waluta', 'Netto', 'Brutto', 'Nazwa'])
    // Polskie znaki z danych (JSON przez stdio) round-trippują — regresja UTF-8 sidecara.
    expect(info.names).toContain('MODUŁ')
    expect(info.names).toContain('PRZEŁACZNICA')
  })
})
