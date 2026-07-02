/**
 * RuleSety norm w TS — kanoniczne źródło dla silnika audytu w produkcie.
 *
 * Mirror plików `rules/*.yaml` (te same reguły, ten sam mini-DSL). Trzymamy je w TS,
 * by audyt działał bez runtime'owego loadera YAML; loader z `rules/*.yaml` można
 * podpiąć później (F5) jako alternatywne źródło dla użytkownika edytującego reguły.
 */

import type { NormRule } from '@domain/model/schema'

export const INSTALLATION_RULES: NormRule[] = [
  {
    id: 'lan.channel.length',
    norm: 'PN-EN 50173',
    version: '2018',
    system: 'lan',
    appliesTo: 'route',
    severity: 'error',
    reference: 'PN-EN 50173-1 — kanał stały ≤ 90 m',
    message: 'Długość kanału stałego przekracza 90 m',
    predicate: {
      kind: 'cmp',
      op: '<=',
      left: { kind: 'call', fn: 'routeLength', args: [{ kind: 'field', path: 'route' }] },
      right: { kind: 'const', value: 90 }
    }
  },
  {
    id: 'cctv.dori.target',
    norm: 'PN-EN 62676',
    version: '2020',
    system: 'cctv',
    appliesTo: 'device',
    severity: 'warn',
    reference: 'PN-EN 62676-4 — kryteria DORI',
    message: 'Kamera nie osiąga zadeklarowanego poziomu DORI w strefie',
    // doriResolutionPxM liczy applyDoriProps (worst-case px/m w pomieszczeniu kamery);
    // 0 = brak danych (kamera bez pomieszczenia) → exempt, żeby nie generować fałszywych alarmów.
    predicate: {
      kind: 'or',
      items: [
        {
          kind: 'cmp',
          op: '==',
          left: { kind: 'field', path: 'device.props.doriResolutionPxM' },
          right: { kind: 'const', value: 0 }
        },
        {
          kind: 'cmp',
          op: '>=',
          left: { kind: 'call', fn: 'dori', args: [{ kind: 'field', path: 'device' }] },
          right: { kind: 'field', path: 'device.props.doriTarget' }
        }
      ]
    }
  },
  {
    id: 'tray.fill',
    norm: 'PN-EN 61537',
    version: '2007',
    system: 'tray',
    appliesTo: 'tray',
    severity: 'warn',
    reference: 'PN-EN 61537 / PN-EN 50174-2 — wypełnienie ≤ 40%',
    message: 'Wypełnienie korytka przekracza 40%',
    predicate: {
      kind: 'cmp',
      op: '<=',
      left: { kind: 'call', fn: 'fillRatio', args: [{ kind: 'field', path: 'tray' }] },
      right: { kind: 'const', value: 40 }
    }
  }
]
