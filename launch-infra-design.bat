@echo off
rem ── Infra Design — launcher produkcyjny (desktop) ───────────────────────────
rem Uruchamia zbudowaną aplikację Electron (out/) z poprawnym środowiskiem.
cd /d "%~dp0"

rem Electron MUSI startować jako GUI (nie jako Node) — czyścimy zmienną, która to psuje.
set "ELECTRON_RUN_AS_NODE="

rem Interpreter sidecara geometrii (Python z ezdxf/Shapely w venv projektu).
set "INFRA_PYTHON=%~dp0sidecar\.venv\Scripts\python.exe"

rem Start zbudowanej aplikacji (package.json -> main = out/main/index.js).
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
