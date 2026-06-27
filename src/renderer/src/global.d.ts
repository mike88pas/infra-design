import type { InfraApi } from '../../preload'

declare global {
  interface Window {
    infra: InfraApi
  }
}

// Asety importowane przez Vite (logo/ikona) → URL stringa.
declare module '*.svg' {
  const src: string
  export default src
}
declare module '*.png' {
  const src: string
  export default src
}

export {}
