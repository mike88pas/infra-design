/**
 * CalculatorRegistry — nazwane funkcje obliczeniowe wołane z mini-DSL reguł.
 *
 * Dodanie nowego kalkulatora normowego = rejestracja jednej funkcji, bez
 * dotykania interpretera. Funkcje dostają zewaluowane argumenty (liczby/encje)
 * i zwracają wartość skalarną używaną w porównaniu reguły.
 *
 * UWAGA: implementacje w F0 są celowo uproszczone (placeholder fizyki).
 * Pełne wzory (DORI, spadek napięć PN-HD 60364, wypełnienie PN-EN 61537)
 * dochodzą w F5 wraz z realnymi danymi urządzeń.
 */

export type CalculatorFn = (...args: any[]) => number | boolean | string

export class CalculatorRegistry {
  private fns = new Map<string, CalculatorFn>()

  register(name: string, fn: CalculatorFn): void {
    this.fns.set(name, fn)
  }

  has(name: string): boolean {
    return this.fns.has(name)
  }

  call(name: string, args: any[]): number | boolean | string {
    const fn = this.fns.get(name)
    if (!fn) throw new Error(`Nieznany kalkulator normowy: '${name}'`)
    return fn(...args)
  }
}

/** Długość łamanej (path) w jednostkach rysunku. */
export function polylineLength(path: Array<{ x: number; y: number }>): number {
  let total = 0
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x
    const dy = path[i].y - path[i - 1].y
    total += Math.hypot(dx, dy)
  }
  return total
}

/**
 * Rejestr domyślny z kalkulatorami pilota (LAN/CCTV).
 * F5 podmieni placeholdery na pełne wzory normowe.
 */
export function createDefaultCalculators(): CalculatorRegistry {
  const reg = new CalculatorRegistry()

  // PN-EN 50173: długość kanału stałego (placeholder = długość trasy).
  reg.register('routeLength', (route: { path?: Array<{ x: number; y: number }>; length?: number }) => {
    if (typeof route?.length === 'number') return route.length
    return route?.path ? polylineLength(route.path) : 0
  })

  // PN-EN 62676 / DORI — placeholder: zwraca zadeklarowany poziom w props
  // (pełny model FOV/rozdzielczość/dystans w F5/F4).
  reg.register('dori', (device: { props?: Record<string, unknown> }) => {
    const v = device?.props?.['doriResolutionPxM']
    return typeof v === 'number' ? v : 0
  })

  // PN-EN 61537 — wypełnienie korytka [%] (placeholder: pole props.fillPercent).
  reg.register('fillRatio', (tray: { fillPercent?: number }) => tray?.fillPercent ?? 0)

  // PN-HD 60364-5-52 — spadek napięć [%] (placeholder: pole circuit.voltageDropPct).
  reg.register('voltageDrop', (circuit: { voltageDropPct?: number }) => circuit?.voltageDropPct ?? 0)

  // PN-EN 50131 — stopień zabezpieczenia urządzenia (Grade).
  reg.register('deviceGrade', (device: { props?: Record<string, unknown> }) => {
    const v = device?.props?.['grade']
    return typeof v === 'number' ? v : 0
  })

  return reg
}
