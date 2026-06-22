#!/usr/bin/env python3
"""
Infra Design — sidecar geometrii (ezdxf / Shapely / A*).

Protokół: newline-delimited JSON przez stdio.
    request : {"id": int, "method": str, "params": dict}\n   (stdin)
    response: {"id": int, "ok": true, "result": any}\n         (stdout)
            | {"id": int, "ok": false, "error": str}\n          (stdout)

stdout jest zarezerwowany WYŁĄCZNIE dla protokołu (jeden JSON na linię).
Diagnostyka idzie na stderr.

Metody:
    ping        — handshake (wersja ezdxf/Pythona)            [F0]
    import_dxf  — wczytanie rzutu DXF → warstwy + encje + bbox [F1]
    polygonize  — wykrycie pomieszczeń z segmentów ścian       [F1]
"""

import json
import sys
import platform


def _ezdxf_version() -> str:
    try:
        import ezdxf  # type: ignore
        return getattr(ezdxf, "__version__", "unknown")
    except Exception as exc:  # noqa: BLE001
        return f"missing ({exc.__class__.__name__})"


HANDLERS = {}


def handler(name):
    def deco(fn):
        HANDLERS[name] = fn
        return fn
    return deco


# ── Pomocnicze ──────────────────────────────────────────────────────────────

# Ochrona pamięci: twardy limit encji renderowalnych z jednego DXF.
MAX_ENTITIES = 300_000

# $INSUNITS → jednostka modelu. Schema TS zna tylko mm|m; cm/in mapujemy na mm.
_INSUNITS_M = {6: "m"}  # 6 = metry; reszta traktowana jak mm


def _aci_to_hex(aci, default="#c8c8c8") -> str:
    """Kolor ACI (indeks AutoCAD) → hex. BYLAYER/BYBLOCK → domyślny."""
    try:
        from ezdxf import colors as ezcolors  # type: ignore
        if aci is None or aci in (0, 256):
            return default
        r, g, b = ezcolors.aci2rgb(abs(int(aci)))
        return f"#{r:02x}{g:02x}{b:02x}"
    except Exception:  # noqa: BLE001
        return default


class _BBox:
    """Akumulator prostokąta otaczającego."""

    __slots__ = ("minx", "miny", "maxx", "maxy", "_set")

    def __init__(self):
        self.minx = self.miny = float("inf")
        self.maxx = self.maxy = float("-inf")
        self._set = False

    def add(self, x: float, y: float) -> None:
        if x < self.minx:
            self.minx = x
        if y < self.miny:
            self.miny = y
        if x > self.maxx:
            self.maxx = x
        if y > self.maxy:
            self.maxy = y
        self._set = True

    def to_json(self) -> dict:
        if not self._set:
            return {"minX": 0.0, "minY": 0.0, "maxX": 0.0, "maxY": 0.0}
        return {
            "minX": self.minx,
            "minY": self.miny,
            "maxX": self.maxx,
            "maxY": self.maxy,
        }

    def diagonal(self) -> float:
        if not self._set:
            return 0.0
        dx = self.maxx - self.minx
        dy = self.maxy - self.miny
        return (dx * dx + dy * dy) ** 0.5


# ── ping ────────────────────────────────────────────────────────────────────

@handler("ping")
def _ping(_params):
    return {
        "pong": True,
        "ezdxf": _ezdxf_version(),
        "python": platform.python_version(),
    }


# ── import_dxf ──────────────────────────────────────────────────────────────

