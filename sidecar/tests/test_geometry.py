"""
Testy kontraktowe sidecara geometrii (import_dxf / polygonize) na fixture DXF.

Walidują KSZTAŁT odpowiedzi (kontrakt współdzielony z TS) oraz poprawność
wykrywania pomieszczeń na znanym rzucie (5 pomieszczeń, ~96 m²).

Uruchom z katalogu repo:  python -m pytest sidecar/tests -q
"""

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests" / "fixtures" / "sample-floor.dxf"


def _load_server():
    spec = importlib.util.spec_from_file_location(
        "infra_sidecar_server", ROOT / "sidecar" / "geometry" / "server.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


server = _load_server()


@pytest.fixture(scope="module")
def fixture_path():
    assert FIXTURE.exists(), f"Brak fixture DXF: {FIXTURE} (uruchom scripts/make_sample_dxf.py)"
    return str(FIXTURE)


def test_import_dxf_contract(fixture_path):
    doc = server._import_dxf({"path": fixture_path})

    # Kontrakt DxfDocument
    assert set(doc.keys()) >= {"layers", "entities", "bbox", "units", "entityCount"}
    assert doc["units"] == "mm"
    assert doc["entityCount"] == len(doc["entities"])
    assert doc["entityCount"] > 0

    # bbox sensowny (rzut 12 x 8 m)
    b = doc["bbox"]
    assert b["minX"] == pytest.approx(0.0, abs=1.0)
    assert b["maxX"] == pytest.approx(12000.0, abs=1.0)
    assert b["maxY"] == pytest.approx(8000.0, abs=1.0)

    # warstwy mają kolor hex i flagę widoczności
    names = {l["name"] for l in doc["layers"]}
    assert {"WALLS", "DOORS", "TEXT"} <= names
    for lay in doc["layers"]:
        assert lay["color"].startswith("#") and len(lay["color"]) == 7
        assert isinstance(lay["visible"], bool)

    # encje: tagowana unia z polem warstwy
    types = {e["t"] for e in doc["entities"]}
    assert "line" in types
    for e in doc["entities"]:
        assert "layer" in e and "t" in e


def test_polygonize_detects_rooms(fixture_path):
    res = server._polygonize({"path": fixture_path, "wallLayers": ["WALLS"]})

    assert "polygons" in res and "snapTolerance" in res
    polys = res["polygons"]
    assert len(polys) == 5, f"oczekiwano 5 pomieszczeń, jest {len(polys)}"

    total_m2 = sum(p["area"] for p in polys) / 1_000_000
    assert total_m2 == pytest.approx(96.0, rel=0.02)  # 12 x 8 m

    # każdy wielobok: ≥3 punkty {x,y}, malejąco po polu
    areas = [p["area"] for p in polys]
    assert areas == sorted(areas, reverse=True)
    for p in polys:
        assert len(p["points"]) >= 3
        assert set(p["points"][0].keys()) == {"x", "y"}


def test_polygonize_empty_when_no_segments(fixture_path):
    # warstwa bez segmentów ścian → brak pomieszczeń (bez wyjątku)
    res = server._polygonize({"path": fixture_path, "wallLayers": ["TEXT"]})
    assert res["polygons"] == []
