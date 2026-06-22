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


if __name__ == "__main__":
    main()
