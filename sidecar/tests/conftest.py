"""
Konfiguracja pytest dla sidecara.

Walidacja ścieżek (safepath) wymaga allowlisty katalogów (env INFRA_ALLOWED_ROOTS).
Testy operują na fixturach w tests/fixtures/ — wpuszczamy tylko ten katalog.
Test eksportu pisze do tmp_path i przekazuje własne `_allowedRoots`.
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.environ["INFRA_ALLOWED_ROOTS"] = str(ROOT / "tests" / "fixtures")
