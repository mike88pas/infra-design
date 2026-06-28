import { useMemo, useState } from 'react'
import type { DxfDocument, DxfRoom, Point } from '@domain/model/schema'
import { CadViewer } from '@core/cad/CadViewer'
import type { RenderSpace, RenderDevice, RenderRoute } from '@core/cad'
import { guessLayerRole } from '@domain/dxf/layerMapping'
import { autoDesign } from '@domain/installations/autodesign'
import sampleData from './data/sample-floor.json'
import { ClientDemo } from './ClientDemo'

const sample = sampleData as unknown as { doc: DxfDocument; spaces: RenderSpace[] }

// Pokazujemy czysty rzut: ściany + pomieszczenia + etykiety. Ukrywamy warstwy
// z opisami DXF (dublują etykiety renderera) ORAZ łuki drzwi (DOORS) — dla widza
// spoza CAD wyglądają jak przypadkowe zielone krzywe.
const DEMO_LAYER_VIS: Record<string, boolean> = Object.fromEntries(
  sample.doc.layers.map((l) => [
    l.name,
    guessLayerRole(l.name) !== 'text' && !/door|drzwi/i.test(l.name)
  ])
)

// Auto-projekt LAN+CCTV na rzucie demo — ta sama funkcja `autoDesign` co w aplikacji
// desktop: z pomieszczeń generuje urządzenia wg reguł (1 gniazdo/10 m², AP, kamery).
function centroid(poly: Point[]): Point {
  const n = poly.length || 1
  return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n }
}
const DEMO_ROOMS: DxfRoom[] = sample.spaces.map((s, i) => ({
  number: String(i + 1),
  name: s.name,
  areaM2: s.area / 1_000_000,
  at: centroid(s.polygon),
  tag: s.polygon
}))
const DEMO_DESIGN = autoDesign(DEMO_ROOMS, {
  drawingId: 'demo',
  spacing: 650,
  // Realistycznie: kamery tylko w pomieszczeniach wspólnych/wrażliwych (open space,
  // sala konferencyjna, serwerownia) — NIE w prywatnych biurach. AP w większych salach.
  rules: {
    cctv: { minRoomArea: 999, nameKeywords: ['open', 'konf', 'sala', 'serwer'] },
    ap: { minRoomArea: 18 }
  }
})
const DEMO_DEVICES: RenderDevice[] = DEMO_DESIGN.devices.map((d) => ({
  id: d.id,
  system: d.system,
  typeKey: d.typeKey,
  position: d.position,
  rotation: d.rotation
}))
// Trasy kablowe (home-run): każde urządzenie → szafa IDF (tu: SERWEROWNIA).
// Ścieżka L-kształtna (poziom→pion) — czytelny obraz zbiegania okablowania do szafy.
const DEMO_RACK = DEMO_DESIGN.cabinets[0]?.at
const DEMO_ROUTES: RenderRoute[] = DEMO_RACK
  ? DEMO_DESIGN.devices.map((d) => ({
      id: `route-${d.id}`,
      system: d.system,
      path: [d.position, { x: DEMO_RACK.x, y: d.position.y }, DEMO_RACK]
    }))
  : []
// Marker szafy IDF w punkcie zbiegu tras (zawsze widoczny; szary kwadrat).
const DEMO_RACK_MARK: RenderDevice[] = DEMO_RACK
  ? [{ id: 'rack', system: 'rack', typeKey: 'rack.idf', position: DEMO_RACK, rotation: 0 }]
  : []

const DEMO_SYS: { key: string; label: string; dot: string }[] = [
  { key: 'lan', label: 'LAN', dot: '#38bdf8' },
  { key: 'cctv', label: 'CCTV', dot: '#ef4444' }
]

const SYSTEMS = [
  { key: 'LAN', live: true },
  { key: 'CCTV', live: true },
  { key: 'SAP / PPOŻ', live: false },
  { key: 'DSO', live: false },
  { key: 'SSWiN', live: false },
  { key: 'KD', live: false },
  { key: 'Trasy kablowe', live: false },
  { key: 'Elektryka', live: false },
  { key: 'Automatyka / BMS', live: false }
]

