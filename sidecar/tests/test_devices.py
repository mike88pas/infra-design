"""
Testy kontraktowe F2: eksplozja bloków w `polygonize` + `extract_devices`.

Fixture `sample_nested_devices.dxf` odwzorowuje układ „jak od klienta":
ściany ukryte w jednym bloku podkładu, urządzenia jako INSERT na warstwach PST_*
(część z atrybutami IDFX/NR). Regeneracja: tests/fixtures/gen_fixtures.py

Uruchom z katalogu repo:  python -m pytest sidecar/tests -q
"""

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests" / "fixtures" / "sample_nested_devices.dxf"


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
    assert FIXTURE.exists(), f"Brak fixture: {FIXTURE} (uruchom tests/fixtures/gen_fixtures.py)"
    return str(FIXTURE)


def test_polygonize_needs_explode_for_block_walls(fixture_path):
    # Ściany są w bloku podkładu — bez eksplozji niewidoczne.
    flat = server._polygonize({"path": fixture_path, "wallLayers": ["A-WALL"]})
    assert flat["polygons"] == []

    # Z eksplozją wykrywamy oba pomieszczenia (6×8 i 8×8 m).
    res = server._polygonize(
        {"path": fixture_path, "explodeBlocks": True, "wallLayers": ["A-WALL"]}
    )
    assert len(res["polygons"]) == 2, f"oczekiwano 2 pomieszczeń, jest {len(res['polygons'])}"
    total_m2 = sum(p["area"] for p in res["polygons"]) / 1_000_000
    assert total_m2 == pytest.approx(112.0, rel=0.02)  # 48 + 64 m²


def test_layer_matches_substring():
    # Eksplodowane encje mają warstwy typu '<blok>$0$A-WALL'.
    assert server._layer_matches("ARCH_BASE$0$A-WALL", {"A-WALL"})
    assert server._layer_matches("x$0$I-WALL", {"WALL"})
    assert not server._layer_matches("PST_gniazda CCTV", {"A-WALL"})
    assert server._layer_matches("cokolwiek", None)  # None = wszystkie


def test_extract_devices_contract(fixture_path):
    res = server._extract_devices({"path": fixture_path, "layers": ["PST_"]})

    assert set(res.keys()) == {"inserts", "count"}
    assert res["count"] == len(res["inserts"])
    # 4 RJ-45 + 3 CCTV + 2 AP + 1 KD = 10 (podkład odfiltrowany przez 'PST_')
    assert res["count"] == 10

    by_layer = {}
    for ins in res["inserts"]:
        assert set(ins.keys()) == {"layer", "name", "at", "rotation", "sx", "sy", "attribs"}
        assert set(ins["at"].keys()) == {"x", "y"}
        by_layer.setdefault(ins["layer"], 0)
        by_layer[ins["layer"]] += 1

    assert by_layer["PST_gniazda_RJ-45"] == 4
    assert by_layer["PST_gniazda CCTV"] == 3
    assert by_layer["PST_gniazda AP"] == 2
    assert by_layer["PST_kontrola dostępu"] == 1


def test_extract_devices_reads_attribs(fixture_path):
    res = server._extract_devices({"path": fixture_path, "layers": ["PST_gniazda_RJ-45"]})
    assert res["count"] == 4
    for ins in res["inserts"]:
        assert "IDFX" in ins["attribs"] and "NR" in ins["attribs"]
        assert ins["attribs"]["IDFX"].startswith("PPD1.")


def test_extract_devices_filter_all_when_no_layers(fixture_path):
    # Bez filtra: podkład (PODKLAD) też się liczy.
    res = server._extract_devices({"path": fixture_path})
    assert res["count"] == 11  # 10 urządzeń + 1 podkład


def test_extract_rooms_from_area_labels(fixture_path):
    res = server._extract_rooms({"path": fixture_path})
    assert res["count"] == 2
    by_num = {r["number"]: r for r in res["rooms"]}
    assert set(by_num) == {"0.1", "0.2"}
    assert by_num["0.1"]["name"] == "Sala A"
    assert by_num["0.1"]["areaM2"] == 64.0 or by_num["0.1"]["areaM2"] == 48.0
    # pole z etykiety (nie geometrii): 48 i 64 m²
    areas = sorted(r["areaM2"] for r in res["rooms"])
    assert areas == [48.0, 64.0]
    for r in res["rooms"]:
        assert set(r["at"].keys()) == {"x", "y"}
        assert len(r["tag"]) >= 3


def test_parse_room_label_variants():
    assert server._parse_room_label(["1.11", "Scena Nowa", "224.64 m²"]) == ("1.11", "Scena Nowa", 224.64)
    # przecinek dziesiętny + 'm2'
    assert server._parse_room_label(["0.2", "Bar", "3,09 m2"]) == ("0.2", "Bar", 3.09)


def test_route_cables_astar_avoids_and_measures(fixture_path):
    # Źródła w obu pomieszczeniach, cel poza nimi → trasy A* z dodatnią długością.
    sources = [{"x": 3000, "y": 1000}, {"x": 10000, "y": 1000}]
    targets = [{"x": 13000, "y": 7000}]
    res = server._route_cables(
        {"path": fixture_path, "sources": sources, "targets": targets,
         "wallLayers": ["A-WALL"], "explodeBlocks": True}
    )
    assert len(res["routes"]) == 2
    for rt in res["routes"]:
        assert rt["length"] > 0
        assert len(rt["path"]) >= 2
        assert rt["targetIndex"] == 0
        assert rt["method"] in ("astar", "straight")


def test_route_cables_empty_without_targets(fixture_path):
    res = server._route_cables({"path": fixture_path, "sources": [{"x": 0, "y": 0}], "targets": []})
    assert res["routes"] == []


def test_export_dxf_writes_readable(tmp_path):
    import ezdxf

    out = str(tmp_path / "instalacja.dxf")
    res = server._export_dxf({
        "path": out,
        "devices": [
            {"system": "lan", "typeKey": "lan.outlet.2x", "position": {"x": 1000, "y": 1000}},
            {"system": "lan", "typeKey": "lan.ap", "position": {"x": 3000, "y": 1000}},
            {"system": "cctv", "typeKey": "cctv.dome.4mp", "position": {"x": 2000, "y": 3000}},
        ],
        "routes": [{"path": [{"x": 1000, "y": 1000}, {"x": 5000, "y": 5000}], "system": "lan"}],
        "rooms": [{"name": "1.11 Sala", "at": {"x": 2000, "y": 2000}}],
        "cabinets": [{"x": 5000, "y": 5000}],
        "legend": [{"label": "Gniazdo 2xRJ45", "count": 45}],
        "meta": {"project": "Test", "drawing": "K+1", "designer": "Jan", "license": "1234"},
    })
    assert res["devices"] == 3 and res["routes"] == 1

    doc = ezdxf.readfile(out)
    layers = {l.dxf.name for l in doc.layers}
    assert {"INSTAL-LAN", "INSTAL-CCTV", "INSTAL-AP", "INSTAL-TRASY", "INSTAL-LEGENDA"} <= layers
    msp = doc.modelspace()
    assert sum(1 for e in msp if e.dxftype() == "CIRCLE") == 1  # AP
    assert any(e.dxftype() == "LWPOLYLINE" for e in msp)  # symbole/trasy
    assert any(e.dxftype() == "TEXT" for e in msp)  # etykiety/legenda
