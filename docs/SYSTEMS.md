# Infra Design — plan budowy systemów instalacji (per wertykała)

Rdzeń jest pluginowy: **dodanie nowego systemu = nowy `VerticalDef`/zestaw `DeviceTypeDef` +
`rules/*.yaml` + kalkulatory + szablon BOM/schematu. Zero zmian w rdzeniu CAD i w sidecarze.**
Ten dokument opisuje, jak dokładać każdy z 9 systemów po pilocie (LAN + CCTV).

## Przepis ogólny „nowy system" (powtarzalny dla każdego)

1. **Typy urządzeń** — dodaj `DeviceTypeDef[]` (`typeKey`, `system`, `label`, `defaultProps`, `symbol`)
   do plugina wertykały (`src/core/plugins/registry.ts` → rejestracja `VerticalDef`).
2. **Symbole** — SVG/geometria symbolu renderowana przez CAD core (warstwa symboli per system).
3. **Reguły norm** — `rules/<system>_<norma>.yaml` (AST `RuleExpr`); brakujące obliczenia →
   nowa funkcja w `src/domain/norms/calculators.ts`.
4. **Routing/trasy** — większość systemów dzieli wspólny model `CableRoute`/`Tray` (A* w sidecarze).
5. **BOM** — reguła agregacji `Device[]+CableRoute[] → BomItem[]` per system (katalog + długości).
6. **Schemat** — generator widoku logicznego (np. matryca sterowań SAP, schemat pionowy LAN, rack).
7. **Eksport** — mapowanie na adaptery PDF/DXF/XLS/Word (sidecar).
8. **Dokumentacja** — pola projektanta + odwołania normowe w opisie technicznym.

Kolejność wdrażania (po F3=LAN+kosztorys, F4=CCTV+rack, F5=normy) — wg wartości i ryzyka:

| Kolejność | System | Dlaczego tu | Ryzyko |
|---|---|---|---|
| 1 | **Trasy kablowe** (wspólne) | fundament pod wszystkie pozostałe systemy (korytka, wypełnienie) | niskie |
| 2 | **SSWiN** | prosty model (czujki+centrala+strefy), wysoka wartość | niskie |
| 3 | **Kontrola dostępu (KD)** | bliski SSWiN, współdzieli okablowanie/strefy | niskie |
| 4 | **Instalacje elektryczne** | rdzeń obliczeniowy, zasila wszystko; rozdzielnie | średnie (fizyka) |
| 5 | **PPOŻ / SAP** | safety-of-life, CNBOP, matryca sterowań | wysokie (prawne) |
| 6 | **DSO** | sprzężony z SAP, akustyka (STI) | wysokie |
| 7 | **Automatyka budynkowa (BMS)** | integruje pozostałe, KNX/BACnet | średnie/wysokie |

---

## 1. Trasy kablowe (wspólny fundament) — PN-EN 61537

- **Encje:** `Tray` (już w modelu) + `CableRoute.trayId`. Trasy są współdzielone przez wszystkie systemy.
- **typeKey:** `tray.ladder.200`, `tray.perforated.100`, `tray.duct.*` (korytka drabinkowe/perforowane/kanały).
- **props:** `widthMm`, `heightMm`, `material` (stal/ocynk/INOX), `swl` (dop. obciążenie), `supportSpacing`.
- **Kalkulatory:** `fillRatio(tray)` = Σ przekrojów kabli / pole korytka (≤ ~40%); kontrola SWL vs masa wiązki;
  **separacja energetyka↔teletechnika** (PN-EN 50174-2) jako reguła odległości między trasami systemów.
