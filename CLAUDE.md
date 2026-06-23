# CLAUDE.md — Infra Design

Kontekst projektu dla Claude Code. Komunikacja: **polski**.

## Czym jest
Desktop (Electron, później iPad) CAD do projektowania **instalacji budynkowych**. Wejście: rzut
**DXF** + lista instalacji → naniesienie elementów, trasowanie kabli, walidacja norm → schematy,
szafy rack/rozdzielnie (2D), **BOM**, **kosztorys inwestorski**, **projekt wykonawczy**. Eksport:
DWG/PDF/DXF/Word/XLS. Systemy: PPOŻ/SAP, DSO, LAN, SSWiN, KD, CCTV, trasy, elektryka, automatyka.

**Pilot MVP = LAN + CCTV.** Rdzeń CAD generyczny → instalacje to pierwsza wertykała (plugin);
przyszłość: wnętrza, architektura.

**Zasada prawna (twarda):** software NIE podpisuje/NIE autoryzuje projektu — wspomaga projektanta
z uprawnieniami (PIIB). Dokument ma pola projektanta + miejsce na podpis.

## Architektura
```
Renderer (React + Generic CAD Core[@core] + plugins) ─IPC(contextBridge)→ Main(Electron/Node) ─stdio JSON→ Sidecar(Python)
```
- **Rdzeń:** `src/core/` (CAD core, `plugins/registry.ts`)
- **Domena:** `src/domain/model/schema.ts` (kontrakt + `SCHEMA_VERSION`), `src/domain/norms/` (silnik DSL + kalkulatory)
- **Main:** `src/main/` (`index.ts` IPC, `project.ts` paczka `.infra` przez sql.js, `sidecar.ts` most)
- **Preload:** `src/preload/index.ts` (`window.infra`)
- **Renderer:** `src/renderer/src/`
- **Sidecar:** `sidecar/geometry/server.py` (ezdxf/Shapely/A*) — protokół newline-delimited JSON

## Konwencje
- Aliasy TS: `@domain/*`, `@core/*`, `@renderer/*` (tsconfig + electron.vite.config + vitest.config — trzymać zsynchronizowane).
- Model danych to JEDNO źródło prawdy front↔sidecar; przy zmianie łamiącej bump `SCHEMA_VERSION`.
- Silnik norm: reguły to DANE (`rules/*.yaml`, AST `RuleExpr`), bez `eval`. Nowa norma = YAML; nowe obliczenie = funkcja w `calculators.ts`.
- Paczka `.infra` = SQLite (sql.js/WASM, bez natywnej kompilacji).
- Renderer izolowany (`contextIsolation`, brak `nodeIntegration`) — komunikacja tylko przez IPC.

## Komendy
`npm run dev` · `npm run build` · `npm run typecheck` · `npm run lint` · `npm run test`
Sidecar: patrz `sidecar/README.md` (venv + `INFRA_PYTHON` by wskazać interpreter).

## Status
**F1 DONE** (import DXF + render PixiJS + polygonize + mapowanie warstw + kalibracja).
**F2 DONE** (instalacje→trasy A*→BOM→kosztorys, `src/domain/installations/`) — w obie strony:
- **Ekstrakcja** z realnego rzutu (warstwy `PST_*` → urządzenia → BOM/kosztorys/audyt norm).
- **Forward-design** („od zera"): `autodesign.ts` z wykazu pomieszczeń generuje LAN+CCTV wg reguł
  (1 gniazdo/10 m², AP≥30 m², kamera≥40 m²) + szafa IDF; reguły nadpisywalne wytycznymi.
- **Realny katalog** producentów (FibrainDATA, Ubiquiti, Hikvision, ZPAS) z cenami PL netto.
- **Walidacja norm** w UI: PN-EN 50173 (kanał LAN ≤90 m). DORI → F4.
- **Eksport DXF** (`export_dxf`): symbole per system, trasy, legenda — overlay (docelowo XREF).

Kreator importu (`ImportWizard.tsx`) ma tryb **extract / autodesign**. Roadmapa: `docs/ROADMAP.md`.
Następne (pełne Rysunki PW): bloki symboli, ramka/tabelka PN, XREF podkładu, ręczne przesuwanie
urządzeń na canvas, eksport PDF, DORI (model pokrycia kamer, F4).

**Demo dla klienta:** webowy target `web/` (reużywa `@core/cad`) na
**https://infra-design-app.web.app** (Firebase Hosting, projekt `infra-design-app`). Pipeline:
`npm run web:bake && npm run web:build && firebase deploy --only hosting`. Szczegóły: `docs/WEB_DEMO.md`.
Sekcja „Realny projekt" liczy pipeline LIVE w przeglądarce na **zanonimizowanym** rzucie
(`bake_client(anonymize=True)` — nazwy pomieszczeń/warstw/atrybuty wyczyszczone; 0 danych klienta).
**Web = landing + demo (ekstrakcja+BOM+kosztorys+normy); pełny tryb projektowania od zera
i eksport DXF są w aplikacji desktop (Electron), nie na stronie.**
