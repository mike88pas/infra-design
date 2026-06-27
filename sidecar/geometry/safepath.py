"""
Walidacja ścieżek dla sidecara — obrona przed path traversal i zapisem poza
dozwolonym obszarem.

Renderer jest izolowany, ale gdyby kiedyś został skompromitowany, NIE może zmusić
sidecara do odczytu/zapisu dowolnego pliku na dysku. Proces główny Electrona
autoryzuje pliki wskazane przez użytkownika (dialog) i przekazuje dozwolone
katalogi jako:
  - env INFRA_ALLOWED_ROOTS (bazowe korzenie, os.pathsep-separated),
  - per-żądanie params["_allowedRoots"] (katalog pliku wskazanego przez usera).

Pusta allowlista = ODMOWA. Brak trybu „wyłącz walidację".
"""

import os
from pathlib import Path

# Ochrona pamięci/DoS — twardy limit rozmiaru wejściowego DXF.
MAX_DXF_BYTES = 200 * 1024 * 1024  # 200 MB


def _resolve(part: str):
    try:
        return Path(str(part)).resolve()
    except OSError:
        return None


def _roots_from_env():
    raw = os.environ.get("INFRA_ALLOWED_ROOTS", "")
    out = []
    for part in raw.split(os.pathsep):
        part = part.strip()
        if part:
            r = _resolve(part)
            if r is not None:
                out.append(r)
    return out


def _combined_roots(extra):
    roots = _roots_from_env()
    for part in (extra or []):
        if part:
            r = _resolve(part)
            if r is not None:
                roots.append(r)
    return roots


def _is_within(p: Path, roots) -> bool:
    for r in roots:
        try:
            p.relative_to(r)
            return True
        except ValueError:
            continue
    return False


def validate_in_path(path, extra_roots=None) -> str:
    """Waliduje ścieżkę pliku WEJŚCIOWEGO DXF. Zwraca skanonizowaną ścieżkę
    lub rzuca PermissionError/ValueError. resolve(strict=True) rozwija '..' oraz
    symlinki (Windows: także nazwy 8.3) i wymaga istnienia pliku."""
    if not path:
        raise ValueError("brak parametru 'path'")
    p = Path(str(path)).resolve(strict=True)
    if p.suffix.lower() != ".dxf":
        raise PermissionError(f"niedozwolone rozszerzenie wejścia: {p.suffix!r}")
    if p.stat().st_size > MAX_DXF_BYTES:
        raise PermissionError("plik DXF przekracza dozwolony rozmiar")
    roots = _combined_roots(extra_roots)
    if not roots or not _is_within(p, roots):
        raise PermissionError(f"ścieżka poza dozwolonym obszarem: {p}")
    return str(p)


def validate_out_path(path, extra_roots=None, allowed_ext=(".dxf",)) -> str:
    """Waliduje ścieżkę pliku WYJŚCIOWEGO (eksport DXF/XLSX). Katalog docelowy musi
    istnieć i leżeć w dozwolonym obszarze; odmawia nadpisania pliku/symlinku,
    który wskazuje poza obszar. `allowed_ext` — dozwolone rozszerzenia wyjścia."""
    if not path:
        raise ValueError("brak parametru 'path'")
    p = Path(str(path))
    allowed = {e.lower() for e in allowed_ext}
    if p.suffix.lower() not in allowed:
        raise PermissionError(f"niedozwolone rozszerzenie wyjścia: {p.suffix!r}")
    parent = p.parent.resolve(strict=True)  # katalog docelowy musi istnieć
    target = parent / p.name
    roots = _combined_roots(extra_roots)
    if not roots or not _is_within(target, roots):
        raise PermissionError(f"zapis poza dozwolonym obszarem: {target}")
    if target.exists():
        real = target.resolve()
        if not _is_within(real, roots):
            raise PermissionError("odmowa nadpisania pliku poza obszarem")
    return str(target)
