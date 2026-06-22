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


def _iter_exploded(entity, explode, depth=0):
    """Yield-uje encje-liście: gdy `explode` i to INSERT — rekurencyjnie wnętrze
    bloku (w WCS przez virtual_entities); w przeciwnym razie samą encję. Podkład
    architektoniczny bywa wstawiony jako jeden blok — bez eksplozji jego wnętrza nie widać.
    """
    if entity.dxftype() == "INSERT" and explode and depth < _MAX_EXPLODE_DEPTH:
        try:
            for sub in entity.virtual_entities():
                yield from _iter_exploded(sub, explode, depth + 1)
        except Exception as exc:  # noqa: BLE001 — wadliwy blok nie wywala importu
            print(f"[explode] pominięty blok: {exc}", file=sys.stderr, flush=True)
    else:
        yield entity


def _iter_wall_geometry(entity, explode, depth=0):
    """Jak `_iter_exploded`, ale tylko geometria ścian (LINE/LWPOLYLINE/POLYLINE)."""
    for g in _iter_exploded(entity, explode, depth):
        if g.dxftype() in ("LINE", "LWPOLYLINE", "POLYLINE"):
            yield g


_MTEXT_UNICODE_RE = None


def _decode_mtext(text: str) -> str:
    """Dekoduje escapy '\\U+XXXX' (polskie znaki w MTEXT, np. ł=U+0142) i czyści białe znaki."""
    import re
    global _MTEXT_UNICODE_RE
    if _MTEXT_UNICODE_RE is None:
        _MTEXT_UNICODE_RE = re.compile(r"\\U\+([0-9A-Fa-f]{4})")
    return _MTEXT_UNICODE_RE.sub(lambda m: chr(int(m.group(1), 16)), text).strip()


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


# ── extract_rooms ────────────────────────────────────────────────────────────

# Numer pomieszczenia: 1.11, 1.13A, 0.2 ; pole: "224.64 m²", "3,09 m2"
_ROOM_NUM_RE = None
_ROOM_AREA_RE = None


def _parse_room_label(parts):
    """Z listy linii MTEXT (numer/nazwa/pole) buduje (number, name, areaM2)."""
    import re
    global _ROOM_NUM_RE, _ROOM_AREA_RE
    if _ROOM_NUM_RE is None:
        _ROOM_NUM_RE = re.compile(r"^\d+\.\w+$")
        _ROOM_AREA_RE = re.compile(r"([\d ]+[.,]\d+)\s*m[²2]?", re.I)
    number, area, name_parts = "", None, []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        am = _ROOM_AREA_RE.search(p)
        if am and area is None:
            area = float(am.group(1).replace(" ", "").replace(",", "."))
            continue
        if not number and _ROOM_NUM_RE.match(p):
            number = p
            continue
        name_parts.append(p)
    return number, " ".join(name_parts), area