- **BOM:** mb korytek per typ + kształtki (łuki/trójniki/redukcje — szacowane wg liczby segmentów/węzłów) + podpory.
- **Auto-routing:** A* na gridzie z preferencją istniejących tras (kable „wskakują" w korytka).

## 2. SSWiN — PN-EN 50131 (Grade 1–4)

- **typeKey:** `sswin.pir`, `sswin.dualtech`, `sswin.magnetic`, `sswin.panel`, `sswin.keypad`, `sswin.siren`, `sswin.expander`.
- **props:** `grade` (1–4), `envClass` (I–IV), `range`, `zone`, `tamper`.
- **Reguły:** `deviceGrade(device) >= project.requiredGrade` (system = najsłabszy element);
  zasilanie awaryjne/podtrzymanie (PN-EN 50131-6) — kalkulator pojemności akumulatora vs pobór + czas autonomii;
  pokrycie strefy (PIR range vs powierzchnia pomieszczenia).
- **Schemat:** centrala → ekspandery → linie dozorowe (drzewo); tabela stref/przypisań.
- **BOM:** czujki/kontaktrony/sygnalizatory + centrala + ekspandery + kabel (YTDY/skrętka) z długości tras.

## 3. Kontrola dostępu (KD) — PN-EN 60839-11-1/-2 (klasy 1–4)

- **typeKey:** `kd.reader`, `kd.controller`, `kd.maglock`, `kd.strike`, `kd.rex`, `kd.door`.
- **props:** `accessClass` (1–4), `doorMode` (online/offline), `failMode` (fail-safe/secure), `interface` (Wiegand/OSDP).
- **Reguły:** klasa urządzenia ≥ wymagana; drogi ewakuacyjne → fail-safe (sprzężenie z PPOŻ); zasilanie/podtrzymanie zamków.
- **Schemat:** kontroler → przejścia (drzwi) z czytnikami; tabela uprawnień/stref (współdzielona ze SSWiN).
- **BOM:** czytniki + kontrolery + zamki/zwory + zasilacze + kabel.

## 4. Instalacje elektryczne — PN-HD 60364 (seria)

- **Encje:** `Circuit`, `Panel` (już w modelu) + `Device` typu `elec.socket/elec.light/elec.feed`.
- **typeKey:** `elec.socket.230`, `elec.socket.400`, `elec.light.point`, `elec.panel`, `elec.breaker`, `elec.rcd`.
- **props:** `loadW`, `phase`, `breakerType` (B/C), `In` (prąd zn.), `conductorMm2`, `installMethod` (PN-HD 60364-5-52 ref).
- **Kalkulatory (rdzeń fizyki):**
  - `voltageDrop(circuit)` — spadek napięć [%] = f(długość, przekrój, prąd, cosφ) ≤ limit (oświetlenie 3%, gniazda 5%);
  - `loopImpedance` — pętla zwarcia / czas zadziałania zabezpieczenia (PN-HD 60364-4-41, ochrona przeciwporażeniowa);
  - dobór przekroju vs obciążalność długotrwała + warunek selektywności.
- **Schemat:** **schemat jednokreskowy rozdzielnicy** (rozdzielnia → obwody → odbiory) + tabela obwodów.
- **BOM:** aparaty (wyłączniki/RCD) + przewody (przekrój×długość) + osprzęt (gniazda/puszki) + rozdzielnice.
- **WT (rozp. warunki techniczne):** §180–186 jako reguły (np. §183 przeciwpożarowy wyłącznik prądu dla stref >1000 m³).

## 5. PPOŻ / SAP — PN-EN 54 + CEN/TS 54-14 + dopuszczenia CNBOP

- **typeKey:** `sap.detector.smoke`, `sap.detector.heat`, `sap.detector.multi`, `sap.mcp` (ROP), `sap.panel`, `sap.sounder`, `sap.module.io`.
- **props:** `coverageArea`, `mountHeight`, `loop`, `cnbopCert` (nr świadectwa + ważność), `zone`.
- **Reguły:** **tylko urządzenia z ważnym dopuszczeniem CNBOP** (`device.props.cnbopCert.valid == true`);
  zasięg czujki vs powierzchnia/wysokość pomieszczenia (CEN/TS 54-14); maks. liczba elementów w pętli;
  rezerwa zasilania (PN-EN 54-4).
- **Matryca sterowań (kluczowy deliverable):** „zdarzenie → sterowanie" (pożar w strefie X → oddymianie, DSO,
  zwolnienie drzwi KD, wyłączenie wentylacji, PWP). Encja `ControlMatrix` (do dodania) sprzęga SAP z DSO/KD/elektryką.
