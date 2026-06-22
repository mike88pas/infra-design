# Web demo (dla klienta)

Landing + osadzone interaktywne demo renderera CAD. Pokazuje klientowi „co mamy" bez instalacji
aplikacji desktop. **Live: https://infra-design-app.web.app** (Firebase Hosting, projekt
`infra-design-app`, konto mpasterczyk@gmail.com).

## Architektura
To osobny **webowy target** w `web/` (Vite + React + czysty CSS), który **reużywa rdzeń CAD**
(`@core/cad`) i model (`@domain`) z aplikacji desktop przez aliasy w `web/vite.config.ts` —
zero duplikacji ciężkiej logiki renderera.

Ograniczenie: renderer PixiJS działa w przeglądarce, ale **sidecar Python (ezdxf/Shapely) — nie**.
Dlatego geometria rzutu jest **zapieczona** offline do `web/src/data/sample-floor.json`
(`{ doc, spaces }`). Nazwy pomieszczeń pochodzą z etykiet TEXT w DXF (dopasowanie punkt-w-wieloboku).

## Pliki
| Co | Gdzie |
|---|---|
| Vite config (aliasy, base) | `web/vite.config.ts` |
| Strona (landing + demo) | `web/src/App.tsx`, `web/src/styles.css` |
| Zapieczone dane rzutu | `web/src/data/sample-floor.json` |
| Generator danych (bake) | `scripts/bake_web_data.py` |
| Generator fixture DXF | `scripts/make_sample_dxf.py` |
| Weryfikacja headless | `scripts/verify_demo.mjs` (Playwright/Chromium) |
| Konfiguracja hostingu | `firebase.json`, `.firebaserc` |

## Pipeline aktualizacji
```bash
npm run web:bake     # sidecar → web/src/data/sample-floor.json (wymaga venv sidecara)
npm run web:build    # Vite → web/dist
firebase deploy --only hosting --project infra-design-app
# weryfikacja:
node scripts/verify_demo.mjs https://infra-design-app.web.app/
```

## Do zrobienia później
- Podpiąć własną domenę (Hosting → Add custom domain → rekordy DNS).
- Wymienić syntetyczny rzut na realny DXF firmy-pilota (po otrzymaniu próbki).
- Skasować pusty stray-projekt Firebase `infra-design-demo` (jeśli niepotrzebny).
