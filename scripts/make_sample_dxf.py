#!/usr/bin/env python3
"""
Generator przykładowego rzutu DXF dla F1 (fixture testowy + dane do web demo).

Tworzy mały rzut biura: ściany obwodowe + ścianki działowe dzielące przestrzeń
na 5 pomieszczeń, warstwa drzwi, etykiety pomieszczeń. Jednostki: mm.

Uruchom:  python scripts/make_sample_dxf.py [out.dxf]
Domyślnie zapisuje do tests/fixtures/sample-floor.dxf
"""

import sys
from pathlib import Path

import ezdxf


def build(path: Path) -> None:
    doc = ezdxf.new("R2010", setup=True)
    doc.header["$INSUNITS"] = 4  # mm
    msp = doc.modelspace()

    doc.layers.add("WALLS", color=7)
    doc.layers.add("DOORS", color=3)
    doc.layers.add("ROOMS", color=5)
    doc.layers.add("TEXT", color=2)

    def wall(p1, p2):
        msp.add_line(p1, p2, dxfattribs={"layer": "WALLS"})

    def rect(x0, y0, x1, y1):
        wall((x0, y0), (x1, y0))
        wall((x1, y0), (x1, y1))
        wall((x1, y1), (x0, y1))
        wall((x0, y1), (x0, y0))

    # Obrys budynku 12 m x 8 m (w mm)
    W, H = 12000, 8000
    rect(0, 0, W, H)

    # Ścianki działowe → 5 pomieszczeń
    # pionowa na x=5000 (od dołu do góry)
    wall((5000, 0), (5000, H))
    # pionowa na x=8500
    wall((8500, 0), (8500, H))
    # pozioma na y=4000 między x=0..5000 (dzieli lewą część na 2)
    wall((0, 4000), (5000, 4000))
    # pozioma na y=4000 między x=8500..W (dzieli prawą część na 2)
    wall((8500, 4000), (W, 4000))

    # Drzwi (osobna warstwa — łuki przejść)
    msp.add_arc((5000, 1000), 800, 0, 90, dxfattribs={"layer": "DOORS"})
    msp.add_arc((8500, 5000), 800, 90, 180, dxfattribs={"layer": "DOORS"})

    # Etykiety pomieszczeń
    labels = [
        (2500, 2000, "BIURO 1"),
        (2500, 6000, "BIURO 2"),
        (6750, 4000, "OPEN SPACE"),
        (10250, 2000, "SERWEROWNIA"),
        (10250, 6000, "SALA KONF."),
    ]
    for x, y, txt in labels:
        msp.add_text(
            txt,
            dxfattribs={"layer": "TEXT", "height": 300, "insert": (x, y)},
        )

    path.parent.mkdir(parents=True, exist_ok=True)
    doc.saveas(path)
    print(f"Zapisano: {path}")


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("tests/fixtures/sample-floor.dxf")
    build(out)
