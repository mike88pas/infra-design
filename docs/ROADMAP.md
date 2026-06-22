# Infra Design — Roadmapa

Rdzeń CAD generyczny; instalacje = pierwsza wertykała. Pilot MVP: **LAN + CCTV**.
Kamień milowy komercyjny = koniec **F3** (pierwsza pełna oferta z rzutu DXF u firmy-pilota).

| Faza | Zakres | Wynik testowalny |
|---|---|---|
| **F0 Scaffold** ✅ | Electron + React/TS + sidecar Python (handshake), CI Windows, model danych v1, paczka `.infra` (SQLite) | App startuje, sidecar odpowiada, projekt round-trip |
| **F1 DXF + Render** ✅ | ezdxf import, PixiJS renderer + LOD + RBush, warstwy, viewport, kalibracja skali, Shapely polygonize → Space | Wczytanie DXF, płynny pan/zoom, wykryte pomieszczenia |
| **F2 LAN + BOM** | Generic CAD core + PluginRegistry; plugin LAN: palety, punkty, naniesienie, trasy, długości, BOM | Projekt LAN z realnym BOM |
| **F3 Kosztorys + Eksport** | BOM→KNR, import cennika DBF, kosztorys; eksport PDF/XLS/Word/DXF; pola projektanta | **Pilot**: pełna oferta z DXF |
| **F4 CCTV + Rack** | plugin CCTV (FOV/DORI), auto-routing A*, widok szafy rack 2D, schemat | Projekt CCTV + rack + schemat |
| **F5 Walidacja norm** | NormEngine + DSL + CalculatorRegistry; RuleSety 62676/DORI, 50173/50174, 61537; panel audytu | Audyt normowy z odnośnikami |
| **F6 Chmura/Licencje** | API auth, licencje, sync, multi-tenant, storage EU, DPA art.28 | SaaS multi-tenant, RODO |
| **F7 iPad** | Capacitor/PWA na przenośnym rdzeniu TS+WebGL | App na iPad |
| **F8 Rozbudowa** | SAP/elektryka/DSO/SSWiN/KD/automatyka; 3D; DWG (ODA premium); wertykały wnętrza/architektura | Pełny produkt |

## Normy → silnik reguł (per system)
- **SAP** PN-EN 54 + CEN/TS 54-14 + dopuszczenia CNBOP-PIB-0015
- **DSO** PN-EN 54-16/-24, PN-EN 50849 (STI ≈ 0,45–0,5)
- **LAN** PN-EN 50173/50174 + ISO/IEC 11801 (kanał ≤ 90 m)
- **SSWiN** PN-EN 50131 (Grade 1–4)
- **KD** PN-EN 60839-11-1/-2 (klasy 1–4)
- **CCTV** PN-EN 62676 + DORI (25 / 62,5 / 125 / 250 px/m)
- **Elektryka** PN-HD 60364 (-4-41, -5-52, -6)
- **Trasy** PN-EN 61537 (wypełnienie ≤ ~40%)
- **Automatyka** PN-EN ISO 16484 + KNX + ISO 52120-1 (klasy A–D)

## Ramy prawne (PL)
- Prawo budowlane + rozp. formy projektu (PZT/PAB/**PT**); instalacje → projekt techniczny i wykonawczy.
- Software wspomaga; podpisuje projektant z uprawnieniami (PIIB).
- RODO: SaaS = procesor (DPA art. 28), hosting EU, ISO 27001. IP projektu po stronie użytkownika.
- Dokumentacja wykonawcza (Dz.U. 2021 poz. 2454): opis + rysunki + obliczenia + przedmiar + specyfikacje.
