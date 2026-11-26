#!/usr/bin/env python3
"""Where each year's photographs end: data/outlines.json.

    python3 scripts/bake_outlines.py [--local <folder of .pmtiles files>] [--only 1971,2002] [--debug <folder>]

For every year on the timeline, each of its sources (js/sources.js) is asked where it has picture:

  our own tile files   the tiles themselves (zoom 14): picture where a tile's alpha is above 0
  cached tile services their tiles (zoom 13): picture where a tile is neither transparent nor flat black
  county map services  an export of their whole box (15 m a pixel): picture where it is neither transparent nor white
  county image services the same, by exportImage: picture where it is neither transparent, white nor black
  DRCOG's mosaics      an export of the region (60 m a pixel): picture where it is not transparent
  DRCOG's archive      the tile boxes in data/index/<year>.json

The answers are laid on one grid and joined, so a year gets one edge whatever its sources are ("edge"). Each outside
service's own picture is kept too, shrunk by one or two pixels ("cut"): the page cuts that service's layer along it, so the
flat white or black the service paints where it has no picture never shows. Edges are simplified
(about 1.5 grid pixels), specks under 0.2 km2 are dropped, only outer edges are kept, and each ring is a closed line of [lat, lon] to 5 decimals.
No box published by a service is used: an edge is where its pictures stop.

Needs node, and Python with numpy, Pillow, opencv and pmtiles. Asks each outside service for a few dozen pictures.
"""
import argparse, hashlib, io, json, math, os, subprocess, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
R = 20037508.342789244
UA = {"User-Agent": "Mozilla/5.0 (drapp_view outline bake)"}

DUMP = r"""
const fs = require('fs'); const window = {}; global.window = window; global.self = window;
const proj4 = require('./js/vendor/proj4.js'); global.proj4 = proj4; window.proj4 = proj4;
eval(fs.readFileSync('js/proj.js', 'utf8')); eval(fs.readFileSync('js/sources.js', 'utf8'));
const P = window.DRAPP.proj, S = window.DRAPP.sources.SOURCES, out = { years: {} };
const ll = (x, y) => { const p = P.toLonLat(x, y); return [p.lat, p.lon]; };
const r = P.REGION; out.region = [ll(r.xmin, r.ymin), ll(r.xmax, r.ymin), ll(r.xmax, r.ymax), ll(r.xmin, r.ymax)];
for (const y of Object.keys(S)) {
  const s = S[y]; if (s.sat) continue;
  const o = { stream: s.stream || null, providers: (s.providers || []).map((p) => ({ kind: p.kind, service: p.service, layer: p.layer, url: p.url, pm: p.pm, cover: p.cover, maxZoom: p.maxZoom })), boxes: [] };
  const f = `data/index/${y}.json`;
  if (s.archive === 'tif' && fs.existsSync(f)) for (const t of JSON.parse(fs.readFileSync(f, 'utf8')).tiles) if (t[7] === 'tif') o.boxes.push([ll(t[1], t[2]), ll(t[3], t[2]), ll(t[3], t[4]), ll(t[1], t[4])]);
  out.years[y] = o;
}
process.stdout.write(JSON.stringify(out));
"""


def px(lat, lon, z):
    n = 256 * 2 ** z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def latlon(x, y, z):
    n = 256 * 2 ** z
    return [round(math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n)))), 5), round(x / n * 360 - 180, 5)]


CACHE = None


def fetch(url, timeout=120, tries=3):
    if CACHE:
        f = Path(CACHE) / hashlib.sha1(url.encode()).hexdigest()
        if f.exists():
            return f.read_bytes() or None
        data = _fetch(url, timeout, tries)
        f.write_bytes(data or b"")
        return data
    return _fetch(url, timeout, tries)


