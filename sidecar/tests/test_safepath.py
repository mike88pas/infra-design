"""
Testy walidacji ścieżek (safepath) — path traversal, rozszerzenia, limity, zapis.
Niezależne od ezdxf/Shapely (czysta logika ścieżek).
"""

import importlib.util
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def _load_safepath():
    spec = importlib.util.spec_from_file_location(
        "infra_safepath", ROOT / "sidecar" / "geometry" / "safepath.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


safepath = _load_safepath()


# ── wejście ──────────────────────────────────────────────────────────────────

def test_in_path_happy(tmp_path):
    f = tmp_path / "a.dxf"
    f.write_text("x")
    assert safepath.validate_in_path(str(f), [str(tmp_path)]) == str(f.resolve())


def test_in_path_traversal_outside_roots_denied(tmp_path):
    f = tmp_path / "a.dxf"
    f.write_text("x")
    other = tmp_path / "sub"
    other.mkdir()
    # plik leży poza jedynym dozwolonym katalogiem (other) → odmowa
    with pytest.raises(PermissionError):
        safepath.validate_in_path(str(f), [str(other)])


def test_in_path_dotdot_resolved_and_denied(tmp_path):
    # '..' wyprowadza poza root — resolve() to rozwija, walidacja odrzuca
    f = tmp_path / "a.dxf"
    f.write_text("x")
    root = tmp_path / "root"
    root.mkdir()
    sneaky = str(root / ".." / "a.dxf")
    with pytest.raises(PermissionError):
        safepath.validate_in_path(sneaky, [str(root)])


def test_in_path_bad_extension(tmp_path):
    f = tmp_path / "a.txt"
    f.write_text("x")
    with pytest.raises(PermissionError):
        safepath.validate_in_path(str(f), [str(tmp_path)])


def test_in_path_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        safepath.validate_in_path(str(tmp_path / "nope.dxf"), [str(tmp_path)])


def test_in_path_no_roots_denied(tmp_path):
    f = tmp_path / "a.dxf"
    f.write_text("x")
    old = os.environ.pop("INFRA_ALLOWED_ROOTS", None)
    try:
        with pytest.raises(PermissionError):
            safepath.validate_in_path(str(f), None)
    finally:
        if old is not None:
            os.environ["INFRA_ALLOWED_ROOTS"] = old


def test_in_path_size_limit(tmp_path, monkeypatch):
    f = tmp_path / "a.dxf"
    f.write_bytes(b"0" * 32)
    monkeypatch.setattr(safepath, "MAX_DXF_BYTES", 8)
    with pytest.raises(PermissionError):
        safepath.validate_in_path(str(f), [str(tmp_path)])


def test_in_path_empty(tmp_path):
    with pytest.raises(ValueError):
        safepath.validate_in_path("", [str(tmp_path)])


# ── wyjście (eksport) ────────────────────────────────────────────────────────

def test_out_path_happy(tmp_path):
    out = tmp_path / "o.dxf"
    assert safepath.validate_out_path(str(out), [str(tmp_path)]) == str(tmp_path / "o.dxf")


def test_out_path_outside_denied(tmp_path):
    other = tmp_path / "sub"
    other.mkdir()
    out = tmp_path / "o.dxf"
    with pytest.raises(PermissionError):
        safepath.validate_out_path(str(out), [str(other)])


def test_out_path_missing_parent(tmp_path):
    with pytest.raises(FileNotFoundError):
        safepath.validate_out_path(str(tmp_path / "missing" / "o.dxf"), [str(tmp_path)])


def test_out_path_bad_extension(tmp_path):
    with pytest.raises(PermissionError):
        safepath.validate_out_path(str(tmp_path / "o.exe"), [str(tmp_path)])
