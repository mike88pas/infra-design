import { resolve, normalize } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// NDA/branding: strona publiczna NIE może bundlować realnego katalogu producentów
// (SKU/marki z kosztorysów referencyjnych). Importy `./catalog` są relatywne, więc
// zwykły alias nie łapie — plugin podmienia ROZWIĄZANY moduł na katalog publiczny.
const REAL_CATALOG = normalize(resolve(__dirname, '../src/domain/installations/catalog.ts')).toLowerCase()
const PUBLIC_CATALOG = resolve(__dirname, 'src/catalogPublic.ts')

function publicCatalogSwap(): Plugin {
  return {
    name: 'infra-public-catalog-swap',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (importer && normalize(importer).toLowerCase() === normalize(PUBLIC_CATALOG).toLowerCase()) {
        return null // sam katalog publiczny (type-only import) — bez podmiany
      }
      const r = await this.resolve(source, importer, { skipSelf: true, ...options })
      if (r && normalize(r.id).toLowerCase() === REAL_CATALOG) return PUBLIC_CATALOG
      return null
    }
  }
}

// Web demo dla klienta: reużywa rdzeń CAD (@core/cad) i model (@domain) z apki
// desktop. Korzysta z node_modules repo (react/pixi/rbush) — bez osobnej instalacji.
export default defineConfig({
  root: resolve(__dirname),
  base: './',
  plugins: [publicCatalogSwap(), react()],
  resolve: {
    alias: {
      '@core': resolve(__dirname, '../src/core'),
      '@domain': resolve(__dirname, '../src/domain')
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500
  }
})
