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
**F0 scaffold.** Roadmapa: `docs/ROADMAP.md`. Następne: F1 (import DXF + render PixiJS + polygonize).
