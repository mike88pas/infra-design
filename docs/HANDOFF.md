# HANDOFF — stan projektu Infra Design

Aktualizacja: 2026-07-02 (po iteracji „launch + upgrade F4"). Komunikacja: **polski**.
Punkt wejścia dla kolejnej instancji: `CLAUDE.md` → `docs/ROADMAP.md` → ten plik.

## Stan: LAUNCH DONE ✅
- **Testy:** 119 vitest + 28 pytest — zielone. Typecheck + lint czyste.
- **Instalator:** `~/Downloads/Infra Design Setup 1.0.0.exe` — świeży, spakowany sidecar
  zweryfikowany smoke-testem (ping, routing 0 prostych/0 ukośnych, koryta w DXF).
- **Web demo:** wdrożone na https://infra-design-app.web.app (zrzut z produkcji czysty).

## Co weszło w tej iteracji
1. **Routing przez drzwi + ortogonalny** (`sidecar/geometry/server.py`): `doorLayers`/`doorClear`
   przebijają otwory w rastrze ścian; `_dijkstra_multi(ortho=True)` 4-sąsiedztwo +
   `_simplify_cells` (polilinie tylko z załamaniami). Łańcuch TS: preload→main→sidecar.ts→
   importProfile (`doorLayers: ['DOOR','DRZWI']`)→App. Fixture `sample_office_clean.dxf`
   przegenerowany (8 pokoi + korytarz, drzwi do huba) — 9/9 tras astar.
2. **Guard sidecara** (`scripts/build_sidecar.mjs`): `npm run dist` przebudowuje PyInstaller
   gdy `server.py` nowszy niż binarka. To zamyka root cause „zamrożonego server.exe"
   (zmiany Pythona nie trafiały do .exe).
3. **Rysunek PW** (`src/core/cad/CadScene.ts`): symbole CAD (gniazdo/AP/kamera+FOV),
   koryto-styl tras, legenda PL, ramka + tabelka PN (`SheetInfo`, skala z kreatora).
4. **Koryta policzone i widoczne**: `deriveTrays` (backbone ≥2 kable, dedup Q-krokami,
   szerokość wg wypełnienia PN-EN 61537) → BOM/kosztorys („Pasywne", KCJ100/200) → render
   (`RenderTray`, pasy grafitowe + etykieta K100) → **eksport DXF** (warstwa `INSTAL-KORYTA`,
   LWPOLYLINE `const_width` + etykieta). UWAGA jednostki: `Tray.path` w mm; render/eksport
   dzielą przez `unitMm` (`Drawing.transform[0]`).
5. **F4 DORI end-to-end (PN-EN 62676-4)**: `cctvCoverage.ts` — `worstCasePxm` (px/m w
   najdalszym wierzchołku pokoju) + `applyDoriProps` (wzbogaca kamery o mp/fov/doriTarget/
   doriResolutionPxM przed audytem; bez tego autodesign daje `props={auto:true}` i reguła
   porównuje z undefined). Reguła `cctv.dori.target` z klauzulą exempt (`==0` = brak danych).
   Progi: dome 62,5 (observation), bullet 125 (recognition). Render stref (`RenderCoverage`,
   4 kolory, dedup identycznych obrysów po przycięciu do pokoju). Web demo pokazuje strefy +
   filtr „Pokrycie DORI" i „Koryta".
6. **Kreator**: pola „Warstwy drzwi" i „Skala rysunku (tabelka PN)".
7. **Higiena NDA**: token klienta usunięty z komentarza testu; marki producentów usunięte z
   dokumentacji repo (zostały TYLKO jako dane funkcjonalne w `catalog.ts` + test — decyzja
   o genericyzacji katalogu wciąż po stronie usera).
8. **`npm run test:py`** — pytest sidecara (28 testów, w tym `test_routing.py`: drzwi + ortho).

## Znane ograniczenia / następne kroki
- `clipToConvex` (Sutherland-Hodgman) zawyża pokrycie w pokojach wklęsłych (L-kształt) —
  MVP świadome; docelowo raycast do ścian.
- Pokrycie DORI liczone dystansowo (worst-case wierzchołek), kątowo liberalnie — reguła
  pokrycia kątowego to przyszły krok.
- Marki w `catalog.ts` — decyzja usera pending (dane funkcjonalne, nie copy).
- Dalej wg ROADMAP: eksport PDF, XREF podkładu, ręczne przesuwanie urządzeń, kategoria
  Telefony, F5 (pełny silnik norm z YAML), F3 pilot komercyjny.

## Weryfikacja (jak sprawdzić po zmianach)
- `npm run typecheck && npm run lint && npm run test && npm run test:py`
- Smoke spakowanego sidecara: `dist/win-unpacked/resources/sidecar/server.exe` ←
  polygonize(`sample_office_clean.dxf`, A-WALL)=9 pokoi → route_cables(doorLayers=["DOOR"])
  → straight==0 i zero ukośnych segmentów; export_dxf z trays → plik zawiera `INSTAL-KORYTA`.
- Zrzut web: Playwright (`--use-gl=angle --use-angle=swiftshader`) na `.demo-canvas`.
- **NDA przed commitem:** `git grep -iE "teatr|rzeszow|uniwersytet|2203-ar"` → pusto;
  nigdy nie commituj `*.dxf/*.dwg/*.infra` klienta (fixture'y syntetyczne są OK).
