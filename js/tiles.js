/* Map tiles that are fetched, counted and kept.

   Every year that a server can render region-wide is an ordinary tile layer:
   DRCOG's mosaics (ImageServer exportImage), a county's map service (export,
   one layer per flight) and the Web Mercator caches on ArcGIS Online. A tile
   is fetched with fetch() rather than an <img src>, for three reasons:

     - the bytes are counted, so the page can show what a visit has cost;
     - a tile that scrolls away before it lands is aborted, not finished;
     - the answer goes into the browser's Cache Storage, so the same ground a
       second time costs nothing (the county service sends no-cache, and the
       mosaics only keep twelve hours).

   What keeps browsing cheap (measured 2026-11-12, 2024 mosaic downtown):
   a 512 px tile is ~75 KB at JPEG quality 75 and ~170 KB at 95; at twice the
   pixels it is 230-360 KB. So a tile first arrives at one image pixel per CSS
   pixel, quality 78. Only when the map has been still for a moment, zoomed in
   to where the detail is the point, are the tiles on screen asked again at the
   screen's own density (`sharpen`), never finer than the source's 3 in. A tile
   waits 120 ms before it is asked for at all, so zooming through five levels
   fetches the last one. */
(function () {
  const R = 20037508.342789244;
  const FT = 0.3048;
  const STORE = 'drapp-tiles-v1';
  const TIMEOUT = 20000;
  const MAX_KEPT = 6000;                 // tiles kept between visits; the oldest fifth goes when it is passed
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);

  /* ---------- the meter ---------- */
  const meter = { net: 0, kept: 0, requests: 0 };
  const watchers = new Set();
  let tick = 0;
  function count(bytes, fromStore) {
    if (fromStore) meter.kept += bytes; else { meter.net += bytes; meter.requests++; }
    if (!tick) tick = setTimeout(() => { tick = 0; watchers.forEach((f) => f(meter)); }, 150);
  }

  /* ---------- the store ---------- */
  let storeP = null;
  function store() {
    if (!storeP) {
      storeP = (typeof caches === 'undefined') ? Promise.resolve(null)
        : caches.open(STORE).catch(() => null);
    }
    return storeP;
  }
  async function prune() {
    const c = await store();
    if (!c) return;
    try {
      const keys = await c.keys();
      if (keys.length <= MAX_KEPT) return;
      for (const k of keys.slice(0, Math.ceil(MAX_KEPT / 5))) await c.delete(k);
    } catch (e) { /* no store, no pruning */ }
  }
  async function stats() {
    const c = await store();
    if (!c) return { tiles: 0 };
    try { return { tiles: (await c.keys()).length }; } catch (e) { return { tiles: 0 }; }
  }
  async function clear() {
    storeP = null;
    if (typeof caches !== 'undefined') { try { await caches.delete(STORE); } catch (e) { /* ignore */ } }
  }

  /* One image as a Blob: from the store if it is there, else the network. */
  async function blob(url, signal, keep = true) {
    const c = await store();
    if (c) {
      try {
        const hit = await c.match(url);
        if (hit) { const b = await hit.blob(); count(b.size, true); return b; }
      } catch (e) { /* fall through to the network */ }
    }
    /* A server that accepts the request and then says nothing would leave a
       tile "on its way" for ever; twenty seconds and it counts as failed. */
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, TIMEOUT);
    const stop = () => ctl.abort();
    if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', stop, { once: true }); }
    let b;
    try {
      const r = await fetch(url, { signal: ctl.signal, mode: 'cors', credentials: 'omit' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      b = await r.blob();
    } catch (e) {
      if (timedOut) throw new Error('timed out');
      throw e;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', stop);
    }
    count(b.size, false);
    if (c && keep && b.size) c.put(url, new Response(b, { headers: { 'Content-Type': b.type || 'image/jpeg' } })).catch(() => {});
    return b;
  }

  /* A county's extent is a rectangle; the county is not. Inside the box but
     outside the flight its service answers a flat white (or black) JPEG rather
     than an error, which would paint over whatever is beneath. Measured
     downtown: an out-of-county Arapahoe tile is a uniform 253, an in-county one
     runs 68-238. */
  const probe = document.createElement('canvas');
  probe.width = probe.height = 8;
  function isFlat(img) {
    try {
      const c = probe.getContext('2d', { willReadFrequently: true });
      c.clearRect(0, 0, 8, 8);
      c.drawImage(img, 0, 0, 8, 8);
      const d = c.getImageData(0, 0, 8, 8).data;
      for (let i = 0; i < d.length; i += 4) {
        const flat = (d[i] > 248 && d[i + 1] > 248 && d[i + 2] > 248) || (d[i] < 12 && d[i + 1] < 12 && d[i + 2] < 12);
        if (!flat) return false;
      }
      return true;
    } catch (e) { return false; }
  }

  /* Image pixels for a tile `sz` Mercator metres wide, middle at Mercator y
     `my`, drawn on `css` CSS pixels at `density` image pixels each: never
     finer on the ground than the source's `nativeFt`. */
  function tilePx(css, sz, my, nativeFt, density) {
    let px = Math.round(css * density);
    if (nativeFt) {
      const cos = Math.cos(2 * Math.atan(Math.exp(my / 6378137)) - Math.PI / 2);
      px = Math.min(px, Math.ceil(sz * cos / (nativeFt * FT)));
    }
    return Math.max(64, Math.min(2048, px));
  }
  const DENVER_COS = Math.cos(39.74 * Math.PI / 180);
  /* The tile zoom where one CSS pixel of a 512 px tile reaches `nativeFt`. */
  const nativeZoom = (nativeFt) => Math.ceil(Math.log2(2 * R * DENVER_COS / (256 * nativeFt * FT)) - 1e-9);

  const Layer = L.GridLayer.extend({
    options: {
      tileSize: 512, minZoom: 9, maxZoom: 22, keepBuffer: 1, updateWhenZooming: false,
      updateWhenIdle: L.Browser.mobile, updateInterval: 350,
      quality: 78, sharpQuality: 82, delay: 120,
      kind: 'image',        // 'image' ImageServer exportImage · 'map' MapServer export · 'xyz' cached z/y/x tiles
      service: '', layer: null, nativeFt: 0, detectFlat: false,
    },

    /* Mercator box of a tile. With 512 px tiles Leaflet's coords are one zoom
       deeper than the usual 256 px scheme. */
    box(coords) {
      const ts = this.getTileSize().x;
      const sz = 2 * R / (2 ** coords.z * 256 / ts);
      return { sz, xmin: -R + coords.x * sz, ymax: R - coords.y * sz };
    },

    url(coords, sharp) {
      const o = this.options;
      if (o.kind === 'xyz') {
        return o.service.replace('{z}', coords.z).replace('{x}', coords.x).replace('{y}', coords.y);
      }
      const ts = this.getTileSize().x;
      const b = this.box(coords);
      const px = tilePx(ts, b.sz, b.ymax - b.sz / 2, o.nativeFt, sharp ? dpr() : 1);
      const q = new URLSearchParams({
        bbox: [b.xmin, b.ymax - b.sz, b.xmin + b.sz, b.ymax].join(','),
        bboxSR: '3857', imageSR: '3857', size: `${px},${px}`, format: 'jpg', f: 'image',
      });
      /* jpgpng: a JPEG where the mosaic has a photo for the whole tile, a PNG
         with the empty part transparent at the edge of the flight, so the
         ground beneath shows instead of a black block. */
      if (o.kind === 'image') { q.set('format', 'jpgpng'); q.set('compressionQuality', String(sharp ? o.sharpQuality : o.quality)); }
      else if (o.layer != null) q.set('layers', 'show:' + o.layer);
      return `${o.service}/${o.kind === 'image' ? 'exportImage' : 'export'}?${q}`;
    },

    /* Would asking again at the screen's density bring more pixels? */
    canSharpen(coords) {
      const o = this.options;
      if (o.kind === 'xyz' || dpr() < 1.5) return false;
      const ts = this.getTileSize().x, b = this.box(coords);
      return tilePx(ts, b.sz, b.ymax - b.sz / 2, o.nativeFt, dpr()) > tilePx(ts, b.sz, b.ymax - b.sz / 2, o.nativeFt, 1) * 1.2;
    },

    createTile(coords, done) {
      const img = document.createElement('img');
      img.alt = '';
      img.setAttribute('role', 'presentation');
      img.decoding = 'async';
      const ctl = new AbortController();
      img._ctl = ctl; img._coords = coords;
      const run = async () => {
        try {
          const b = await blob(this.url(coords, false), ctl.signal);
          img.onload = () => {
            if (this.options.detectFlat && isFlat(img)) { img._flat = true; img.style.visibility = 'hidden'; }
            img._ok = true;
            done(null, img);
          };
          img.onerror = () => done(new Error('tile did not decode'), img);
          img._url = URL.createObjectURL(b);
          img.src = img._url;
        } catch (e) {
          if (e.name !== 'AbortError') { img._failed = true; done(e, img); }
        }
      };
      img._timer = setTimeout(run, this.options.delay);
      return img;
    },

    onAdd(map) {
      this.on('tileunload', this._drop, this);
      map.on('movestart zoomstart', this.stopSharpen, this);
      return L.GridLayer.prototype.onAdd.call(this, map);
    },
    onRemove(map) {
      this.stopSharpen();
      map.off('movestart zoomstart', this.stopSharpen, this);
      L.GridLayer.prototype.onRemove.call(this, map);
      this.off('tileunload', this._drop, this);
    },
    _drop(ev) {
      const img = ev.tile;
      clearTimeout(img._timer);
      if (img._ctl) img._ctl.abort();
      if (img._url) { URL.revokeObjectURL(img._url); img._url = null; }
      img.onload = img.onerror = null;
    },

    /* The tiles under the view right now. */
    inView() {
      if (!this._map) return [];
      const b = this._map.getPixelBounds(), ts = this.getTileSize();
      const z = this._tileZoom;
      if (z == null) return [];
      const scale = this._map.getZoomScale(this._map.getZoom(), z);
      return Object.values(this._tiles).filter((t) => {
        if (!t.current || t.coords.z !== z) return false;
        const x0 = t.coords.x * ts.x * scale, y0 = t.coords.y * ts.y * scale;
        return x0 < b.max.x && x0 + ts.x * scale > b.min.x && y0 < b.max.y && y0 + ts.y * scale > b.min.y;
      });
    },

    /* How the view is doing: tiles with a picture, tiles the service answered
       blank, tiles that failed, and tiles still on their way. */
    coverage() {
      const out = { good: 0, flat: 0, failed: 0, pending: 0 };
      for (const t of this.inView()) {
        if (t.el._flat) out.flat++; else if (t.el._ok) out.good++; else if (t.el._failed) out.failed++; else out.pending++;
      }
      return out;
    },

    /* Ask the tiles on screen again at the screen's density. Stops by itself
       the moment the map moves. Resolves the number of tiles replaced. */
    async sharpen() {
      this.stopSharpen();
      const ctl = this._sharpCtl = new AbortController();
      let n = 0;
      const todo = this.inView().filter((t) => t.el._ok && !t.el._flat && !t.el._sharp && this.canSharpen(t.coords));
      await Promise.all(todo.map(async (t) => {
        try {
          const b = await blob(this.url(t.coords, true), ctl.signal);
          if (ctl.signal.aborted || !t.el._url) return;
          const next = URL.createObjectURL(b), old = t.el._url;
          t.el.onload = () => { URL.revokeObjectURL(old); };
          t.el._url = next; t.el._sharp = true; t.el.src = next;
          n++;
        } catch (e) { /* aborted, or the server said no: the tile on screen stays */ }
      }));
      return n;
    },
    stopSharpen() {
      if (this._sharpCtl) { this._sharpCtl.abort(); this._sharpCtl = null; }
    },
  });

  DRAPP.tiles = { Layer, blob, meter, watch: (f) => watchers.add(f), stats, clear, prune, tilePx, nativeZoom, isFlat };
})();
