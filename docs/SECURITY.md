# Bezpieczeństwo — Infra Design (desktop)

Aplikacja przetwarza poufne pliki klientów (rzuty LAN/CCTV objęte NDA). Model wdrożenia:
**desktop-local** — pliki klienta **nigdy nie opuszczają komputera** (brak chmury, backendu,
uploadu). Użytkownicy: właściciel/zespół. To celowo minimalizuje powierzchnię ataku.

## Model zagrożeń i kontrole

| Zagrożenie | Kontrola | Gdzie |
|---|---|---|
| Path traversal / odczyt-zapis dowolnego pliku przez sidecar | Walidacja ścieżek (allowlista, resolve, .dxf, limit 200 MB) + autoryzacja w Main (vouching plików z dialogu) | `sidecar/geometry/safepath.py`, `src/main/paths.ts` |
| Wyciek projektów przy kradzieży dysku/pliku | Szyfrowanie at-rest AES-256-GCM, klucz z hasła (scrypt), HKDF per-plik | `src/main/crypto/container.ts`, `keystore.ts` |
| Nieautoryzowany dostęp do aplikacji | Brama hasła (logowanie); klucz tylko w procesie głównym; IPC zablokowane do odblokowania | `keystore.ts`, `src/renderer/src/components/Gate.tsx`, strażnik w `src/main/index.ts` |
| Złośliwa/uszkodzona paczka `.infra` (XSS, OOM) | Walidacja struktury + limity rozmiarów + skończoność geometrii | `src/domain/model/validate.ts` |
| Ucieczka z renderera (XSS → Node) | `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, wąskie `window.infra` | `src/main/index.ts`, `src/preload/index.ts` |
| Wyciek do sieci / okna-skoczki | Blokada `will-navigate`/`window-open`/`webview`, CSP (`script-src 'self'`, `connect-src 'self'`, `object-src/base-uri/form-action 'none'`) | `src/main/index.ts`, `src/renderer/index.html` |
| Wyciek danych klienta do repo Git | `.gitignore` (pliki klienta) + pre-commit hook + wymuszona anonimizacja `bake` | `.gitignore`, `.git/hooks/pre-commit`, `scripts/bake_web_data.py` |

## Brama hasła (logowanie)
- Pierwsze uruchomienie: ustawienie hasła (min. 8 znaków). Hasło → klucz główny przez **scrypt**
  (N=2^15, r=8, p=1; ~140 ms). Na dysku tylko sól + weryfikator (HMAC klucza), nigdy sam
  klucz/hasło. Plik: `userData/keyfile.json`.
- **Utrata hasła = brak dostępu do zaszyfrowanych projektów** (brak odzyskiwania — świadomy kompromis
  dla danych NDA).
- Projekty `.infra` zapisane przed wdrożeniem szyfrowania (jawny SQLite) wczytują się nadal
  (`migratedFromPlain`) — ponowny zapis je szyfruje.

## Czego świadomie NIE ma (poza zakresem desktop-local)
Chmura/backend/upload, multi-tenant, RODO/DPA jako processor, code signing/auto-update, otwarta
rejestracja. Wraca dopiero, jeśli kiedyś wejdziemy w SaaS (faza F6).

## Dług bezpieczeństwa (do zrobienia)
- „Zapamiętaj na urządzeniu" (Electron `safeStorage`/DPAPI) + auto-lock po bezczynności.
- Zdjęcie `'unsafe-inline'` ze `style-src` (po teście PixiJS).
- `sidecar/requirements.lock` (hash-pinning), `npm audit` w CI, skan sekretów w CI.
- Code signing (Authenticode) przy dystrybucji.

## Weryfikacja
- `npm run typecheck && npm run lint && npm run test` (vitest), `pytest sidecar/tests`.
- Ręcznie: start → brama (setup/unlock) → import DXF → zapis `.infra` (plik zaczyna się od `INFRA1`,
  nie „SQLite format 3”) → restart → unlock → projekt się otwiera.
