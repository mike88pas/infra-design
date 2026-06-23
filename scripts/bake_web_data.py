#!/usr/bin/env python3
"""
Piecze dane rzutu dla webowego demo: uruchamia handlery sidecara na fixture DXF
i zapisuje { doc, spaces } do JSON. Nazwy pomieszczeń pobiera z etykiet TEXT
leżących wewnątrz wykrytych wieloboków (fallback: „Pomieszczenie N").

Uruchom z katalogu repo:  python scripts/bake_web_data.py
"""

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "sample-floor.dxf"
OUT = ROOT / "web" / "src" / "data" / "sample-floor.json"

# Realny rzut klienta (Teatr Rzeszów, K+1) — opcjonalny (plik spoza repo).
# Wynik (client-floor.json) jest commitowany, więc demo nie potrzebuje DXF-a w runtime.
import os

CLIENT_DXF = os.environ.get(
    "INFRA_CLIENT_DXF",
    r"C:\Users\mikep\Downloads\PROJEKT_APK_extracted\DXF\PW-IT-02-012_K+1_LAN.dxf",
)
CLIENT_OUT = ROOT / "web" / "src" / "data" / "client-floor.json"


def load_server():
    spec = importlib.util.spec_from_file_location(
        "infra_sidecar_server", ROOT / "sidecar" / "geometry" / "server.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def point_in_polygon(x, y, poly):
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]["x"], poly[i]["y"]
        xj, yj = poly[j]["x"], poly[j]["y"]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def main():
    server = load_server()
    path = str(FIXTURE)

    doc = server._import_dxf({"path": path})
    poly = server._polygonize({"path": path, "wallLayers": ["WALLS"]})

    texts = [e for e in doc["entities"] if e["t"] == "text"]

    spaces = []
    for i, p in enumerate(poly["polygons"]):
        name = None
        for t in texts:
            if point_in_polygon(t["at"]["x"], t["at"]["y"], p["points"]):
                name = t["text"]
                break
        spaces.append({
            "id": f"space-{i + 1}",
            "name": name or f"Pomieszczenie {i + 1}",
            "area": p["area"],
            "polygon": p["points"],
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"doc": doc, "spaces": spaces}, ensure_ascii=False), encoding="utf-8")
    print(f"Zapisano {OUT}")
    print(f"  encji: {len(doc['entities'])}, pomieszczen: {len(spaces)}")
    for s in spaces:
        print(f"  - {s['name'].encode('ascii', 'replace').decode()}: {s['area'] / 1e6:.1f} m2")


def bake_client(server, anonymize=True):
    """Piecze realny rzut klienta (K+1) do client-floor.json: warstwy, pomieszczenia,
    INSERT-y urządzeń i trasy A*. Mapowanie warstw→systemy i BOM/kosztorys liczy się
    LIVE w przeglądarce (ten sam kod TS co w aplikacji).

    anonymize=True (domyślnie): usuwa dane identyfikujące (nazwa projektu, nazwy
    pomieszczeń, atrybuty IDFX) — artefakt webowy jest publiczny. Zostają liczby:
    metraże, liczby urządzeń, długości kabli. Desktop używa realnego DXF wprost.

    BEZPIECZEŃSTWO (NDA): artefakt webowy (CLIENT_OUT) jest publiczny, więc anonimizacja
    jest WYMUSZONA — nie da się upiec realnych danych klienta do web/."""
    if not anonymize:
        raise SystemExit(
            "bake_client: odmowa — web/ jest publiczny i wymaga anonimizacji (NDA). "
            "Usuń anonymize=False."
        )
    if not Path(CLIENT_DXF).exists():
        print(f"[client] pominięto — brak pliku {CLIENT_DXF}")
        return
    path = CLIENT_DXF
    rooms = server._extract_rooms({"path": path})
    dev = server._extract_devices({"path": path, "layers": ["PST_"]})
    doc = server._import_dxf({"path": path})

    # Warstwy istotne (PST_ + A-WALL/AREA) — reszta z 146 niepotrzebna w demo.
    layers = [l for l in doc["layers"] if "PST" in l["name"] or "AREA" in l["name"] or "WALL" in l["name"]]

    # Trasowanie wszystkich urządzeń PST_* do najbliższej szafy (do metrów kabla w BOM).
    szafy = server._extract_devices({"path": path, "layers": ["szaf", "rack"]})
    targets = [i["at"] for i in szafy["inserts"]]
    cable_routes = []
    if dev["inserts"] and targets:
        rc = server._route_cables({
            "path": path, "sources": [i["at"] for i in dev["inserts"]], "targets": targets,
            "wallLayers": ["A-WALL", "I-WALL"], "explodeBlocks": True,
        })
        for r in rc["routes"]:
            src = dev["inserts"][r["sourceIndex"]]["at"]
            cable_routes.append({"at": src, "lengthM": r["length"] / 1000.0})

    rooms_data = rooms["rooms"]
    inserts_data = dev["inserts"]
    meta_name = "Obiekt użyteczności publicznej — kondygnacja parter (demo)"
    if anonymize:
        # Usuń dane identyfikujące: nazwy pomieszczeń → generyczne, atrybuty INSERT → puste.
        for rm in rooms_data:
            rm["name"] = "Pomieszczenie"
        for ins in inserts_data:
            ins["attribs"] = {}
        # Nazwy warstw podkładu zawierają nazwę obiektu (blok architektoniczny,
        # format "<blok>$0$A-WALL") — zostaw tylko generyczny sufiks warstwy.
        for l in layers:
            if "$0$" in l["name"]:
                l["name"] = "PODKŁAD$0$" + l["name"].rsplit("$0$", 1)[-1]
    else:
        meta_name = "Teatr w Rzeszowie — kondygnacja K+1 (parter)"

    payload = {
        "meta": {"name": meta_name, "level": 1, "units": doc["units"], "unitMm": 1, "anonymized": anonymize},
        "layers": layers,
        "rooms": rooms_data,
        "inserts": inserts_data,
        "cableRoutes": cable_routes,
        "cableTotalM": round(sum(c["lengthM"] for c in cable_routes), 1),
    }
    # Bezpiecznik końcowy (NDA): odmów zapisu, jeśli w payloadzie zostały tokeny klienta.
    raw = json.dumps(payload, ensure_ascii=False)
    low = raw.lower()
    hits = [t for t in ("teatr", "rzesz", "2203-ar") if t in low]
    if hits or payload["meta"].get("anonymized") is not True:
        raise SystemExit(f"bake_client: wykryto dane klienta {hits} — przerwano (NDA).")
    CLIENT_OUT.write_text(raw, encoding="utf-8")
    print(f"Zapisano {CLIENT_OUT}")
    print(f"  warstw={len(layers)} rooms={rooms['count']} inserts={dev['count']} cable_m={payload['cableTotalM']:.0f}")


if __name__ == "__main__":
    server = load_server()
    main()
    bake_client(server)
