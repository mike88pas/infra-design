# Infra Design — handoff dla nowej instancji VS Code

Ten plik = punkt startu dla osoby/instancji przejmującej projekt. Czytaj w kolejności:
`CLAUDE.md` → `docs/ROADMAP.md` → `docs/SYSTEMS.md` → ten plik.

## Stan na teraz (F1 DONE, F2 DONE, bezpieczeństwo utwardzone)
- Repo: **github.com/mike88pas/infra-design** (PRYWATNE), branch `main`, CI Windows aktywny.
- **F1 ukończone**: sidecar `import_dxf`/`polygonize` (ezdxf 1.4.4 + Shapely), renderer
  PixiJS w `src/core/cad/` (pan/zoom, warstwy, RBush, LOD, hit-test), mapowanie warstw, kalibracja.
- **F2 ukończone** (`src/domain/installations/`): w obie strony —
  - **Ekstrakcja** z realnego rzutu (`PST_*` → urządzenia → BOM → kosztorys → audyt norm),
  - **Forward-design** „od zera" (`autodesign.ts`: z wykazu pomieszczeń generuje LAN+CCTV),
  - **Realny katalog** (Fibrain/Ubiquiti/Hikvision/ZPAS), walidacja PN-EN 50173, **eksport DXF**.
  - Kreator importu (`ImportWizard.tsx`) ma tryb **extract / autodesign**.
- **BEZPIECZEŃSTWO (produkcja desktop-local, NDA)** — patrz `docs/SECURITY.md`:
  - Brama hasła (scrypt) + szyfrowanie `.infra` at-rest (AES-256-GCM, `src/main/crypto/`).
  - Walidacja ścieżek sidecara (`safepath.py` + `paths.ts`) i paczki (`validate.ts`).
  - `sandbox:true`, CSP, blokada nawigacji; strażnik repo (`.gitignore` + pre-commit).
  - **Pliki klienta NIGDY nie opuszczają komputera. NIGDY nie commituj *.dxf/*.dwg/*.infra.**
- **Demo webowe** (publiczne, ZANONIMIZOWANE): `web/` → **https://infra-design-app.web.app**
  (Firebase Hosting `infra-design-app`). Szczegóły: `docs/WEB_DEMO.md`.
- Pilot MVP = **LAN + CCTV**. Zasada twarda: software **wspomaga projektanta** (nie podpisuje).

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
**Pierwszy start = brama hasła.** Przy pierwszym uruchomieniu aplikacja poprosi o **ustawienie
hasła** (min. 8 znaków). Hasło szyfruje wszystkie projekty `.infra` — **nie ma odzyskiwania**.
Kolejne starty: ekran odblokowania. (Plik `userData/keyfile.json` = sól + weryfikator, NIGDY klucz.)

Sanity check: w aplikacji „Test sidecara (ping)" → powinno pokazać `ezdxf x.y.z`.
„Nowy projekt" → „Zapisz" → „Otwórz" = round-trip `.infra` (zapisany plik zaczyna się od `INFRA1`).

## ▶ Projektowanie NOWEGO pliku klienta (workflow „od zera")
Klient przysłał rzut + wytyczne (LAN+CCTV, reguły mieszane, rezultat: Rysunki PW + BOM + kosztorys).
Tor pracy w aplikacji desktop:
1. **Plik klienta zostaje lokalnie** — skopiuj DXF/DWG do katalogu projektu (np. `~/Documents/InfraDesign/`).
   DWG → DXF: ODA File Converter (`ACAD2018`/`DXF`); patrz `[[client-file-teatr-rzeszow]]` w pamięci.
2. **Import** → „Importuj projekt + instalacje (kreator)" → wybierz tryb:
   - **autodesign** („od zera"): z wykazu pomieszczeń stawia urządzenia wg reguł (1 gniazdo/10 m²,
     AP≥30 m², kamera≥40 m²), reguły nadpisywalne wytycznymi klienta;
   - **extract**: jeśli klient dał już naniesione `PST_*`.
3. Pipeline liczy: pomieszczenia → urządzenia → trasy A* → **BOM** → **kosztorys** → **audyt norm**.
4. **Eksport DXF** („Eksportuj rysunek DXF") = overlay instalacji (docelowo XREF na podkład).
5. Zapis projektu → `.infra` (zaszyfrowany). 
Kod: `src/renderer/src/App.tsx` (runImport), `src/domain/installations/{autodesign,fromDxf,routing,bom,cost}.ts`,
`src/domain/dxf/{importProfile,systemMapping,rooms}.ts`. Sidecar: `extract_rooms/extract_devices/route_cables/export_dxf`.

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

## Następny krok: pełne „Rysunki PW" (po pierwszym realnym projekcie)
Styk F1↔F2 ZROBIONY (ekstrakcja + forward-design + trasy + BOM + kosztorys + audyt + eksport DXF).
Do pełnej dokumentacji wykonawczej brakuje jeszcze: bloki symboli zamiast prostych kształtów,
ramka/tabelka rysunkowa wg PN, XREF podkładu architektonicznego, ręczne przesuwanie urządzeń na
canvas, eksport PDF, oraz DORI (model pokrycia kamer CCTV — F4). Priorytety ustawić po pierwszym
realnym projekcie klienta.

## Dalej: F2 LAN+BOM → F3 kosztorys+eksport (PILOT) → F4 CCTV+rack → F5 normy
Pełna roadmapa: `docs/ROADMAP.md`. Plan każdego kolejnego systemu (trasy, SSWiN, KD, elektryka,
SAP, DSO, BMS) z typami urządzeń, normami, kalkulatorami i schematami: `docs/SYSTEMS.md`.

## Konwencje (trzymać!)
- Aliasy `@domain`/`@core`/`@renderer` zsynchronizowane w `tsconfig.json` + `electron.vite.config.ts` + `vitest.config.ts`.
- Reguły norm = DANE (YAML/AST), NIE kod. Nowa norma = plik. Nowe obliczenie = funkcja w `calculators.ts`.
- Renderer izolowany (`contextIsolation`, brak `nodeIntegration`) — komunikacja tylko przez `window.infra` (preload).
- stdout sidecara = TYLKO protokół JSON; diagnostyka na stderr.
- Przed commitem: `npm run typecheck && npm run lint && npm run test && npm run build`.
- **NDA:** nigdy nie commituj plików klienta (`*.dxf/*.dwg/*.infra/*.ath`) — pilnuje tego `.gitignore`
  + pre-commit hook (`.git/hooks/pre-commit`, niewersjonowany — odtwórz po klonie z `docs/SECURITY.md`).
- Pliki klienta trzymaj poza repo (np. `~/Documents/InfraDesign/`), nie w drzewie projektu.

## Potrzebne od klienta
- ✅ Realny DXF (Teatr Rzeszów) — był; teraz drugi projekt **do zaprojektowania od zera**.
- Przykładowy **plik kosztorysu ATH** (reverse-engineering eksportu) + program (Norma/Zuzia/Rodos).
- Potwierdzenie **katalogów/producentów** (mamy realne ceny Fibrain/Ubiquiti/Hikvision/ZPAS).
