# Infra Design — handoff dla nowej instancji VS Code

Ten plik = punkt startu dla osoby/instancji przejmującej projekt. Czytaj w kolejności:
`CLAUDE.md` → `docs/ROADMAP.md` → `docs/SYSTEMS.md` → ten plik.

## Stan na teraz (F1 DONE, F2 w toku)
- Repo: **github.com/mike88pas/infra-design**, branch `main`, CI Windows aktywny.
- **F1 ukończone**: sidecar `import_dxf`/`polygonize` (ezdxf 1.4.4 + Shapely), renderer
  PixiJS w `src/core/cad/` (pan/zoom, warstwy, RBush, LOD, hit-test), mapowanie warstw
  (heurystyka nazw), kalibracja skali. Testy: pytest sidecara + kontrakt mostu TS↔Python.
- **F2 ruszyło równolegle** (`src/domain/installations/`: catalog/bom/cost) — patrz `docs/WORKSTREAMS.md`.
- **Demo dla klienta live**: `web/` (reużywa `@core/cad`) → **https://infra-design-app.web.app**
  (Firebase Hosting, projekt `infra-design-app`). Szczegóły: `docs/WEB_DEMO.md`.
- Pilot MVP = **LAN + CCTV**. Rdzeń CAD generyczny, instalacje jako plugin.
- Zasada twarda: software **wspomaga projektanta** (nie podpisuje projektu).

## Pierwsze uruchomienie w nowej instancji
```bash
git clone https://github.com/mike88pas/infra-design.git
cd infra-design
npm install
# sidecar (osobny venv):
python -m venv sidecar/.venv
sidecar/.venv/Scripts/activate              # Windows
pip install -r sidecar/requirements.txt
# wskaż interpreter sidecara i odpal:
$env:INFRA_PYTHON = "$PWD\sidecar\.venv\Scripts\python.exe"   # PowerShell
npm run dev
```
Sanity check: w aplikacji „Test sidecara (ping)" → powinno pokazać `ezdxf x.y.z`.
„Nowy projekt" → „Zapisz" → „Otwórz" = round-trip `.infra`.

## Mapa kodu (gdzie co jest)
| Obszar | Plik |
|---|---|
| Model danych (kontrakt front↔sidecar, `SCHEMA_VERSION`) | `src/domain/model/schema.ts` |
| Silnik norm (interpreter DSL, bez eval) | `src/domain/norms/engine.ts` |
| Kalkulatory normowe (dori/voltageDrop/fillRatio…) | `src/domain/norms/calculators.ts` |
| RuleSety norm (dane, YAML) | `rules/*.yaml` |
| Rejestr wertykał/pluginów | `src/core/plugins/registry.ts` |
| Electron main (IPC, okno, nadzór sidecara) | `src/main/index.ts` |
| Paczka `.infra` (SQLite via sql.js) | `src/main/project.ts` |
| Most do sidecara (stdio JSON) | `src/main/sidecar.ts` |
| Bezpieczny most IPC | `src/preload/index.ts` |
| UI | `src/renderer/src/App.tsx` |
| Sidecar geometrii (Python) | `sidecar/geometry/server.py` |

## F1 — ZROBIONE (import DXF + render + pomieszczenia)

Zrealizowane (referencja, gdyby trzeba wrócić). Kolejne kroki — patrz „Następny krok" niżej.

1. **Sidecar `import_dxf`** — w `server.py` dodaj metodę: ezdxf wczytuje DXF, zwraca warstwy +
   encje (LINE/LWPOLYLINE/INSERT) + bbox w lekkim JSON. Duże pliki → `ezdxf.iterdxf` przy potrzebie.
2. **Sidecar `polygonize`** — Shapely: z segmentów ścian buduje zamknięte pomieszczenia → `Space[]`.
   Obsłuż „brudny" DXF (niedomknięte narożniki) tolerancją snap.
3. **Renderer PixiJS** — `src/core/cad/`: scena WebGL, warstwy on/off, pan/zoom, **RBush** do cullingu/hit-testu,
   LOD (upraszczanie geometrii przy oddaleniu). Limit encji na ekran.
4. **Kalibracja skali** — narzędzie „wskaż dwa punkty + podaj wymiar" → `Drawing.transform` (Matrix2D).
5. **Mapowanie warstw** — UI: użytkownik wskazuje, która warstwa = ściany / drzwi / pomieszczenia
   (heurystyka po nazwach jako podpowiedź). Zapisuj profil mapowań per biuro (reużywalny).
6. **Testy** — kontraktowe IPC (TS↔Python) na `import_dxf`/`polygonize`; przykładowy DXF w `tests/fixtures/`.

Rozszerz model w `schema.ts` ostrożnie; przy zmianie łamiącej bump `SCHEMA_VERSION` + migracja w `project.ts`.

## Następny krok: punkt styku F1↔F2
F1 daje `Space[]` z DXF; F2 buduje katalog/BOM/kosztorys. Integracja: użytkownik nanosi
`Device[]` w wykrytych `Space`, prowadzi `CableRoute[]`, silnik liczy `BomItem[]`→`CostItem[]`.
Oba lany dojrzewały niezależnie — to mały krok wiążący (patrz `docs/WORKSTREAMS.md`).

## Dalej: F2 LAN+BOM → F3 kosztorys+eksport (PILOT) → F4 CCTV+rack → F5 normy
Pełna roadmapa: `docs/ROADMAP.md`. Plan każdego kolejnego systemu (trasy, SSWiN, KD, elektryka,
SAP, DSO, BMS) z typami urządzeń, normami, kalkulatorami i schematami: `docs/SYSTEMS.md`.

## Konwencje (trzymać!)
- Aliasy `@domain`/`@core`/`@renderer` zsynchronizowane w `tsconfig.json` + `electron.vite.config.ts` + `vitest.config.ts`.
- Reguły norm = DANE (YAML/AST), NIE kod. Nowa norma = plik. Nowe obliczenie = funkcja w `calculators.ts`.
- Renderer izolowany (`contextIsolation`, brak `nodeIntegration`) — komunikacja tylko przez `window.infra` (preload).
- stdout sidecara = TYLKO protokół JSON; diagnostyka na stderr.
- Przed commitem: `npm run typecheck && npm run lint && npm run test && npm run build`.

## Potrzebne od klienta (blokuje jakość F1)
- **Próbka realnego DXF** firmy-pilota (rzut) — determinuje heurystyki mapowania warstw.
- Przykładowy **plik kosztorysu ATH** (do reverse-engineeringu eksportu) + którego programu używają (Norma/Zuzia/Rodos).
- Lista **katalogów/producentów** urządzeń, których używają (do biblioteki `CatalogItem`).
- Odpowiedzi z **ankiety discovery** (`~/infra-design-presale/` — generator Google Forms).
