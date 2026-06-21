/**
 * NormEngine — bezpieczny interpreter deklaratywnych reguł norm.
 *
 * Reguła (NormRule.predicate) to AST (RuleExpr), NIE kod. Ewaluacja odbywa się
 * bez `eval`/`Function`. Złożone obliczenia (DORI, spadek napięć, wypełnienie
 * tras) pochodzą z CalculatorRegistry. Dzięki temu dokładanie norm = dane
 * (pliki YAML), a nie nowy kod.
 */

import type { NormRule, RuleExpr, ValidationResult } from '@domain/model/schema'
import { CalculatorRegistry } from './calculators'

/** Kontekst ewaluacji jednej reguły dla jednej encji docelowej. */
export interface EvalContext {
  /** Encja docelowa pod aliasem zgodnym z appliesTo (device/route/circuit/space/tray/project). */
  [alias: string]: unknown
}

export class NormEngine {
  constructor(private readonly calculators: CalculatorRegistry) {}

  /** Ewaluuje pojedyncze wyrażenie do wartości skalarnej/logicznej. */
  evaluate(expr: RuleExpr, ctx: EvalContext): number | string | boolean {
    switch (expr.kind) {
      case 'const':
        return expr.value
      case 'field':
        return this.resolveField(expr.path, ctx) as number | string | boolean
      case 'call': {
        const args = expr.args.map((a) => this.resolveArg(a, ctx))
        return this.calculators.call(expr.fn, args)
      }
      case 'cmp': {
        const l = this.evaluate(expr.left, ctx) as number
        const r = this.evaluate(expr.right, ctx) as number
        switch (expr.op) {
          case '>=': return l >= r
          case '<=': return l <= r
          case '>': return l > r
          case '<': return l < r
          case '==': return l === r
          case '!=': return l !== r
        }
        return false
      }
      case 'and':
        return expr.items.every((i) => this.evaluate(i, ctx) === true)
      case 'or':
        return expr.items.some((i) => this.evaluate(i, ctx) === true)
      case 'not':
        return this.evaluate(expr.item, ctx) !== true
    }
  }

  /**
   * Argument funkcji może być polem-encją (np. `device`) — wtedy przekazujemy
   * cały obiekt do kalkulatora, a nie wartość skalarną.
   */
  private resolveArg(expr: RuleExpr, ctx: EvalContext): unknown {
    if (expr.kind === 'field') return this.resolveField(expr.path, ctx)
    return this.evaluate(expr, ctx)
  }

  /** Bezpieczny dostęp do zagnieżdżonych pól: 'device.props.doriTarget'. */
  private resolveField(path: string, ctx: EvalContext): unknown {
    const parts = path.split('.')
    let cur: any = ctx
    for (const p of parts) {
      if (cur == null) return undefined
      // blokada prototype pollution / dostępu do niebezpiecznych kluczy
      if (p === '__proto__' || p === 'constructor' || p === 'prototype') return undefined
      cur = cur[p]
    }
    return cur
  }

  /** Waliduje jedną encję jedną regułą. */
  validateOne(rule: NormRule, ctx: EvalContext, targetId: string): ValidationResult {
    let pass = false
    try {
      pass = this.evaluate(rule.predicate, ctx) === true
    } catch {
      pass = false
    }
    return {
      ruleId: rule.id,
      targetId,
      status: pass ? 'pass' : 'fail',
      severity: rule.severity,
      message: rule.message,
      reference: rule.reference
    }
  }
}
