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
    ping            — handshake (wersja ezdxf/Pythona)              [F0]
    import_dxf      — wczytanie rzutu DXF → warstwy + encje + bbox  [F1]
    polygonize      — wykrycie pomieszczeń z segmentów ścian        [F1]
    extract_devices — INSERT-y (symbole urządzeń) → warstwa+poz+atr [F2]
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


# ── pomocnicze: ściany w blokach ─────────────────────────────────────────────

# Maks. głębokość rekurencji przy eksplozji bloków (ochrona przed zagnieżdżeniem/cyklem).
_MAX_EXPLODE_DEPTH = 6


def _layer_matches(layer: str, wall_set) -> bool:
    """Czy warstwa należy do zbioru ścian (None = wszystkie).

    Dopasowanie po podłańcuchu: encje eksplodowane z bloku mają warstwy typu
    '<blok>$0$A-WALL', więc token 'A-WALL' (czy 'WALL') z `wallLayers` je złapie.
    """
    if wall_set is None:
        return True
    if layer in wall_set:
        return True
    return any(w in layer for w in wall_set)


def _iter_wall_geometry(entity, explode, depth=0):
    """Yield-uje LINE/LWPOLYLINE/POLYLINE z encji lub — gdy `explode` — z wnętrza
    bloków INSERT (rekurencyjnie, w WCS przez virtual_entities). Podkład
    architektoniczny bywa wstawiony jako jeden blok; bez eksplozji jego ścian nie widać.
    """
    t = entity.dxftype()
    if t in ("LINE", "LWPOLYLINE", "POLYLINE"):
        yield entity
    elif t == "INSERT" and explode and depth < _MAX_EXPLODE_DEPTH:
        try:
            for sub in entity.virtual_entities():
                yield from _iter_wall_geometry(sub, explode, depth + 1)
        except Exception as exc:  # noqa: BLE001 — wadliwy blok nie wywala importu
            print(f"[polygonize] explode pominięty: {exc}", file=sys.stderr, flush=True)


# ── polygonize ──────────────────────────────────────────────────────────────

@handler("polygonize")
def _polygonize(params):
    """
    Buduje zamknięte pomieszczenia z segmentów (LINE/LWPOLYLINE) wskazanych warstw.
    Obsługuje „brudny" DXF (niedomknięte narożniki) snapowaniem do siatki.

    params: {
        "path": str,                 # ścieżka DXF
        "wallLayers": [str]?,        # warstwy ścian (dopasowanie po podłańcuchu; domyślnie: wszystkie)
        "explodeBlocks": bool?,      # wejdź w bloki INSERT (ściany w podkładzie); domyślnie False
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
    explode = bool(params.get("explodeBlocks", False))

    doc = ezdxf.readfile(path)
    msp = doc.modelspace()

    # Zbierz segmenty + oszacuj rozmiar rysunku (do auto-snapu)
    segments = []  # list[((x1,y1),(x2,y2))]
    bbox = _BBox()

    def emit(geom) -> None:
        t = geom.dxftype()
        if t == "LINE":
            a, b = geom.dxf.start, geom.dxf.end
            segments.append(((a.x, a.y), (b.x, b.y)))
            bbox.add(a.x, a.y)
            bbox.add(b.x, b.y)
        else:  # LWPOLYLINE / POLYLINE
            if t == "LWPOLYLINE":
                pts = [(x, y) for x, y in geom.get_points("xy")]
                closed = bool(geom.closed)
            else:
                pts = [(v.dxf.location.x, v.dxf.location.y) for v in geom.vertices]
                closed = bool(geom.is_closed)
            if closed and len(pts) > 2:
                pts = pts + [pts[0]]
            for i in range(len(pts) - 1):
                segments.append((pts[i], pts[i + 1]))
            for x, y in pts:
                bbox.add(x, y)

    for e in msp:
        if len(segments) >= MAX_ENTITIES:
            break
        for geom in _iter_wall_geometry(e, explode):
            if _layer_matches(getattr(geom.dxf, "layer", "0"), wall_set):
                emit(geom)

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


# ── extract_devices ──────────────────────────────────────────────────────────

@handler("extract_devices")
def _extract_devices(params):
    """
    Zwraca symbole urządzeń (bloki INSERT z modelspace) wraz z warstwą, pozycją,
    obrotem i atrybutami (ATTRIB, np. IDFX/NR — przypisanie portu do szafy).

    Mapowanie warstwa→system/typ robi strona TS (src/domain/dxf/systemMapping.ts) —
    symbole bywają blokami anonimowymi (*U34), więc klasyfikacja idzie po WARSTWIE.

    params: {
        "path": str,
        "layers": [str]?,        # filtr po podłańcuchu nazwy warstwy (domyślnie: wszystkie)
        "includeAttribs": bool?  # dołącz atrybuty ATTRIB (domyślnie True)
    }
    return: { inserts: [{layer,name,at,rotation,sx,sy,attribs}], count }
    """
    import ezdxf  # type: ignore

    path = params.get("path")
    if not path:
        raise ValueError("extract_devices: brak parametru 'path'")

    layer_filter = params.get("layers")
    include_attribs = params.get("includeAttribs", True)

    doc = ezdxf.readfile(path)
    msp = doc.modelspace()

    inserts = []
    for ins in msp.query("INSERT"):
        layer = getattr(ins.dxf, "layer", "0")
        if layer_filter and not any(f in layer for f in layer_filter):
            continue
        p = ins.dxf.insert
        attribs = {}
        if include_attribs:
            try:
                for a in ins.attribs:
                    attribs[a.dxf.tag] = a.dxf.text
            except Exception:  # noqa: BLE001 — brak/wadliwe atrybuty nie blokują encji
                pass
        inserts.append({
            "layer": layer,
            "name": ins.dxf.name,
            "at": {"x": p.x, "y": p.y},
            "rotation": float(ins.dxf.rotation or 0.0),
            "sx": float(ins.dxf.xscale or 1.0),
            "sy": float(ins.dxf.yscale or 1.0),
            "attribs": attribs,
        })

    return {"inserts": inserts, "count": len(inserts)}


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
