import { describe, it, expect } from 'vitest'
import { NormEngine } from './engine'
import { createDefaultCalculators } from './calculators'
import type { NormRule } from '@domain/model/schema'

const engine = new NormEngine(createDefaultCalculators())

describe('NormEngine — interpreter DSL', () => {
  it('ewaluuje proste porównanie pól', () => {
    const expr = {
      kind: 'cmp' as const,
      op: '>=' as const,
      left: { kind: 'field' as const, path: 'device.props.grade' },
      right: { kind: 'const' as const, value: 2 }
    }
    expect(engine.evaluate(expr, { device: { props: { grade: 3 } } })).toBe(true)
    expect(engine.evaluate(expr, { device: { props: { grade: 1 } } })).toBe(false)
  })

  it('woła kalkulator DORI z encją jako argumentem', () => {
    const expr = {
      kind: 'cmp' as const,
      op: '>=' as const,
      left: { kind: 'call' as const, fn: 'dori', args: [{ kind: 'field' as const, path: 'device' }] },
      right: { kind: 'field' as const, path: 'device.props.doriTarget' }
    }
    const ctx = { device: { props: { doriResolutionPxM: 260, doriTarget: 250 } } }
    expect(engine.evaluate(expr, ctx)).toBe(true)
    const ctxFail = { device: { props: { doriResolutionPxM: 120, doriTarget: 250 } } }
    expect(engine.evaluate(expr, ctxFail)).toBe(false)
  })

  it('blokuje dostęp do prototype (bezpieczeństwo)', () => {
    const expr = { kind: 'field' as const, path: 'device.__proto__.polluted' }
    expect(engine.evaluate(expr, { device: {} })).toBeUndefined()
  })

  it('validateOne zwraca pass/fail z metadanymi reguły', () => {
    const rule: NormRule = {
      id: 'lan.channel.length',
      norm: 'PN-EN 50173',
      version: '2018',
      system: 'lan',
      appliesTo: 'route',
      severity: 'error',
      predicate: {
        kind: 'cmp',
        op: '<=',
        left: { kind: 'call', fn: 'routeLength', args: [{ kind: 'field', path: 'route' }] },
        right: { kind: 'const', value: 90 }
      },
      message: 'Kanał stały przekracza 90 m',
      reference: 'PN-EN 50173-1'
    }
    const ok = engine.validateOne(rule, { route: { length: 75 } }, 'r1')
    expect(ok.status).toBe('pass')
    const bad = engine.validateOne(rule, { route: { length: 110 } }, 'r2')
    expect(bad.status).toBe('fail')
    expect(bad.reference).toBe('PN-EN 50173-1')
  })
})
