# Sidecar geometrii

Pythonowy proces uruchamiany przez Electron Main. Komunikacja: newline-delimited
JSON przez stdio (patrz `geometry/server.py`).

## Uruchomienie lokalne (dev)

```bash
cd sidecar
python -m venv .venv
# Windows:
.venv\Scripts\activate
# *nix:
source .venv/bin/activate
pip install -r requirements.txt
```

Aplikacja używa interpretera z `INFRA_PYTHON` (env) lub `python` z PATH. Aby wskazać venv:

```bash
# Windows (PowerShell)
$env:INFRA_PYTHON = "$PWD\sidecar\.venv\Scripts\python.exe"; npm run dev
```

## Test ręczny handshake

```bash
echo '{"id":1,"method":"ping"}' | python geometry/server.py
# -> {"id": 1, "ok": true, "result": {"pong": true, "ezdxf": "1.3.x", "python": "3.12.x"}}
```

## Roadmapa metod
- F0: `ping` (handshake)
- F1: `import_dxf`, `polygonize` (Shapely → pomieszczenia)
- F2+: `auto_route` (A*), `export_dxf`, `export_pdf`, `export_xlsx`, `export_docx`
