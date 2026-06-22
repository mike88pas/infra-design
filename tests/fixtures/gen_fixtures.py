#!/usr/bin/env python3
"""
Generator syntetycznych rzutów DXF do testów F1 (import_dxf + polygonize).
Uruchom interpreterem z ezdxf, np. sidecarowym venv:
    ../../sidecar/.venv/Scripts/python.exe gen_fixtures.py

Tworzy:
  sample_office_clean.dxf  — czyste warstwy (A-WALL/A-DOOR/A-GLAZ/A-AREA/A-TEXT),
                             pomieszczenia jako zamknięte LWPOLYLINE → łatwy polygonize.
  sample_office_dirty.dxf  — wszystko na warstwie 0, ściany jako LINE z mikro-szczelinami
                             w narożnikach → test snapowania/tolerancji.
Jednostki: mm. Obrys ~20×13 m.
"""

import os
import ezdxf

ROOMS = [
    ("Recepcja", 400, 400, 6000, 4000),
    ("Sala konferencyjna", 6800, 400, 5600, 4000),
    ("Open space", 12800, 400, 6800, 6000),
    ("Korytarz", 400, 4800, 12000, 1600),
    ("Serwerownia", 400, 6800, 4000, 5800),
    ("Pom. socjalne", 4800, 6800, 4800, 5800),
    ("WC", 10000, 6800, 2400, 5800),
    ("Biuro 2", 12800, 6800, 6800, 5800),
]


def _rect(x, y, w, h):
    return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]


def make_clean(path):
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4  # mm
    for name, color in [("A-WALL", 7), ("A-DOOR", 3), ("A-GLAZ", 5), ("A-AREA", 8), ("A-TEXT", 2)]:
        if name not in doc.layers:
            doc.layers.add(name, color=color)
    msp = doc.modelspace()

    # Obrys budynku
    msp.add_lwpolyline(_rect(0, 0, 20000, 13000), close=True, dxfattribs={"layer": "A-WALL"})

    for name, x, y, w, h in ROOMS:
        # ściany pomieszczenia jako zamknięty obrys (czysty → polygonize łatwy)
        msp.add_lwpolyline(_rect(x, y, w, h), close=True, dxfattribs={"layer": "A-WALL"})
        # drzwi (kreska w ścianie)
        msp.add_line((x + w / 2 - 450, y), (x + w / 2 + 450, y), dxfattribs={"layer": "A-DOOR"})
        # opis pomieszczenia
        msp.add_text(
            name, height=300, dxfattribs={"layer": "A-TEXT"}
        ).set_placement((x + 300, y + h - 600))

    # przykładowe okno na elewacji
    msp.add_line((2000, 0), (4000, 0), dxfattribs={"layer": "A-GLAZ"})

    doc.saveas(path)
    return path


def make_dirty(path):
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 4
    msp = doc.modelspace()  # wszystko na "0"
    gap = 60  # mikro-szczelina w narożnikach (mm)

    def walls_with_gaps(x, y, w, h):
        c = _rect(x, y, w, h)
        for i in range(4):
            a = c[i]
            b = c[(i + 1) % 4]
            dx = (b[0] - a[0])
            dy = (b[1] - a[1])
            ln = (dx ** 2 + dy ** 2) ** 0.5
            ux, uy = dx / ln, dy / ln
            a2 = (a[0] + ux * gap, a[1] + uy * gap)
            b2 = (b[0] - ux * gap, b[1] - uy * gap)
            msp.add_line(a2, b2, dxfattribs={"layer": "0"})

    walls_with_gaps(0, 0, 20000, 13000)
    for _, x, y, w, h in ROOMS:
        walls_with_gaps(x, y, w, h)

    doc.saveas(path)
    return path


def make_nested(path):
    """Rzut „jak od klienta": ściany ukryte w JEDNYM bloku podkładu (test eksplozji),
    urządzenia jako bloki INSERT na warstwach PST_* z atrybutami IDFX/NR (test extract_devices).
    """
    doc = ezdxf.new("R2018")
    doc.header["$INSUNITS"] = 4  # mm
    for name, color in [
        ("PODKLAD", 8), ("PST_gniazda_RJ-45", 1), ("PST_gniazda CCTV", 2),
        ("PST_gniazda AP", 3), ("PST_kontrola dostępu", 5),
    ]:
        if name not in doc.layers:
            doc.layers.add(name, color=color)

    # Blok podkładu: ściany na A-WALL — dwa pomieszczenia 6×8 i 8×8 m (wspólna ściana).
    base = doc.blocks.new(name="ARCH_BASE")
    base.add_lwpolyline(_rect(0, 0, 6000, 8000), close=True, dxfattribs={"layer": "A-WALL"})
    base.add_lwpolyline(_rect(6000, 0, 8000, 8000), close=True, dxfattribs={"layer": "A-WALL"})

    # Blok symbolu urządzenia z definicją atrybutów (IDFX/NR).
    dev = doc.blocks.new(name="DEV_RJ45")
    dev.add_circle((0, 0), 120, dxfattribs={"layer": "0"})
    dev.add_attdef("IDFX", dxfattribs={"layer": "0", "height": 100}).set_placement((150, 0))
    dev.add_attdef("NR", dxfattribs={"layer": "0", "height": 100}).set_placement((150, 150))

    msp = doc.modelspace()
    # Podkład jako jeden INSERT na warstwie PODKLAD — ścian nie widać bez eksplozji.
    msp.add_blockref("ARCH_BASE", (0, 0), dxfattribs={"layer": "PODKLAD"})

    # Urządzenia LAN (z atrybutami) — 4 gniazda RJ-45.
    for i, (x, y) in enumerate([(1000, 1000), (3000, 1000), (8000, 1000), (11000, 1000)]):
        ref = msp.add_blockref("DEV_RJ45", (x, y), dxfattribs={"layer": "PST_gniazda_RJ-45"})
        ref.add_auto_attribs({"IDFX": f"PPD1.{i + 1}/X1/", "NR": str(2 * (i + 1))})

    # CCTV (3), AP (2), KD (1) — proste markery bez atrybutów.
    for x, y in [(2000, 6000), (9000, 6000), (12000, 6000)]:
        msp.add_blockref("DEV_RJ45", (x, y), dxfattribs={"layer": "PST_gniazda CCTV"})
    for x, y in [(2500, 3000), (9500, 3000)]:
        msp.add_blockref("DEV_RJ45", (x, y), dxfattribs={"layer": "PST_gniazda AP"})
    msp.add_blockref("DEV_RJ45", (500, 4000), dxfattribs={"layer": "PST_kontrola dostępu"})

    doc.saveas(path)
    return path


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    c = make_clean(os.path.join(here, "sample_office_clean.dxf"))
    d = make_dirty(os.path.join(here, "sample_office_dirty.dxf"))
    n = make_nested(os.path.join(here, "sample_nested_devices.dxf"))
    print("OK:", os.path.basename(c), "+", os.path.basename(d), "+", os.path.basename(n))
