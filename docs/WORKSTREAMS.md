# Infra Design — koordynacja równoległych instancji

Dwie instancje pracują równolegle. Aby się nie nadpisywać — podział „lanów" i własności plików.

## Instancja B — F1 (geometria / UI)
**Lane:** import DXF, render PixiJS, polygonize, mapowanie warstw, kalibracja skali.
**Pliki (własność B — instancja A nie edytuje):**
- `src/core/cad/**`
- `src/renderer/src/App.tsx` i UI rendererowe
- `src/main/index.ts`, `src/main/sidecar.ts`, `src/preload/index.ts`
- `sidecar/geometry/server.py`, `sidecar/tests/**`
- sekcje DXF w `src/domain/model/schema.ts` (DxfEntity/DxfDocument/PolygonizeResult)
- `src/domain/dxf/**`

## Instancja A — F2 (logika instalacji: LAN/CCTV → BOM → kosztorys)
**Lane:** katalog produktów, silnik BOM, silnik kosztorysu, definicje wertykały LAN/CCTV (pluginy), reguły norm (dane).
**Pliki (własność A — NOWE, instancja B nie edytuje):**
- `src/domain/installations/**` (catalog, bom, cost, lan, cctv)
- `src/domain/norms/**` (engine/calculators już są; A dokłada reguły)
- `rules/*.yaml`
- `tests/fixtures/**` (syntetyczne DXF), `docs/SYSTEMS.md`, `docs/NEXT_STEPS.md`

## Pliki współdzielone — koordynować przed edycją
- `src/domain/model/schema.ts` — sekcje **instalacji/BOM/kosztów** stabilne (F0). Zmiany łamiące → bump `SCHEMA_VERSION` + ping drugiej instancji.
- `src/core/plugins/registry.ts` — interfejs pluginów (stabilny).
- `package.json`, configi — uzgadniać.

## Punkt styku (gdzie F1 spotyka F2)
Po F1: `Space[]` z DXF → po F2: użytkownik nanosi `Device[]` w `Space`, prowadzi `CableRoute[]`,
silnik liczy `BomItem[]` → `CostItem[]`. Integracja = mały krok wiążący (oba lane gotowe niezależnie).

## Zasada
Tylko NOWE pliki w swoim lane; bez `git`/`npm install` w cudzym lane; testy uruchamiać celowane
(`npx vitest run src/domain/installations`), nie cały zestaw, gdy drugi lane jest w trakcie edycji.