def _fetch(url, timeout=120, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (404, 400):
                return None
        except Exception:
            pass
    raise RuntimeError("no answer: " + url[:140])


def picture(data, fill=None):
    """True where an image has picture: not transparent, and not the flat white or black a service paints where it has none."""
    a = np.asarray(Image.open(io.BytesIO(data)).convert("RGBA"))
    m = a[:, :, 3] > 0
    if fill in ("white", "flat"):
        m &= a[:, :, :3].min(axis=2) <= 248
    if fill in ("black", "flat"):
        m &= a[:, :, :3].max(axis=2) >= 12
    return m


class Grid:
    """A year's mask on the zoom-z pixel grid, over the box that holds all its sources."""

    def __init__(self, z, boxes):
        self.z = z
        xs, ys = zip(*[px(lat, lon, z) for b in boxes for lat, lon in b])
        self.x0, self.y0 = int(min(xs)) - 4, int(min(ys)) - 4
        self.m = np.zeros((int(max(ys)) - self.y0 + 8, int(max(xs)) - self.x0 + 8), np.uint8)

    def put(self, mask, z, x0, y0):
        """OR in a mask whose top-left pixel is (x0, y0) on the zoom-z grid."""
        if not mask.any():
            return
        f = 2 ** (self.z - z)
        m = cv2.resize(mask.astype(np.uint8), None, fx=f, fy=f, interpolation=cv2.INTER_NEAREST if f >= 1 else cv2.INTER_AREA) if f != 1 else mask.astype(np.uint8)
        gx, gy = round(x0 * f) - self.x0, round(y0 * f) - self.y0
        h, w = m.shape
        ax, ay, bx, by = max(gx, 0), max(gy, 0), min(gx + w, self.m.shape[1]), min(gy + h, self.m.shape[0])
        if bx > ax and by > ay:
            self.m[ay:by, ax:bx] |= m[ay - gy:by - gy, ax - gx:bx - gx]

    def rings(self, eps=1.5, shrink=0):
        m = cv2.morphologyEx(self.m * 255, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))       # hairline gaps and dark specks are not edges
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))                   # nor are single stray pixels
        if shrink:
            m = cv2.erode(m, np.ones((2 * shrink + 1, 2 * shrink + 1), np.uint8))            # a cut line sits just inside the picture
        mpp = 2 * math.pi * 6378137 * math.cos(math.radians(39.74)) / (256 * 2 ** self.z)
        found, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)   # the outer edge only: a dark lake is not a hole
        out = []
        for c in found:
            if cv2.contourArea(c) * mpp * mpp < 0.2e6:
                continue
            c = cv2.approxPolyDP(c, eps, True)[:, 0, :]
            ring = [latlon(self.x0 + x + 0.5, self.y0 + y + 0.5, self.z) for x, y in c]
            out.append(ring + [ring[0]])
        return out


