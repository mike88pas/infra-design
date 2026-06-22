/**
 * Headless weryfikacja sekcji „Realny projekt" (ClientDemo): sprawdza, że pipeline F2
 * liczy się w przeglądarce (KPI urządzeń/pomieszczeń/kabla + kosztorys), że zmiana
 * mapowania warstwy przelicza wynik na żywo, i że nie ma błędów konsoli. Zrzuca screenshot.
 *
 * Uruchom:  node scripts/verify_client_demo.mjs <baseURL>
 */

import { chromium } from 'playwright'

const url = process.argv[2] || 'http://localhost:4173/'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })

const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto(url, { waitUntil: 'networkidle' })
await page.locator('#realny').scrollIntoViewIfNeeded()
await page.waitForTimeout(400)

const kpis = (await page.locator('#realny .kpis').innerText()).replace(/\s*\n\s*/g, ' ')
const brutto = (await page.locator('#realny .cost.grad').innerText()).replace(/\s*\n\s*/g, ' ')
console.log('KPI:', kpis)
console.log('Kosztorys:', brutto)

// Interaktywność: pomiń pierwszą REALNIE zmapowaną warstwę → liczba urządzeń spada.
const before = await page.locator('#realny .kpis b').first().innerText()
const idx = await page.$$eval('#realny select', (els) =>
  els.findIndex((e) => !['unset', 'ignore'].includes(e.value))
)
await page.locator('#realny select').nth(idx).selectOption('ignore')
await page.waitForTimeout(250)
const after = await page.locator('#realny .kpis b').first().innerText()
console.log(`Urządzeń przed→po pominięciu warstwy #${idx}: ${before} → ${after}`)

await page.screenshot({ path: 'scripts/_client-demo.png', fullPage: false })
console.log('błędy konsoli:', errors.length ? errors : 'brak')

await browser.close()

const liveOk = Number(before) > 0 && Number(after) < Number(before)
if (errors.length) {
  console.error('FAIL: błędy konsoli')
  process.exit(1)
}
if (!liveOk) {
  console.error('FAIL: pipeline nie przeliczył się po zmianie mapowania')
  process.exit(2)
}
console.log('OK: ClientDemo liczy F2 na żywo i reaguje na zmianę mapowania')
