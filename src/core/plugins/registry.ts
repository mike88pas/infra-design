/**
 * PluginRegistry — mechanizm wertykał.
 *
 * Rdzeń CAD nie wie nic o instalacjach. Każda wertykała (instalacje, później
 * wnętrza/architektura) rejestruje się tutaj, dostarczając: paletę typów
 * urządzeń, symbole, narzędzia, panele i zestaw reguł norm. Dodanie nowej
 * domeny = nowy plugin, ZERO zmian w core i w sidecarze geometrii.
 */

import type { NormRule, SystemKey, VerticalKey } from '@domain/model/schema'

/** Definicja typu urządzenia w palecie (np. 'cctv.dome.4mp'). */
export interface DeviceTypeDef {
  typeKey: string
  system: SystemKey
  label: string
  /** Domyślne właściwości nadawane przy wstawieniu na rzut. */
  defaultProps: Record<string, unknown>
  /** Identyfikator symbolu graficznego (renderowanego w core). */
  symbol: string
}

/** Definicja wertykały rejestrowana w core. */
export interface VerticalDef {
  key: VerticalKey
  label: string
  systems: SystemKey[]
  deviceTypes: DeviceTypeDef[]
  /** RuleSety norm dostarczane przez wertykałę (mogą być doładowane z YAML). */
  rules: NormRule[]
}

export class PluginRegistry {
  private verticals = new Map<VerticalKey, VerticalDef>()

  register(def: VerticalDef): void {
    if (this.verticals.has(def.key)) {
      throw new Error(`Wertykała '${def.key}' jest już zarejestrowana`)
    }
    this.verticals.set(def.key, def)
  }

  get(key: VerticalKey): VerticalDef | undefined {
    return this.verticals.get(key)
  }

  list(): VerticalDef[] {
    return [...this.verticals.values()]
  }

  /** Wszystkie typy urządzeń ze wszystkich wertykał (dla palet UI). */
  deviceTypes(): DeviceTypeDef[] {
    return this.list().flatMap((v) => v.deviceTypes)
  }

  /** Wyszukuje definicję typu urządzenia po kluczu. */
  findDeviceType(typeKey: string): DeviceTypeDef | undefined {
    return this.deviceTypes().find((d) => d.typeKey === typeKey)
  }

  /** Wszystkie reguły norm ze wszystkich wertykał. */
  rules(): NormRule[] {
    return this.list().flatMap((v) => v.rules)
  }
}

/** Globalny rejestr aplikacji. */
export const registry = new PluginRegistry()
