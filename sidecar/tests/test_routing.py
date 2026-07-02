"""
Testy routera kabli (route_cables) — otwory drzwiowe + ortogonalność.

Chronią dwa krytyczne zachowania (u ŹRÓDŁA logiki, nie w binarce):
 1. `doorLayers` przebija otwory w rastrze ścian → kable idą przez drzwi,
    a nie prostą przez mur (bez drzwi pokoje-pudełka spadają do 'straight').
 2. Trasy są ORTOGONALNE (4-sąsiedztwo) i uproszczone do punktów załamań.

Uruchom z katalogu repo:  python -m pytest sidecar/tests -q
"""

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests" / "fixtures" / "sample_office_clean.dxf"


def _load_server():
    spec = importlib.util.spec_from_file_location(
        "infra_sidecar_server_routing", ROOT / "sidecar" / "geometry" / "server.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


server = _load_server()


@pytest.fixture(scope="module")
def office():
    assert FIXTURE.exists(), f"Brak fixture DXF: {FIXTURE}"
    return str(FIXTURE)


@pytest.fixture(scope="module")
def rooms(office):
    res = server._polygonize({"path": office, "wallLayers": ["A-WALL"]})
    polys = res["polygons"]
    assert len(polys) == 9  # 8 pokoi + korytarz
    return polys


def _centroid(poly):
    pts = poly["points"]
    return {
        "x": sum(p["x"] for p in pts) / len(pts),
        "y": sum(p["y"] for p in pts) / len(pts),
    }


def _route(office, rooms, **extra):
    sources = [_centroid(p) for p in rooms]
    rack = {
        "x": sum(c["x"] for c in sources) / len(sources),
        "y": sum(c["y"] for c in sources) / len(sources),
    }
    params = {"path": office, "sources": sources, "targets": [rack], "wallLayers": ["A-WALL"]}
    params.update(extra)
    return server._route_cables(params)["routes"]


def test_bez_drzwi_pokoje_odciete(office, rooms):
    routes = _route(office, rooms)
    straight = sum(1 for r in routes if r["method"] == "straight")
    assert straight > 3  # szczelne pokoje → większość spada do prostej


def test_z_drzwiami_wszystkie_przez_drzwi(office, rooms):
    routes = _route(office, rooms, doorLayers=["DOOR"], doorClear=2)
    assert all(r["method"] == "astar" for r in routes)


def test_trasy_ortogonalne_i_uproszczone(office, rooms):
    routes = _route(office, rooms, doorLayers=["DOOR"], doorClear=2)
    for r in routes:
        p = r["path"]
        # Każdy segment poziomy lub pionowy (4-sąsiedztwo).
        for i in range(len(p) - 1):
            dx = abs(p[i]["x"] - p[i + 1]["x"])
            dy = abs(p[i]["y"] - p[i + 1]["y"])
            assert dx < 1 or dy < 1, f"ukośny segment w trasie {r['sourceIndex']}"
        # Uproszczone do załamań (nie setki komórek siatki).
        assert len(p) <= 12