@handler("import_dxf")
def _import_dxf(params):
    """
    params: { "path": str }
    return: DxfDocument { layers, entities, bbox, units, entityCount, truncated? }
    """
    import ezdxf  # type: ignore

    path = params.get("path")
    if not path:
        raise ValueError("import_dxf: brak parametru 'path'")

    doc = ezdxf.readfile(path)
    msp = doc.modelspace()

    units = _INSUNITS_M.get(int(doc.header.get("$INSUNITS", 0) or 0), "mm")

    # Warstwy (kolor: true-color jeśli jest, inaczej z ACI)
    layers = []
    for lay in doc.layers:
        rgb = lay.rgb if lay.rgb else None
        if rgb:
            color = "#{:02x}{:02x}{:02x}".format(*rgb)
        else:
            color = _aci_to_hex(lay.color)
        layers.append({
            "name": lay.dxf.name,
            "color": color,
            "visible": not bool(lay.is_off()),
        })

    bbox = _BBox()
    entities = []
    truncated = 0

    def cap() -> bool:
        nonlocal truncated
        if len(entities) >= MAX_ENTITIES:
            truncated += 1
            return True
        return False

    for e in msp:
        dxftype = e.dxftype()
        layer = getattr(e.dxf, "layer", "0")
        try:
            if dxftype == "LINE":
                if cap():
                    continue
                a, b = e.dxf.start, e.dxf.end
                bbox.add(a.x, a.y)
                bbox.add(b.x, b.y)
                entities.append({
                    "t": "line", "layer": layer,
                    "a": {"x": a.x, "y": a.y},
                    "b": {"x": b.x, "y": b.y},
                })
            elif dxftype == "LWPOLYLINE":
                if cap():
                    continue
                pts = [{"x": x, "y": y} for x, y in e.get_points("xy")]
                for p in pts:
                    bbox.add(p["x"], p["y"])
                entities.append({
                    "t": "polyline", "layer": layer,
                    "pts": pts, "closed": bool(e.closed),
                })
            elif dxftype == "POLYLINE":
                if cap():
                    continue
                pts = [{"x": v.dxf.location.x, "y": v.dxf.location.y} for v in e.vertices]
                for p in pts:
                    bbox.add(p["x"], p["y"])
                entities.append({
                    "t": "polyline", "layer": layer,
                    "pts": pts, "closed": bool(e.is_closed),
                })
            elif dxftype == "CIRCLE":
                if cap():
                    continue
                c, r = e.dxf.center, float(e.dxf.radius)
                bbox.add(c.x - r, c.y - r)
                bbox.add(c.x + r, c.y + r)
                entities.append({
                    "t": "circle", "layer": layer,
                    "c": {"x": c.x, "y": c.y}, "r": r,
                })
            elif dxftype == "ARC":
                if cap():
                    continue
                c, r = e.dxf.center, float(e.dxf.radius)
                bbox.add(c.x - r, c.y - r)
                bbox.add(c.x + r, c.y + r)
                entities.append({
                    "t": "arc", "layer": layer,
                    "c": {"x": c.x, "y": c.y}, "r": r,
                    "start": float(e.dxf.start_angle),
                    "end": float(e.dxf.end_angle),
                })
            elif dxftype == "INSERT":
                if cap():
                    continue
                p = e.dxf.insert
                bbox.add(p.x, p.y)
                entities.append({
                    "t": "insert", "layer": layer,
                    "at": {"x": p.x, "y": p.y},
                    "name": e.dxf.name,
                    "rotation": float(e.dxf.rotation or 0.0),
                    "sx": float(e.dxf.xscale or 1.0),
                    "sy": float(e.dxf.yscale or 1.0),
                })
            elif dxftype in ("TEXT", "MTEXT"):
                if cap():
                    continue
                if dxftype == "TEXT":
                    p = e.dxf.insert
                    txt = e.dxf.text
                    h = float(e.dxf.height or 0.0)
                else:
                    p = e.dxf.insert
                    txt = e.plain_text()
                    h = float(e.dxf.char_height or 0.0)
                bbox.add(p.x, p.y)
                entities.append({
                    "t": "text", "layer": layer,
                    "at": {"x": p.x, "y": p.y},
                    "text": txt, "height": h,
                })
        except Exception as exc:  # noqa: BLE001 — pojedyncza wadliwa encja nie wywala importu
            print(f"[import_dxf] pomijam {dxftype}: {exc}", file=sys.stderr, flush=True)

    result = {
        "layers": layers,
        "entities": entities,
        "bbox": bbox.to_json(),
        "units": units,
        "entityCount": len(entities),
    }
    if truncated:
        result["truncated"] = truncated
    return result


# ── polygonize ──────────────────────────────────────────────────────────────

