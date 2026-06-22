import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Web demo dla klienta: reużywa rdzeń CAD (@core/cad) i model (@domain) z apki
// desktop. Korzysta z node_modules repo (react/pixi/rbush) — bez osobnej instalacji.
export default defineConfig({
  root: resolve(__dirname),
  base: './',
  plugins: [react()],
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
