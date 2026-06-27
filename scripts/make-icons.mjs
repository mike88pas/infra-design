// Generuje ikony aplikacji z resources/icon.svg:
//   resources/icon.png  (1024×1024 — źródło dla electron-builder/Linux/macOS)
//   resources/icon.ico  (16/24/32/48/64/128/256 — Windows: okno + exe + instalator)
// Uruchom: node scripts/make-icons.mjs
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const svg = await readFile(resolve(root, 'resources/icon.svg'))

// PNG 1024 (źródło)
await sharp(svg, { density: 384 }).resize(1024, 1024).png().toFile(resolve(root, 'resources/icon.png'))

// ICO z wielu rozmiarów
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = await Promise.all(
  sizes.map((s) => sharp(svg, { density: 384 }).resize(s, s).png().toBuffer())
)
const ico = await pngToIco(pngs)
await writeFile(resolve(root, 'resources/icon.ico'), ico)

console.log('OK: resources/icon.png (1024) + resources/icon.ico (' + sizes.join(',') + ')')