@handler("polygonize")
def _polygonize(params):
    """
    Buduje zamknięte pomieszczenia z segmentów (LINE/LWPOLYLINE) wskazanych warstw.
    Obsługuje „brudny" DXF (niedomknięte narożniki) snapowaniem do siatki.

    params: {
        "path": str,                 # ścieżka DXF
        "wallLayers": [str]?,        # warstwy ścian (domyślnie: wszystkie)
        "snap": float?,              # tolerancja snapu (jedn. modelu); auto z bbox
        "minArea": float?            # min. pole pomieszczenia (jedn.^2)
    }
    return: PolygonizeResult { polygons:[{points,area}], snapTolerance }
    """
    import ezdxf  # type: ignore
    from shapely.geometry import LineString  # type: ignore
    from shapely.ops import unary_union, polygonize  # type: ignore

    path = params.get("path")
    if not path:
        raise ValueError("polygonize: brak parametru 'path'")

    wall_layers = params.get("wallLayers")
    wall_set = set(wall_layers) if wall_layers else None

    doc = ezdxf.readfile(path)
    msp = doc.modelspace()

    # Zbierz segmenty + oszacuj rozmiar rysunku (do auto-snapu)
    segments = []  # list[((x1,y1),(x2,y2))]
    bbox = _BBox()

    def want(layer: str) -> bool:
        return wall_set is None or layer in wall_set

    for e in msp:
        t = e.dxftype()
        layer = getattr(e.dxf, "layer", "0")
        if not want(layer):
            continue
        if t == "LINE":
            a, b = e.dxf.start, e.dxf.end
            segments.append(((a.x, a.y), (b.x, b.y)))
            bbox.add(a.x, a.y)
            bbox.add(b.x, b.y)
        elif t in ("LWPOLYLINE", "POLYLINE"):
            if t == "LWPOLYLINE":
                pts = [(x, y) for x, y in e.get_points("xy")]
                closed = bool(e.closed)
            else:
                pts = [(v.dxf.location.x, v.dxf.location.y) for v in e.vertices]
                closed = bool(e.is_closed)
            if closed and len(pts) > 2:
                pts = pts + [pts[0]]
            for i in range(len(pts) - 1):
                segments.append((pts[i], pts[i + 1]))
            for x, y in pts:
                bbox.add(x, y)

    if not segments:
        return {"polygons": [], "snapTolerance": 0.0}

    diag = bbox.diagonal()
    snap = params.get("snap")
    if snap is None:
        # ~0.1% przekątnej rysunku — domyka typowe luki narożników brudnego DXF
        snap = max(diag * 0.001, 1e-9)
    snap = float(snap)

    def snapped(pt):
        if snap <= 0:
            return pt
        return (round(pt[0] / snap) * snap, round(pt[1] / snap) * snap)

    lines = []
    for a, b in segments:
        sa, sb = snapped(a), snapped(b)
        if sa != sb:
            lines.append(LineString([sa, sb]))

    if not lines:
        return {"polygons": [], "snapTolerance": snap}

    merged = unary_union(lines)
    faces = list(polygonize(merged))

    min_area = params.get("minArea")
    if min_area is None:
        # odfiltruj artefakty: < ~0.01% pola bboxa
        area_bbox = max((bbox.maxx - bbox.minx) * (bbox.maxy - bbox.miny), 1.0)
        min_area = area_bbox * 1e-4
    min_area = float(min_area)

    polygons = []
    for poly in faces:
        if poly.area < min_area:
            continue
        coords = list(poly.exterior.coords)[:-1]  # bez powtórzonego pkt zamykającego
        polygons.append({
            "points": [{"x": x, "y": y} for x, y in coords],
            "area": float(poly.area),
        })

    polygons.sort(key=lambda p: p["area"], reverse=True)
    return {"polygons": polygons, "snapTolerance": snap}


# ── pętla protokołu ─────────────────────────────────────────────────────────

def dispatch(method: str, params: dict):
    fn = HANDLERS.get(method)
    if fn is None:
        raise ValueError(f"Nieznana metoda: {method}")
    return fn(params or {})


def main() -> int:
    print("infra-design sidecar gotowy", file=sys.stderr, flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            msg_id = msg.get("id")
            result = dispatch(msg.get("method", ""), msg.get("params"))
            out = {"id": msg_id, "ok": True, "result": result}
        except Exception as exc:  # noqa: BLE001
            out = {
                "id": locals().get("msg_id"),
                "ok": False,
                "error": f"{exc.__class__.__name__}: {exc}",
            }
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