@handler("extract_rooms")
def _extract_rooms(params):
    """
    Wykaz pomieszczeń z etykiet pól (warstwy A-AREA itp.): numer + nazwa + oficjalny
    metraż (m²) nadane przez architekta. To czystsze źródło niż rekonstrukcja ze ścian.

    Ramka etykiety to zamknięta polilinia; numer/nazwa/pole to MTEXT-y w jej obrysie.

    params: {
        "path": str,
        "areaLayers": [str]?,     # podłańcuchy warstw pól (domyślnie ['AREA'])
        "explodeBlocks": bool?    # wejdź w bloki (domyślnie True — etykiety bywają w podkładzie)
    }
    return: { rooms: [{number, name, areaM2, at:{x,y}, tag:[{x,y}]}], count }
    """
    import ezdxf  # type: ignore
    from shapely.geometry import Polygon, Point as SPoint  # type: ignore

    path = params.get("path")
    if not path:
        raise ValueError("extract_rooms: brak parametru 'path'")

    area_layers = params.get("areaLayers") or ["AREA"]
    explode = params.get("explodeBlocks", True)

    doc = ezdxf.readfile(path)
    msp = doc.modelspace()

    def on_area(layer: str) -> bool:
        return any(a in layer for a in area_layers)

    tags = []  # list[(Polygon, [pts])]
    texts = []  # list[(x, y, str)]
    for e in msp:
        for g in _iter_exploded(e, explode):
            layer = getattr(g.dxf, "layer", "0")
            if not on_area(layer):
                continue
            t = g.dxftype()
            if t in ("LWPOLYLINE", "POLYLINE"):
                try:
                    if t == "LWPOLYLINE":
                        pts = [(x, y) for x, y in g.get_points("xy")]
                        closed = bool(g.closed)
                    else:
                        pts = [(v.dxf.location.x, v.dxf.location.y) for v in g.vertices]
                        closed = bool(g.is_closed)
                    if closed and len(pts) >= 3:
                        tags.append((Polygon(pts), pts))
                except Exception:  # noqa: BLE001
                    pass
            elif t in ("TEXT", "MTEXT"):
                try:
                    raw = g.plain_text() if t == "MTEXT" else g.dxf.text
                    p = g.dxf.insert
                    texts.append((p.x, p.y, _decode_mtext(raw)))
                except Exception:  # noqa: BLE001
                    pass

    rooms = []
    seen = set()
    for poly, pts in tags:
        inside = [txt for (x, y, txt) in texts if poly.contains(SPoint(x, y))]
        if not inside:
            continue
        # Spłaszcz wieloliniowe MTEXT-y (numer/nazwa/pole bywają w jednym lub osobnych).
        lines = [ln for txt in inside for ln in txt.split("\n")]
        number, name, area_m2 = _parse_room_label(lines)
        if not name and not number:
            continue
        key = number or name
        if key in seen:
            continue
        seen.add(key)
        c = poly.centroid
        rooms.append({
            "number": number,
            "name": name,
            "areaM2": area_m2,
            "at": {"x": c.x, "y": c.y},
            "tag": [{"x": x, "y": y} for x, y in pts],
        })

    rooms.sort(key=lambda r: (r["areaM2"] or 0), reverse=True)
    return {"rooms": rooms, "count": len(rooms)}


# ── route_cables (A*) ─────────────────────────────────────────────────────────

# Siatka A*: górny limit komórek na dłuższym boku (ochrona pamięci/czasu).
_ROUTE_MAX_CELLS_SIDE = 220


def _dijkstra_multi(seeds, blocked, w, h):
    """Multi-source Dijkstra od celów (szaf) po całej wolnej siatce — JEDNO przejście.
    seeds: list[(targetIndex, (gx,gy))]. Zwraca (dist, parent, origin) per komórka.
    Każde urządzenie odczytuje potem swój koszt i trasę backtrace — bez N osobnych A*.
    """
    import heapq

    dist = {}
    parent = {}
    origin = {}
    heap = []
    for idx, c in seeds:
        if c in blocked:
            continue
        if c not in dist:
            dist[c] = 0.0
            parent[c] = None
            origin[c] = idx
            heapq.heappush(heap, (0.0, c))
    nbrs = ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1))
    while heap:
        d, cur = heapq.heappop(heap)
        if d > dist.get(cur, float("inf")):
            continue
        cx, cy = cur
        for dx, dy in nbrs:
            nx, ny = cx + dx, cy + dy
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            nb = (nx, ny)
            if nb in blocked:
                continue
            nd = d + (1.41421356 if (dx and dy) else 1.0)
            if nd < dist.get(nb, float("inf")):
                dist[nb] = nd
                parent[nb] = cur
                origin[nb] = origin[cur]
                heapq.heappush(heap, (nd, nb))
    return dist, parent, origin