- **Schemat:** topologia pętli adresowalnej + matryca sterowań + scenariusz pożarowy.
- **⚠️ Prawno-bezpieczeństwo:** safety-of-life — najsurowsza walidacja, jawny disclaimer, akceptacja rzeczoznawcy ppoż.

## 6. DSO — PN-EN 54-16/-24, PN-EN 50849

- **typeKey:** `dso.speaker.ceiling`, `dso.speaker.horn`, `dso.speaker.column`, `dso.amplifier`, `dso.controller`.
- **props:** `powerW`, `spl` (poziom dźwięku), `coverageRadius`, `zone`.
- **Kalkulatory:** **pokrycie akustyczne / STI** (zrozumiałość mowy ≥ 0,45–0,5) — uproszczony model siatki głośników
  vs powierzchnia i tłumienie; bilans mocy wzmacniaczy + rezerwa; długości linii głośnikowych 100 V.
- **Sprzężenie z SAP:** strefy DSO = strefy alarmowe SAP (matryca sterowań ewakuacji).
- **Schemat:** linie głośnikowe per strefa + tabela mocy + rozmieszczenie głośników z izoliniami SPL.

## 7. Automatyka budynkowa (BMS) — PN-EN ISO 16484 + KNX + ISO 52120-1

- **typeKey:** `bms.sensor.*` (temp/CO2/obecność), `bms.actuator.*`, `bms.controller`, `bms.gateway`.
- **props:** `protocol` (KNX/BACnet/Modbus), `datapoint`, `function` (HVAC/oświetlenie/żaluzje).
- **Reguły:** klasa efektywności energetycznej BACS (A–D wg ISO 52120-1) na podstawie zaimplementowanych funkcji.
- **Rola integracyjna:** BMS spina elektrykę/HVAC/oświetlenie + odbiera zdarzenia z SAP/SSWiN/KD.
- **Schemat:** topologia magistrali (KNX line/area) + lista punktów (datapointów) + funkcje logiczne.
- **BOM:** czujniki/aktory/sterowniki/bramki + magistrala (kabel KNX) + zasilacze.

---

## Encje do dodania w modelu (poza pilotem)

Te rozszerzenia `schema.ts` dochodzą wraz z systemami (każda = bump `SCHEMA_VERSION` jeśli łamie zgodność):

- `Zone` — strefa (dozorowa/alarmowa/pożarowa/dostępu) — współdzielona przez SSWiN/KD/SAP/DSO.
- `ControlMatrix` — macierz sterowań „zdarzenie → akcja" (SAP/PPOŻ ↔ DSO/KD/elektryka).
- `LoopSegment` — pętla adresowalna (SAP) / magistrala (KNX).
- `CatalogItem` — pozycja katalogu produktów (producent, model, parametry, `cnbopCert`, cena) — wspólna baza.
- `Schematic` — wygenerowany widok logiczny (jednokreskowy/rack/pętla/matryca) z odnośnikami do encji.

## Wspólne komponenty (budowane raz, używane przez wszystkie systemy)

- **Katalog produktów** (`CatalogItem`) + import bibliotek producentów + baza dopuszczeń CNBOP.
- **Silnik BOM** — generyczna agregacja `Device[]+Route[] → BomItem[]` (parametr: reguła grupowania per system).
- **Silnik kosztorysu** — `BomItem → CostItem` (mapowanie KNR + cennik DBF) + eksport ATH v1.x / XLS.
- **Generator dokumentów** — opis techniczny (Word) + część rysunkowa (PDF/DXF) + obliczenia + przedmiar + pola projektanta.
- **Auto-routing A\*** (sidecar) — wspólny dla wszystkich tras, z preferencją korytek.
- **Silnik norm** — wszystkie reguły deklaratywne, jeden interpreter.
