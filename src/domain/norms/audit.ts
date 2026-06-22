/**
 * Silnik audytu (F5 groundwork) — przebiega silnikiem norm po całym `ProjectBundle`
 * i zwraca listę wyników walidacji + podsumowanie.
 *
 * Reguły dobierane są wg `appliesTo` (route/device/tray/...) i `system`. Mechanizm
 * jest generyczny — dodanie systemu/normy to dane (RuleSet), nie kod.
 */

import type { NormRule, ProjectBundle, ValidationResult } from '@domain/model/schema'
import { NormEngine } from './engine'
import { createDefaultCalculators } from './calculators'
import { INSTALLATION_RULES } from './rules'

const engine = new NormEngine(createDefaultCalculators())

/** Uruchamia audyt norm po całym projekcie. */
export function runAudit(bundle: ProjectBundle, rules: NormRule[] = INSTALLATION_RULES): ValidationResult[] {
  const out: ValidationResult[] = []

  for (const rule of rules) {
    switch (rule.appliesTo) {
      case 'route':
        for (const route of bundle.routes) {
          if (route.system !== rule.system) continue
          out.push(engine.validateOne(rule, { route }, route.id))
        }
        break
      case 'device':
        for (const device of bundle.devices) {
          if (device.system !== rule.system) continue
          out.push(engine.validateOne(rule, { device }, device.id))
        }
        break
      case 'tray':
        for (const tray of bundle.trays) {
          out.push(engine.validateOne(rule, { tray }, tray.id))
        }
        break
      case 'circuit':
        for (const circuit of bundle.circuits) {
          out.push(engine.validateOne(rule, { circuit }, circuit.id))
        }
        break
      // 'space' / 'project' — dochodzą wraz z odpowiednimi regułami
    }
  }
  return out
}

export interface AuditSummary {
  total: number
  passed: number
  failed: number
  errors: number
  warnings: number
}

export function summarizeAudit(results: ValidationResult[]): AuditSummary {
  const failed = results.filter((r) => r.status === 'fail')
  return {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    errors: failed.filter((r) => r.severity === 'error').length,
    warnings: failed.filter((r) => r.severity === 'warn').length
  }
}