@handler("route_cables")
def _route_cables(params):
    """
    Trasuje kable od źródeł (urządzeń) do najbliższego celu (szafy) algorytmem A*
    po siatce z przeszkodami ze ścian. Brak przejścia → linia prosta (fallback).
    Długości w JEDNOSTKACH MODELU (TS przelicza na metry przez unitMm).

    params: {
        "path": str,
        "sources": [{x,y}],         # urządzenia
        "targets": [{x,y}],         # szafy/rozdzielnie
        "wallLayers": [str]?,       # ściany-przeszkody (dopasowanie po podłańcuchu)
        "explodeBlocks": bool?,     # wejdź w bloki (domyślnie True)
        "cell": float?,             # rozmiar komórki (auto z bboxa)
        "inflate": int?             # pogrubienie ścian w komórkach (domyślnie 0)
    }
    return: { routes: [{sourceIndex, targetIndex, path:[{x,y}], length, method}], cell, grid:{w,h} }
    """
    import ezdxf  # type: ignore

    path = params.get("path")
    sources = params.get("sources") or []
    targets = params.get("targets") or []
    if not path:
        raise ValueError("route_cables: brak parametru 'path'")
    if not sources or not targets:
        return {"routes": [], "cell": 0.0, "grid": {"w": 0, "h": 0}}

    wall_layers = params.get("wallLayers")
    wall_set = set(wall_layers) if wall_layers else None
    explode = params.get("explodeBlocks", True)
    inflate = int(params.get("inflate", 0))

    doc = ezdxf.readfile(path)
    msp = doc.modelspace()

    # Segmenty ścian + bbox całości (źródła, cele, ściany)
    segments = []
    bbox = _BBox()
    for s in sources + targets:
        bbox.add(s["x"], s["y"])
    for e in msp:
        for geom in _iter_wall_geometry(e, explode):
            if not _layer_matches(getattr(geom.dxf, "layer", "0"), wall_set):
                continue
            t = geom.dxftype()
            if t == "LINE":
                a, b = geom.dxf.start, geom.dxf.end
                segments.append(((a.x, a.y), (b.x, b.y)))
                bbox.add(a.x, a.y)
                bbox.add(b.x, b.y)
            else:
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

    minx, miny = bbox.minx, bbox.miny
    width = max(bbox.maxx - minx, 1.0)
    height = max(bbox.maxy - miny, 1.0)

    cell = params.get("cell")
    if cell is None:
        cell = max(width, height) / _ROUTE_MAX_CELLS_SIDE
    cell = float(max(cell, 1e-6))

    w = int(width / cell) + 2
    h = int(height / cell) + 2

    def to_cell(p):
        return (int((p["x"] - minx) / cell), int((p["y"] - miny) / cell))

    def to_cell_xy(x, y):
        return (int((x - minx) / cell), int((y - miny) / cell))

    # Rasteryzacja ścian → blocked
    blocked = set()
    for (ax, ay), (bx, by) in segments:
        steps = int((abs(bx - ax) + abs(by - ay)) / cell) + 1
        for i in range(steps + 1):
            t = i / steps
            blocked.add(to_cell_xy(ax + (bx - ax) * t, ay + (by - ay) * t))
    if inflate > 0:
        extra = set()
        for (cx, cy) in blocked:
            for dx in range(-inflate, inflate + 1):
                for dy in range(-inflate, inflate + 1):
                    extra.add((cx + dx, cy + dy))
        blocked = extra

    # Jedno przejście Dijkstry od wszystkich szaf po wolnej siatce.
    seeds = []
    for ti, t in enumerate(targets):
        tc = to_cell(t)
        seeds.append((ti, tc if tc not in blocked else _nearest_free(tc, blocked, w, h)))
    seeds = [(ti, c) for ti, c in seeds if c is not None]
    dist, parent, origin = _dijkstra_multi(seeds, blocked, w, h)

    def to_point(c):
        return {"x": minx + (c[0] + 0.5) * cell, "y": miny + (c[1] + 0.5) * cell}

    routes = []
    for si, s in enumerate(sources):
        sc = to_cell(s)
        start = sc if (sc in dist) else _nearest_free(sc, blocked, w, h)
        if start is not None and start in dist:
            cells = [start]
            cur = start
            while parent.get(cur) is not None:
                cur = parent[cur]
                cells.append(cur)
            length = dist[start] * cell
            routes.append({
                "sourceIndex": si, "targetIndex": origin[start],
                "path": [to_point(c) for c in cells], "length": length, "method": "astar",
            })
        else:
            # brak przejścia (źródło odcięte) → linia prosta do najbliższego celu
            ti = min(range(len(targets)), key=lambda j: (targets[j]["x"] - s["x"]) ** 2 + (targets[j]["y"] - s["y"]) ** 2)
            tgt = targets[ti]
            length = ((tgt["x"] - s["x"]) ** 2 + (tgt["y"] - s["y"]) ** 2) ** 0.5
            routes.append({
                "sourceIndex": si, "targetIndex": ti,
                "path": [{"x": s["x"], "y": s["y"]}, {"x": tgt["x"], "y": tgt["y"]}],
                "length": length, "method": "straight",
            })

    return {"routes": routes, "cell": cell, "grid": {"w": w, "h": h}}


def _nearest_free(cell, blocked, w, h, max_r=8):
    """Najbliższa wolna komórka wokół `cell` (gdy źródło/cel wpadło na ścianę)."""
    cx, cy = cell
    if 0 <= cx < w and 0 <= cy < h and cell not in blocked:
        return cell
    for r in range(1, max_r + 1):
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                nx, ny = cx + dx, cy + dy
                if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in blocked:
                    return (nx, ny)
    return None


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