const ROADMAP = [
  { ph: 'F0', t: 'Szkielet aplikacji, model danych, paczka projektu', done: true },
  { ph: 'F1', t: 'Import DXF, renderer rzutu, wykrywanie pomieszczeń', done: true },
  { ph: 'F2', t: 'Plugin LAN: import urządzeń z rzutu, trasy A*, długości, BOM', done: true },
  { ph: 'F3', t: 'Kosztorys (KNR + cennik), eksport PDF/XLS/Word — PILOT', done: false },
  { ph: 'F4', t: 'CCTV (FOV/DORI), auto-routing, widok szafy rack', done: false },
  { ph: 'F5', t: 'Walidacja norm (PN-EN) z odnośnikami', done: false }
]

export function App(): JSX.Element {
  const [hovered, setHovered] = useState<RenderSpace | null>(null)
  const [hiddenSys, setHiddenSys] = useState<Set<string>>(new Set())
  const totalArea = useMemo(
    () => sample.spaces.reduce((s, sp) => s + sp.area, 0) / 1_000_000,
    []
  )
  const demoDevices = useMemo(
    () => DEMO_DEVICES.filter((d) => !hiddenSys.has(d.system)),
    [hiddenSys]
  )
  const demoRoutes = useMemo(
    () => DEMO_ROUTES.filter((r) => !hiddenSys.has(r.system)),
    [hiddenSys]
  )
  function toggleDemoSys(k: string): void {
    setHiddenSys((h) => {
      const n = new Set(h)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  }

  return (
    <>
      <nav className="nav">
        <div className="wrap">
          <div className="brand">
            Infra<span>Design</span>
          </div>
          <div className="nav-links">
            <a href="#o-projekcie">O projekcie</a>
            <a href="#problem">Problem</a>
            <a href="#jak">Jak działa</a>
            <a href="#demo">Demo</a>
            <a href="#realny">Realny projekt</a>
            <a href="#roadmapa">Roadmapa</a>
          </div>
          <a className="btn" href="#kontakt">
            Umów prezentację
          </a>
        </div>
      </nav>

      <header className="hero">
        <div className="wrap">
          <span className="eyebrow">Pilot 1.0 · LAN + CCTV · aplikacja desktop (Windows)</span>
          <h1>
            Od rzutu <span className="grad">DXF</span> do gotowej oferty
            <br /> instalacji budynkowych
          </h1>
          <p className="lead">
            Wczytaj rzut, nanieś instalacje, sprawdź normy i wygeneruj BOM oraz kosztorys
            inwestorski. Jedno narzędzie zamiast AutoCAD-a, Excela i programu kosztorysowego —
            wspomaga projektanta z uprawnieniami.
          </p>
          <div className="cta-row">
            <a className="btn" href="#demo">
              Zobacz interaktywne demo
            </a>
            <a className="btn ghost" href="#kontakt">
              Porozmawiajmy o wdrożeniu
            </a>
          </div>
        </div>
      </header>

      <section className="block" id="o-projekcie">
        <div className="wrap">
          <h2 className="section-title">O przedsięwzięciu</h2>
          <p className="section-sub">
            Infra Design to desktopowy system CAD nowej generacji do projektowania instalacji
            niskoprądowych i elektrycznych w budynkach (LAN, CCTV, SSWiN, KD, PPOŻ/SAP, DSO, trasy,
            automatyka). Wczytuje rzut DXF/DWG i — w oparciu o reguły inżynierskie oraz realne normy
            (PN-EN 50173) — automatycznie rozmieszcza urządzenia, trasuje kable algorytmem A*,
            generuje BOM, kosztorys inwestorski i elewacje szaf 19". Dokumenty eksportuje w formatach
            branżowych (DXF, XLSX, elewacje rack), a katalog produktów jest realny (Fibrain,
            Alcatel-Lucent, Hikvision, ZPAS) z aktualnymi cenami — więc wyceny są wiarygodne od
            pierwszego dnia.
          </p>
          <div className="grid">
            <div className="card">
              <div className="ico">⚡</div>
              <h3>Z dni do godzin</h3>
              <p>
                Jedno narzędzie zamiast AutoCAD-a, Excela i programu kosztorysowego. Wspólny model
                danych spina rysunek, instalacje, normy i kosztorys.
              </p>
            </div>
            <div className="card">
              <div className="ico">🔒</div>
              <h3>Lokalnie i bezpiecznie</h3>
              <p>
                Poufne rzuty nie opuszczają komputera. Projekty szyfrowane at-rest (AES-256-GCM) za
                bramą hasła; renderer izolowany wg najlepszych praktyk.
              </p>
            </div>
            <div className="card">
              <div className="ico">🧱</div>
              <h3>Generyczny rdzeń, wertykały</h3>
              <p>
                Rdzeń CAD jest pluginowy — instalacje to pierwsza wertykała. Droga rozwoju: desktop →
                SaaS → iPad; w planie wnętrza i architektura.
              </p>
            </div>
          </div>
          <p className="demo-hint" style={{ marginTop: '1.25rem' }}>
            Status: pilot MVP (LAN + CCTV) gotowy i zwalidowany na realnych, zanonimizowanych
            projektach — dostępny jako instalator Windows oraz interaktywne demo poniżej. Software
            wspomaga projektanta z uprawnieniami (PIIB), nie zastępując jego podpisu.
          </p>
        </div>
      </section>

      <section className="block" id="problem">
        <div className="wrap">
          <h2 className="section-title">Dziś projekt instalacji to żonglerka narzędziami</h2>
          <p className="section-sub">
            Rysunek w jednym programie, zestawienie materiału ręcznie w Excelu, kosztorys w
            kolejnym, a zgodność z normami „na pamięć". Każda zmiana = przeklejanie i błędy.
          </p>
          <div className="grid">
            <div className="card">
              <div className="ico">🧩</div>
              <h3>Rozproszone dane</h3>
              <p>Rzut, materiały, kosztorys i normy żyją w osobnych plikach i nie wiedzą o sobie.</p>
            </div>
            <div className="card">
              <div className="ico">⏱️</div>
              <h3>Czasochłonność</h3>
              <p>Liczenie długości tras, ilości punktów i przedmiaru ręcznie pochłania godziny.</p>
            </div>
            <div className="card">
              <div className="ico">⚠️</div>
              <h3>Ryzyko błędu</h3>
              <p>Brak walidacji norm (dł. kanału LAN, DORI dla CCTV) wychodzi dopiero na budowie.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="block" id="jak">
        <div className="wrap">
          <h2 className="section-title">Jak to działa</h2>
          <p className="section-sub">
            Wspólny model danych spina rysunek, instalacje, normy i kosztorys. Zmiana w jednym
            miejscu propaguje się wszędzie.
          </p>
          <div className="steps">
            <div className="step">
              <h3>Import rzutu</h3>
              <p>Wczytujesz DXF; aplikacja rozpoznaje warstwy i automatycznie wykrywa pomieszczenia.</p>
            </div>
            <div className="step">
              <h3>Naniesienie instalacji</h3>
              <p>Z palety stawiasz punkty (gniazda, kamery), prowadzisz trasy — długości liczą się same.</p>
            </div>
            <div className="step">
              <h3>Walidacja norm</h3>
              <p>Silnik reguł sprawdza zgodność z PN-EN i podaje odnośnik do punktu normy.</p>
            </div>
            <div className="step">
              <h3>BOM i kosztorys</h3>
              <p>Z modelu powstaje zestawienie materiału i kosztorys; eksport do PDF/XLS/Word/DXF.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="block" id="demo">
        <div className="wrap">
          <h2 className="section-title">Interaktywne demo — auto-projekt LAN + CCTV na rzucie</h2>
          <p className="section-sub">
            Rzut wczytany z DXF tym samym silnikiem co aplikacja desktop; pomieszczenia wykryte
            automatycznie. Urządzenia rozmieszczone funkcją <strong>auto-projekt</strong> wg reguł
            (1 gniazdo / 10 m², kamera, Access Point). Filtruj systemy, przeciągaj, przybliżaj kółkiem,
            najedź na pomieszczenie.
          </p>
          <div className="demo-frame">
            <div className="demo-bar">
              <span>
                sample-floor.dxf · <span className="pill">{sample.spaces.length} pomieszczeń</span>{' '}
                <span className="pill">{totalArea.toFixed(1)} m²</span>{' '}
                <span className="pill">{demoDevices.length} urządzeń (auto)</span>
                {hovered && (
                  <strong style={{ color: 'var(--accent)', marginLeft: 8 }}>
                    {hovered.name} — {(hovered.area / 1_000_000).toFixed(1)} m²
                  </strong>
                )}
              </span>
              <span className="sysfilter">
                {DEMO_SYS.map((s) => {
                  const n = DEMO_DEVICES.filter((d) => d.system === s.key).length
                  if (!n) return null
                  const off = hiddenSys.has(s.key)
                  return (
                    <button
                      key={s.key}
                      className={`sys${off ? ' off' : ''}`}
                      onClick={() => toggleDemoSys(s.key)}
                      title={off ? 'Pokaż' : 'Ukryj'}
                    >
                      <i style={{ background: s.dot }} /> {s.label} · {n}
                    </button>
                  )
                })}
              </span>
            </div>
            <CadViewer
              doc={sample.doc}
              spaces={sample.spaces}
              devices={[...demoDevices, ...DEMO_RACK_MARK]}
              routes={demoRoutes}
              layerVisibility={DEMO_LAYER_VIS}
              onHoverSpace={setHovered}
              className="demo-canvas"
            />
          </div>
          <p className="demo-hint">
            Linie to trasy kablowe (home-run) zbiegające do szafy IDF w serwerowni — tu uproszczone;
            w aplikacji desktop liczy je algorytm A* omijający ściany. Auto-projekt to start
            („mieszany"): projektant koryguje rozmieszczenie, a wytyczne klienta nadpisują reguły.
            Dalej: walidacja norm, BOM, kosztorys i eksport DXF/XLSX.
          </p>
        </div>
      </section>

      <ClientDemo />

      <section className="block" id="systemy">
        <div className="wrap">
          <h2 className="section-title">Systemy instalacji</h2>
          <p className="section-sub">
            Rdzeń CAD jest generyczny; instalacje to pierwsza wertykała. Pilot obejmuje LAN i CCTV,
            kolejne systemy dochodzą jako wtyczki — bez przebudowy aplikacji.
          </p>
          <div className="systems">
            {SYSTEMS.map((s) => (
              <span key={s.key} className={`sys${s.live ? ' live' : ''}`}>
                {s.live ? '● ' : '○ '}
                {s.key}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="block" id="roadmapa">
        <div className="wrap">
          <h2 className="section-title">Roadmapa</h2>
          <p className="section-sub">
            Kamień milowy komercyjny: koniec fazy F3 — pierwsza pełna oferta wygenerowana z rzutu
            DXF u firmy-pilota.
          </p>
          <div className="road">
            {ROADMAP.map((r) => (
              <div key={r.ph} className={`row${r.done ? ' done' : ''}`}>
                <div className="ph">
                  {r.ph} {r.done ? '✓' : ''}
                </div>
                <div>{r.t}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="block" id="kontakt">
        <div className="wrap">
          <h2 className="section-title">Porozmawiajmy o wdrożeniu</h2>
          <p className="section-sub">
            Szukamy firmy-pilota (instalacje niskoprądowe / elektryka), z którą dopracujemy import
            realnych rzutów i eksport kosztorysu w używanym formacie.
          </p>
          <div className="legal">
            <p style={{ marginTop: 0 }}>
              <strong style={{ color: 'var(--text)' }}>Zasada prawna:</strong> oprogramowanie
              wspomaga projektanta — <em>nie podpisuje ani nie autoryzuje projektu</em>.
              Dokumentację zatwierdza projektant z uprawnieniami budowlanymi (PIIB); dokument
              zawiera pola projektanta i miejsce na podpis.
            </p>
            <p style={{ marginBottom: 0 }}>
              Kontakt: <a href="mailto:mpasterczyk@gmail.com">mpasterczyk@gmail.com</a>
            </p>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          Infra Design · Pilot 1.0 · {new Date().getFullYear()} · The Best Agency
        </div>
      </footer>
    </>
  )
}