def from_pm(g, p, local):
    from pmtiles.reader import MmapSource, Reader   # only our own tile files need it
    name = p["pm"]["url"].split("?", 1)[0].rsplit("/", 1)[1]   # the file's name, without a ?v= stamp
    z = min(14, p["maxZoom"] - (1 if p["pm"].get("deep") and p["pm"]["deep"]["zoom"] <= 14 else 0))
    path = Path(local) / name if local else None
    if path and path.exists():
        f = open(path, "rb"); rd = Reader(MmapSource(f))
    else:
        cache = {}

        def get(offset, length, url=p["pm"]["url"]):
            if (offset, length) not in cache:
                req = urllib.request.Request(url, headers={**UA, "Range": f"bytes={offset}-{offset + length - 1}"})
                cache[(offset, length)] = urllib.request.urlopen(req, timeout=60).read()
            return cache[(offset, length)]
        rd = Reader(get)
    s, w, n, e = p["cover"]
    (xa, ya), (xb, yb) = px(n, w, z), px(s, e, z)
    for tx in range(int(xa // 256), int(xb // 256) + 1):
        for ty in range(int(ya // 256), int(yb // 256) + 1):
            data = rd.get(z, tx, ty)
            if data:
                g.put(picture(data), z, tx * 256, ty * 256)


def from_xyz(g, p):
    z = min(13, p["maxZoom"])
    s, w, n, e = p["cover"]
    (xa, ya), (xb, yb) = px(n, w, z), px(s, e, z)
    todo = [(tx, ty) for tx in range(int(xa // 256) - 1, int(xb // 256) + 2) for ty in range(int(ya // 256) - 1, int(yb // 256) + 2)]

    def one(t):
        data = fetch(p["url"].replace("{z}", str(z)).replace("{x}", str(t[0])).replace("{y}", str(t[1])), 40)
        return t, (picture(data, "black") if data else None)
    with ThreadPoolExecutor(6) as pool:
        for (tx, ty), m in pool.map(one, todo):
            if m is not None:
                g.put(m, z, tx * 256, ty * 256)


def exports(g, base, z, box, fill, extra=""):
    """A service's picture of a box, asked for in blocks of at most 2048 pixels on the zoom-z grid.
    `fill` is what the service paints where it has no picture: "white", "flat" (white or black) or None."""
    (xa, ya), (xb, yb) = px(box[2], box[1], z), px(box[0], box[3], z)
    xa, ya, xb, yb = int(xa) - 8, int(ya) - 8, int(xb) + 8, int(yb) + 8
    n = 256 * 2 ** z
    blocks = [(x, y, min(2048, xb - x), min(2048, yb - y)) for x in range(xa, xb, 2048) for y in range(ya, yb, 2048)]

    def one(b):
        x, y, w, h = b
        mx = lambda v: v / n * 2 * R - R
        my = lambda v: R - v / n * 2 * R
        url = f"{base}?bbox={mx(x)},{my(y + h)},{mx(x + w)},{my(y)}&bboxSR=3857&imageSR=3857&size={w},{h}&format=png32&transparent=true&f=image{extra}"
        data = fetch(url, 180)
        return b, (picture(data, fill) if data else None)
    with ThreadPoolExecutor(2) as pool:
        for (x, y, w, h), m in pool.map(one, blocks):
            if m is not None:
                g.put(m, z, x, y)


def bake(year, src, region, local):
    ps = src["providers"]
    boxes = [[(p["cover"][0], p["cover"][1]), (p["cover"][2], p["cover"][3])] for p in ps]
    if src["stream"] or src["boxes"]:
        boxes.append(region)
    g = Grid(14 if any(p.get("pm") for p in ps) else 12 if src["stream"] else 13, boxes)
    cuts = {}
    for i, p in enumerate(ps):
        if p.get("pm"):
            from_pm(g, p, local)
            continue
        # an outside service: its own picture on its own grid, kept as the line its layer is cut along
        own = Grid(13, [[(p["cover"][0], p["cover"][1]), (p["cover"][2], p["cover"][3])]])
        if p["kind"] == "xyz":
            from_xyz(own, p)
        elif p["kind"] == "image":   # a county ImageServer (Jefferson's): white inside its extent where it has no picture, black past it
            exports(own, p["service"] + "/exportImage", 13, p["cover"], "flat")
        else:
            exports(own, p["service"] + "/export", 13, p["cover"], "white", "" if p.get("layer") is None else f"&layers=show:{p['layer']}")
        cuts[str(i)] = own.rings(eps=1.0, shrink=1 if p["kind"] == "xyz" else 2)   # a map service's white bleeds a pixel into its picture
        g.put(own.m, own.z, own.x0, own.y0)
    if src["stream"]:
        lats, lons = [c[0] for c in region], [c[1] for c in region]
        exports(g, src["stream"] + "/exportImage", 11, [min(lats) - 0.05, min(lons) - 0.05, max(lats) + 0.05, max(lons) + 0.05], None)
    for b in src["boxes"]:
        pts = np.array([[round(x) - g.x0, round(y) - g.y0] for x, y in (px(lat, lon, g.z) for lat, lon in b)], np.int32)
        cv2.fillPoly(g.m, [pts], 1)
    return g, cuts


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--local"); ap.add_argument("--only"); ap.add_argument("--debug"); ap.add_argument("--cache")
    a = ap.parse_args()
    if a.cache:
        Path(a.cache).mkdir(parents=True, exist_ok=True)
        CACHE = a.cache
    d = json.loads(subprocess.run(["node", "-e", DUMP], cwd=ROOT, capture_output=True, text=True, check=True).stdout)
    out_path = ROOT / "data" / "outlines.json"
    out = json.loads(out_path.read_text()) if out_path.exists() and a.only else {"edge": {}, "cut": {}}
    for year, src in d["years"].items():
        if a.only and year not in a.only.split(","):
            continue
        g, cuts = bake(year, src, d["region"], a.local)
        out["edge"][year] = g.rings()
        if cuts:
            out["cut"][year] = cuts
        print(year, f"z{g.z}", g.m.shape, len(out["edge"][year]), "rings,", sum(len(r) for r in out["edge"][year]), "points; cuts", {k: sum(len(r) for r in v) for k, v in cuts.items()}, flush=True)
        if a.debug:
            Path(a.debug).mkdir(parents=True, exist_ok=True)
            f = max(1, max(g.m.shape) // 1400)
            cv2.imwrite(str(Path(a.debug) / f"{year}.png"), cv2.resize(g.m * 255, None, fx=1 / f, fy=1 / f, interpolation=cv2.INTER_AREA))
    out_path.write_text(json.dumps({"edge": {k: out["edge"][k] for k in sorted(out["edge"])}, "cut": {k: out["cut"][k] for k in sorted(out["cut"])}}, separators=(",", ":")))
    print(out_path.stat().st_size, "bytes")
