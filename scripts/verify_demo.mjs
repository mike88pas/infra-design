/**
 * Headless weryfikacja web demo: ładuje stronę w Chromium, zbiera błędy konsoli,
 * sprawdza że canvas PixiJS się zamontował i że hover nad rzutem wykrywa
 * pomieszczenie (dowód działania hit-testu + danych end-to-end). Zrzuca screenshot.
 *
 * Uruchom:  node scripts/verify_demo.mjs <baseURL>
 */

import { chromium } from 'playwright'

const url = process.argv[2] || 'http://localhost:4178/'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto(url, { waitUntil: 'networkidle' })

// canvas PixiJS w ramce demo — najpierw przewiń w pole widzenia (mouse.move
// jest względem viewportu, więc element musi być widoczny)
await page.waitForSelector('.demo-canvas canvas', { timeout: 10000 })
await page.locator('.demo-frame').scrollIntoViewIfNeeded()
await page.waitForTimeout(1500) // render + fit

const canvasBox = await page.locator('.demo-canvas canvas').boundingBox()
if (!canvasBox || canvasBox.width < 100) {
  console.error('FAIL: canvas nie ma rozmiaru', canvasBox)
  await browser.close()
  process.exit(1)
}

// skan siatki punktów → który trafia w pomieszczenie
let barText = ''
const hits = []
for (let gy = 0.25; gy <= 0.8; gy += 0.25) {
  for (let gx = 0.2; gx <= 0.85; gx += 0.15) {
    const px = canvasBox.x + canvasBox.width * gx
    const py = canvasBox.y + canvasBox.height * gy
    await page.mouse.move(px - 3, py - 3)
    await page.mouse.move(px, py)
    await page.waitForTimeout(120)
    const t = await page.locator('.demo-bar').innerText()
    const last = t.split('\n').pop() || ''
    if (/m²/.test(last) && !/najedź/.test(last)) {
      hits.push(`${gx.toFixed(2)},${gy.toFixed(2)}→${last.trim()}`)
      barText = t
    }
  }
}
console.log('trafienia hover:', hits.length ? hits : 'BRAK')

await page.screenshot({ path: 'scripts/_demo-screenshot.png', fullPage: false })

const hoveredOk = /m²/.test(barText) && !/najedź na pomieszczenie/.test(barText.split('\n').pop() || '')

console.log('canvas:', `${Math.round(canvasBox.width)}x${Math.round(canvasBox.height)}`)
console.log('demo-bar po hover:', JSON.stringify(barText))
console.log('błędy konsoli:', errors.length ? errors : 'brak')
console.log('hover wykrył pomieszczenie:', hoveredOk)

await browser.close()

if (errors.length) {
  console.error('FAIL: są błędy konsoli/strony')
  process.exit(1)
}
if (!hoveredOk) {
  console.error('UWAGA: hover nie zwrócił pomieszczenia (sprawdź hit-test/skalę)')
  process.exit(2)
}
console.log('OK: demo renderuje się i reaguje na hover')
