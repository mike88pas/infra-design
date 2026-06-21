import type { InfraApi } from '../../preload'

declare global {
  interface Window {
    infra: InfraApi
  }
}

export {}
