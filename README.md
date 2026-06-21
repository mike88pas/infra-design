# Infra Design

Desktopowe (później iPad) oprogramowanie CAD do **projektowania instalacji budynkowych**
dla deweloperów, projektantów i instalatorów.

Wejście: **rzut budynku DXF** + lista instalacji. Wyjście: naniesione elementy na rzut,
schematy, widoki szaf rack/rozdzielni, **zestawienie materiałowe (BOM)**, **kosztorys
inwestorski**, **projekt wykonawczy**. Eksport: DWG / PDF / DXF / Word / XLS.

Systemy docelowe: PPOŻ/SAP, DSO, okablowanie strukturalne, SSWiN, kontrola dostępu, CCTV,
trasy kablowe, instalacje elektryczne, automatyka budynkowa. **Pilot MVP: okablowanie (LAN) + CCTV.**

> Narzędzie **wspomagające projektanta z uprawnieniami** — software nie podpisuje ani nie
> autoryzuje projektu. Dokument zawiera pola projektanta i miejsce na podpis.

## Stack

- **Desktop:** Electron + electron-vite + React + TypeScript + Tailwind
- **Render 2D (F1+):** PixiJS (WebGL) + LOD + viewport culling + RBush
- **Geometria (sidecar Python):** ezdxf (DXF) + Shapely (polygonize) + A* (auto-routing tras)
- **Dane:** paczka `.infra` = SQLite (sql.js, WASM — bez natywnej kompilacji)
- **Normy:** deklaratywny silnik reguł (mini-DSL, YAML) — PN-EN 50173, 62676, 50131, 60839-11, 61537, PN-HD 60364…

## Architektura (skrót)

```
Renderer (React + Generic CAD Core + plugins wertykał)
   │ IPC (contextBridge)
Main (Electron, Node) — okno, .infra, nadzór sidecara
   │ stdio JSON
Sidecar (Python) — ezdxf · Shapely · A* · eksport
```

Rdzeń CAD jest **generyczny**; instalacje to pierwsza wertykała (plugin). Przyszłe wertykały:
projektowanie wnętrz, architektura.

## Uruchomienie (dev)

```bash
npm install
# Sidecar (osobny venv — patrz sidecar/README.md):
python -m venv sidecar/.venv && sidecar/.venv/Scripts/activate && pip install -r sidecar/requirements.txt
npm run dev
```

## Skrypty

| Skrypt | Opis |
|---|---|
| `npm run dev` | Electron + Vite (HMR) |
| `npm run build` | Build produkcyjny |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test` | Vitest |

## Status

**F0 — scaffold.** App startuje, robi handshake z sidecarem (wersja ezdxf), tworzy/zapisuje/
wczytuje pustą paczkę `.infra`. Roadmapa: [docs/ROADMAP.md](docs/ROADMAP.md).
