/**
 * Builder dokumentu eksportowego (F2/F3) — składa z projektu jedną strukturę gotową
 * do wygenerowania jako XLS / PDF / Word (przez adaptery w sidecarze lub TS).
 *
 * Zawiera: metrykę, dane projektanta z MIEJSCEM NA PODPIS (software nie podpisuje),
 * zestawienie materiałowe, kosztorys z podsumowaniem oraz wynik audytu norm.
 * To „model dokumentu", nie sam plik — render do formatów to osobny krok.
 */

import type { Designer, ProjectBundle } from '@domain/model/schema'
import { buildBom } from './bom'
import { buildCost, type CostSummary } from './cost'
import { runAudit, summarizeAudit, type AuditSummary } from '@domain/norms/audit'

/** Klauzula prawna na każdym dokumencie wyjściowym. */
export const LEGAL_DISCLAIMER =
  'Opracowanie wspomagane narzędziem Infra Design. Narzędzie nie zastępuje projektanta ' +
  'i nie autoryzuje dokumentacji. Zakres, poprawność i zgodność z przepisami potwierdza oraz ' +
  'podpisuje projektant z odpowiednimi uprawnieniami budowlanymi (członek właściwej izby — PIIB).'

const PLACEHOLDER_DESIGNER: Designer = {
  id: 'designer.placeholder',
  fullName: '— do uzupełnienia —',
  licenseNo: '— nr uprawnień —',
  specialty: 'instalacyjna (sieci/instalacje elektryczne)',
  chamber: '— okręgowa izba (PIIB) —',
  signaturePlaceholder: true
}

export interface ExportDocument {
  title: string
  meta: {
    projectName: string
    client: string
    units: string
    generatedNote: string
  }
  designer: Designer
  bom: ReturnType<typeof buildBom>
  cost: CostSummary
  audit: {
    results: ReturnType<typeof runAudit>
    summary: AuditSummary
  }
  disclaimer: string
}

export interface ExportOptions {
  title?: string
  overheadPct?: number
  vatPct?: number
}

/** Składa kompletny model dokumentu z projektu. */
export function buildExportDocument(bundle: ProjectBundle, opts: ExportOptions = {}): ExportDocument {
  const bom = buildBom({ devices: bundle.devices, routes: bundle.routes, trays: bundle.trays })
  const cost = buildCost(bom, { overheadPct: opts.overheadPct, vatPct: opts.vatPct })
  const results = runAudit(bundle)
  const designer = bundle.designers[0] ?? PLACEHOLDER_DESIGNER

  return {
    title: opts.title ?? 'Projekt instalacji niskoprądowych — zestawienie i kosztorys',
    meta: {
      projectName: bundle.project.name,
      client: bundle.project.client,
      units: bundle.project.units,
      generatedNote: 'Dokument roboczy wygenerowany automatycznie — do weryfikacji i podpisu projektanta.'
    },
    designer,
    bom,
    cost,
    audit: { results, summary: summarizeAudit(results) },
    disclaimer: LEGAL_DISCLAIMER
  }
}
