/* Page logic: one map, one year on show, a timeline along the bottom.

   What the page is for (Jimmy, 2026-11-12): "a clean way to view and show off
   the high res drapp stuff for denver residents. the timeline was a secondary
   feature, but really a big one … user should be able to browse around without
   downloading/killing bandwidth, find an area they want to explore through the
   years, and be able to save photos downloaded."

   Two kinds of year, and the page hides the difference as far as it can:
     - A year some server renders region-wide is a tile layer (js/tiles.js):
       DRCOG's 2018-2026 mosaics everywhere, every flight back to 1998 inside
       Arapahoe County, and the older scans where an agency has them online.
       Picking one of these is instant.
     - 2004-2016 everywhere else exist only as DRCOG's raw GeoTIFFs. Picking
       one reads the view on screen out of the archive (js/tiffwindow.js) and
       leaves it on the map as a patch. Picking the year is the okay for that
       one view; after a pan nothing more is read until "Load here" is tapped,
       and the button says what it will cost first.

   Under a year that does not cover the whole view, the last mosaic looked at
   is drawn dimmed, so there is always ground to steer by. */
(function () {
  const { proj, sources, tileindex, tiffwindow, geocode, cache, warp, providers, estimate, tiles } = DRAPP;
  const S = sources.SOURCES;
  const R = 20037508.342789244;
  const SRC_RES = proj.GRID;
  const AUTO_BYTES = 8e6;          // a picked year reads the view without asking up to this much
  const MAX_BYTES = 40e6;          // past this the view is too wide to read: zoom in
  const MAX_PX = 4096;             // a read, or a saved photo, is at most this many pixels a side
  const OV_MAX = 4096;
  const MIN_BLOCK = 200;           // a read smaller than this many screen pixels a side is not worth making
  const PATCHES_KEPT = 5;          // per year, in memory
  const SHARPEN_ZOOM = 19;         // full screen detail is asked for from here in, once the map rests
  const HOME = { lat: 39.753227, lon: -105.000094, z: 17 };     // Union Station
  const PLACES = [
    ['Union Station', 39.753227, -105.000094, 18],
    ['Coors Field', 39.756031, -104.992928, 18],
    ['State Capitol', 39.73925, -104.98485, 19],
    ['Empower Field at Mile High', 39.743952, -105.019222, 17],
    ['Elitch Gardens', 39.747321, -105.014085, 17],
    ['Washington Park', 39.702081, -104.971033, 16],
    ['Red Rocks Amphitheatre', 39.665391, -105.205717, 18],
    ['Denver International Airport', 39.8494, -104.6737, 15],
    ['Cherry Creek Dam', 39.651404, -104.854944, 15],
    ['Pearl Street, Boulder', 40.018565, -105.276728, 18],
  ];

  const $ = (sel, el = document) => el.querySelector(sel);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  const mb = estimate.mb;

  const prefs = {
    get sharp() { try { const v = localStorage.getItem('drapp.sharp'); if (v != null) return v === '1'; } catch (e) { /* private mode */ }
      return !(navigator.connection && navigator.connection.saveData); },
    set sharp(v) { try { localStorage.setItem('drapp.sharp', v ? '1' : '0'); } catch (e) { /* private mode */ } },
  };

  const state = {
    sides: [{ year: 2024, view: null }],   // one side normally; two while comparing (left, right)
    active: 0,                               // the side the timeline drives
    split: 0.5,
    contextYear: 2024,
    playing: 0,
    read: null,                              // the archive read in flight: {year, ctl, frac, note}
    wantRead: null,                          // a year just picked: its view may be read without asking
  };
  const recs = new Map();                    // year → {year, patches: [], date: {box, text}}
  const views = new Map();                   // `${side}:${year}` → view
  let map, contextLayer = null, baseLayer, regionLL;

  /* ---------- geometry ---------- */
  function regionBounds() {
    const r = proj.REGION;
    const c = [[r.xmin, r.ymin], [r.xmax, r.ymin], [r.xmin, r.ymax], [r.xmax, r.ymax]].map(([x, y]) => proj.toLonLat(x, y));
    return L.latLngBounds([Math.min(...c.map((p) => p.lat)), Math.min(...c.map((p) => p.lon))], [Math.max(...c.map((p) => p.lat)), Math.max(...c.map((p) => p.lon))]);
  }
  const coverBounds = (p) => L.latLngBounds([p.cover[0], p.cover[1]], [p.cover[2], p.cover[3]]);

  /* Ground feet per CSS pixel at the map centre. */
  function cssRes() {
    const lat = map.getCenter().lat;
    return (2 * R / 256 / 2 ** map.getZoom()) * Math.cos(lat * Math.PI / 180) / 0.3048;
  }
  /* The map view as a state-plane box (no pixel grid yet). */
  function viewBox() {
    const b = map.getBounds();
    const pts = [[b.getWest(), b.getSouth()], [b.getEast(), b.getSouth()], [b.getEast(), b.getNorth()], [b.getWest(), b.getNorth()]]
      .map(([lon, lat]) => proj.toStatePlane(lon, lat));
    const xmin = Math.min(...pts.map((p) => p.x)), xmax = Math.max(...pts.map((p) => p.x));
    const ymin = Math.min(...pts.map((p) => p.y)), ymax = Math.max(...pts.map((p) => p.y));
    return { xmin, ymin, xmax, ymax, w: xmax - xmin, h: ymax - ymin, cx: (xmin + xmax) / 2, cy: (ymin + ymax) / 2 };
  }
  /* Window `w` is under view `v`: the middle of the view is inside it. */
  function over(w, v) {
    return v.cx >= w.xmin && v.cx <= w.xmax && v.cy >= w.ymin && v.cy <= w.ymax;
  }
  /* How much of view `v` window `w` covers, 0 to 1. */
  function share(w, v) {
    const ix = Math.max(0, Math.min(w.xmax, v.xmax) - Math.max(w.xmin, v.xmin));
    const iy = Math.max(0, Math.min(w.ymax, v.ymax) - Math.max(w.ymin, v.ymin));
    return ix * iy / (v.w * v.h);
  }
  const resLabel = (res) => res < 0.96 ? `${Math.round(res * 12)} in` : res >= 10 ? `${Math.round(res)} ft` : `${+res.toFixed(1)} ft`;

  /* ---------- Arapahoe County, yes or no ----------
     The county's service has every flight back to 1998, but its extent is a
     rectangle that takes in half of Denver, where it answers blank. One 16 px
     export of its newest layer says which side of the line a spot is on;
     remembered per ~half-mile cell. */
  const ARAPAHOE = 'Arapahoe County';
  const gate = new Map();
  const gateKey = (lat, lon) => `${lat.toFixed(2)},${lon.toFixed(2)}`;
  function inArapahoe(lat, lon) {
    const p = S[2008].providers[0];
    if (!providers.covers(p, lat, lon)) return false;
    const k = gateKey(lat, lon);
    if (gate.has(k)) return gate.get(k);
    gate.set(k, undefined);
    const c = proj.toStatePlane(lon, lat);
    const q = new URLSearchParams({ bbox: [c.x - 100, c.y - 100, c.x + 100, c.y + 100].join(','), bboxSR: '2232', imageSR: '2232', size: '16,16', format: 'jpg', layers: 'show:1', f: 'image' });
    tiles.blob(`${p.service}/export?${q}`).then(async (b) => {
      const im = await createImageBitmap(b);
      gate.set(k, !tiles.isFlat(im));
    }).catch(() => {
      /* No answer: treat as outside for now and ask again in half a minute, not in a loop. */
      gate.set(k, false);
      setTimeout(() => gate.delete(k), 30000);
    }).then(() => { paintTimeline(); assessSoon(); });
    return undefined;
  }
  const providerHere = (p, lat, lon) => providers.covers(p, lat, lon) && (p.credit !== ARAPAHOE || inArapahoe(lat, lon) === true);

  /* How a year can be shown at a spot: 'tiles' (instant), 'read' (out of the
     archive, for the view), or null. */
  function how(year, lat, lon) {
    const src = S[year];
    if (src.stream) return regionLL.contains([lat, lon]) ? 'tiles' : null;
    if ((src.providers || []).some((p) => providerHere(p, lat, lon))) return 'tiles';
    if (src.archive === 'tif' && proj.inRegion(proj.toStatePlane(lon, lat))) return 'read';
    return null;
  }
  const yearsHere = () => { const c = map.getCenter(); return sources.YEARS.filter((y) => how(y, c.lat, c.lng)); };

  /* ---------- a year on one side of the map ---------- */
  function rec(year) {
    if (!recs.has(year)) recs.set(year, { year, patches: [] });
    return recs.get(year);
  }
  function layerSpecs(year) {
    const src = S[year], out = [];
    if (src.stream) {
      out.push({ kind: 'image', service: src.stream, nativeFt: SRC_RES, maxNativeZoom: tiles.nativeZoom(SRC_RES), bounds: regionLL, wide: true });
    }
    for (const p of src.providers || []) {
      if (p.kind === 'map') {
        out.push({ kind: 'map', service: p.service, layer: p.layer, nativeFt: p.res / 12, maxNativeZoom: tiles.nativeZoom(p.res / 12), bounds: coverBounds(p), detectFlat: true, provider: p });
      } else {
        out.push({ kind: 'xyz', service: p.url, tileSize: 256, minZoom: 9, maxNativeZoom: p.maxZoom, bounds: coverBounds(p), provider: p });
      }
    }
    return out;
  }
  function viewOf(side, year) {
    const key = `${side}:${year}`;
    if (views.has(key)) return views.get(key);
    const pane = map.createPane(`y${side}-${year}`);
    pane.classList.add('year-pane');
    pane.style.opacity = 0;
    const v = { side, year, pane, paneName: `y${side}-${year}`, layers: null, overlays: new Map(), on: false };
    views.set(key, v);
    return v;
  }
  function mount(v) {
    if (v.on) return;
    v.on = true;
    if (!v.layers) {
      v.layers = layerSpecs(v.year).map((o) => {
        const l = new tiles.Layer(Object.assign({ pane: v.paneName }, o));
        l.on('load tileerror', assessSoon);
        return l;
      });
    }
    for (const l of v.layers) l.addTo(map);
    for (const p of rec(v.year).patches) addOverlay(v, p);
  }
  function unmount(v) {
    if (!v.on) return;
    v.on = false;
    for (const l of v.layers || []) map.removeLayer(l);
    for (const o of v.overlays.values()) map.removeLayer(o.layer);
    v.overlays.clear();
    v.pane.style.opacity = 0;
  }
  function addOverlay(v, patch) {
    if (v.overlays.has(patch)) return;
    const canvas = document.createElement('canvas');
    const o = { canvas, w: 0, layer: null };
    o.layer = new warp.CanvasOverlay(canvas, warp.bounds(patch.rect), { pane: v.paneName, interactive: false });
    v.overlays.set(patch, o);
    redraw(v, patch);
    o.layer.addTo(map);
  }
  /* Draw a patch's overlay from its state-plane master at the density the
     screen needs now, in steps of 256 px. */
  function redraw(v, patch, force) {
    const o = v.overlays.get(patch);
    if (!o) return;
    const b = L.latLngBounds(warp.bounds(patch.rect));
    const sw = map.latLngToContainerPoint(b.getSouthWest()), ne = map.latLngToContainerPoint(b.getNorthEast());
    const W = Math.min(OV_MAX, patch.win.px * 2, Math.max(256, Math.ceil(Math.abs(ne.x - sw.x) * dpr() / 256) * 256));
    if (W === o.w && !force) return;
    warp.toMercator(patch.canvas, patch.win, patch.rect, W, o.canvas);
    o.w = W;
  }
  function redrawAll(force) {
    for (const v of views.values()) if (v.on) for (const p of v.overlays.keys()) redraw(v, p, force);
  }

  /* Put each side's year on the map: the new one fades in on top, and what
     was there before comes off once the fade is over. */
  let sweepSeq = 0;
  function showSides() {
    const wanted = new Set();
    state.sides.forEach((s, i) => {
      const v = viewOf(i, s.year);
      wanted.add(v);
      mount(v);
      v.pane.style.zIndex = 400 + i * 10 + 1;
      requestAnimationFrame(() => { v.pane.style.opacity = 1; });
      s.view = v;
    });
    for (const v of views.values()) if (v.on && !wanted.has(v)) v.pane.style.zIndex = 400 + v.side * 10;
    /* The old year stays underneath until the new one's tiles have landed
       (or six seconds), so a change of year never flashes to black. */
    const seq = ++sweepSeq;
    const landed = [...wanted].flatMap((v) => v.layers.filter((l) => l.isLoading && l.isLoading()).map((l) => new Promise((res) => l.once('load', res))));
    Promise.all([new Promise((res) => setTimeout(res, 650)), Promise.race([Promise.all(landed), new Promise((res) => setTimeout(res, 6000))])]).then(() => {
      if (seq !== sweepSeq) return;
      const now = new Set(state.sides.map((x) => x.view));
      for (const v of views.values()) if (v.on && !now.has(v) && v.side < 9) unmount(v);
    });
    clipSides();
    paintAll();
    assessSoon();
    writeHash();
  }

  /* ---------- how the view is doing ----------
     For each side: is its year covering the view from tiles, from a loaded
     patch, partly, or not at all? That decides the dimmed ground underneath,
     the "Load here" button and the line of text. */
  let assessTimer = 0;
  function assessSoon() { clearTimeout(assessTimer); assessTimer = setTimeout(assess, 120); }
  function patchUnder(year, vb) {
    const ps = rec(year).patches.filter((p) => over(p.win, vb));
    return ps.length ? ps.reduce((a, b) => (b.win.res < a.win.res ? b : a)) : null;
  }
  function sideStatus(i) {
    const s = state.sides[i], v = s.view, src = S[s.year];
    if (!v || !v.on) return { mode: 'pending' };
    const vb = viewBox(), bounds = map.getBounds();
    const cov = { good: 0, flat: 0, failed: 0, pending: 0 };
    let wide = false, whole = false, used = null;
    for (const l of v.layers) {
      if (!l.options.bounds.intersects(bounds)) continue;
      if (l.options.wide) wide = true;
      if (l.options.bounds.contains(bounds)) whole = true;
      const c = l.coverage();
      for (const k in cov) cov[k] += c[k];
      if (c.good && !used) used = l;
    }
    const patch = patchUnder(s.year, vb);
    const reading = state.read && state.read.year === s.year;
    const c = map.getCenter();
    const canRead = src.archive === 'tif' && proj.inRegion({ x: vb.cx, y: vb.cy });
    /* Tiles still on their way hold the verdict back, except where the only
       tile source is Arapahoe County's and this spot is known to be outside
       it: those tiles will come back blank, so the read need not wait. */
    const outside = canRead && v.layers.every((l) => l.options.provider && l.options.provider.credit === ARAPAHOE) && inArapahoe(c.lat, c.lng) === false;
    let mode;
    if (wide) mode = 'tiles';
    else if (cov.pending && !outside && !patch) mode = 'checking';
    else if (cov.good && !cov.flat && !cov.failed && whole) mode = 'tiles';
    else if (patch) mode = 'patch';
    else if (cov.good > cov.flat + cov.failed) mode = 'partial';
    else mode = 'missing';
    return { mode, cov, patch, used, reading, canRead, lat: c.lat, lon: c.lng, vb };
  }

  let lastAssess = [];
  function assess() {
    if (!map) return;
    const st = state.sides.map((_, i) => sideStatus(i));
    lastAssess = st;
    /* Ground to steer by under a year that does not fill the view. */
    const needGround = st.some((x) => x.mode !== 'tiles' && x.mode !== 'pending');
    setContext(needGround);
    paintStatus();
    paintPrompt();
    paintTimeline();
  }

  function setContext(on) {
    const want = on ? state.contextYear : null;
    if (contextLayer && contextLayer.year !== want) { map.removeLayer(contextLayer.layer); contextLayer = null; }
    if (want != null && !contextLayer) {
      const spec = layerSpecs(want)[0];
      contextLayer = { year: want, layer: new tiles.Layer(Object.assign({ pane: 'context' }, spec)).addTo(map) };
    }
  }

  /* ---------- reading a year out of the archive ---------- */
  const indexMemo = new Map();
  function indexTiles(year, box, signal) {
    const key = `${year}|${Math.floor(box.xmin / 200)}|${Math.floor(box.ymin / 200)}|${Math.ceil(box.xmax / 200)}|${Math.ceil(box.ymax / 200)}`;
    if (!indexMemo.has(key)) {
      if (indexMemo.size > 200) indexMemo.clear();
      const p = tileindex.tilesFor(year, box, signal);
      p.catch(() => indexMemo.delete(key));
      indexMemo.set(key, p);
    }
    return indexMemo.get(key);
  }

  /* The window a year would be read on, and what it costs. The archive files
     are uncompressed, one image row to a request, so the cost is the ground
     covered times the detail: a neighbourhood at screen detail is tens of
     megabytes. So the read is at the screen's own density (never finer than
     the file), and it is as much of the middle of the view as `budget` buys:
     the whole view when zoomed in close, a block in the middle further out.
     `tooSmall` says the block would be too small to be worth it. */
  function readPlan(year, idx, lat, lon, budget = AUTO_BYTES) {
    const vb = viewBox(), src = S[year];
    const floor = src.layout ? src.layout.res : SRC_RES;
    const css = cssRes();
    const at = (density) => {
      let res = Math.max(floor, css / density);
      if (res < 1.5 * floor) res = floor;
      res = proj.snapRes(res);
      let w = vb.w, h = vb.h, win, est;
      for (let n = 0; n < 6; n++) {
        const k = Math.min(1, MAX_PX * res / w, MAX_PX * res / h);
        w *= k; h *= k;
        win = proj.windowBox(vb.cx - w / 2, vb.cy - h / 2, vb.cx + w / 2, vb.cy + h / 2, res);
        est = estimate.forYear(year, win, idx, lat, lon);
        if (!est || est.bytes == null) return { win, est, part: true, tooSmall: true };
        if (est.bytes <= budget) break;
        const f = Math.sqrt(budget / est.bytes) * 0.96;
        w *= f; h *= f;
      }
      return { win, est, part: (w * h) / (vb.w * vb.h) < 0.85, tooSmall: Math.min(w, h) / css < MIN_BLOCK || est.bytes > budget * 1.2 };
    };
    /* The screen's own density if that covers the view; otherwise one image
       pixel per CSS pixel, which buys twice the ground for the same bytes. */
    const fine = at(dpr());
    return fine.part && dpr() > 1 ? at(1) : fine;
  }

  async function read(year, plan, idx) {
    cancelRead();
    const ctl = new AbortController();
    const job = state.read = { year, ctl, frac: 0, note: 'looking up the photo' };
    const r = rec(year), win = plan.win;
    const canvas = document.createElement('canvas');
    canvas.width = win.px; canvas.height = win.py;
    const patch = { win, rect: warp.mercRect(win), canvas, meta: '', partial: true };
    const first = idx.map((t) => tileindex.prettyDate(t.photoDate)).filter(Boolean)[0];
    patch.meta = first ? 'photographed ' + first : '';
    paintStatus(); paintPrompt();
    try {
      const hit = await cache.get(year, win);
      if (hit && hit.blob) {
        await cache.draw(hit, canvas);
        patch.kept = true;
      } else {
        r.patches.push(patch);
        for (const v of views.values()) if (v.on && v.year === year) addOverlay(v, patch);
        let last = 0;
        const t0 = performance.now();
        const out = await tiffwindow.render(idx, win, canvas, ctl.signal, (f, note) => {
          job.frac = f; job.note = note;
          paintPrompt();
          const now = performance.now();
          if (now - last > 600) { last = now; requestAnimationFrame(() => { for (const v of views.values()) if (v.on && v.year === year) redraw(v, patch, true); }); }
        });
        tiles.meter.net += out.bytes; tiles.meter.requests += out.requests;
        estimate.learn(out.requests, out.bytes, (performance.now() - t0) / 1000);
        cache.put(year, win, canvas, { meta: patch.meta });
        r.patches.splice(r.patches.indexOf(patch), 1);
      }
      patch.partial = false;
      r.patches.push(patch);
      while (r.patches.length > PATCHES_KEPT) {
        const old = r.patches.shift();
        for (const v of views.values()) { const o = v.overlays.get(old); if (o) { map.removeLayer(o.layer); v.overlays.delete(old); } }
      }
      for (const v of views.values()) if (v.on && v.year === year) { addOverlay(v, patch); redraw(v, patch, true); }
    } catch (e) {
      const i = r.patches.indexOf(patch);
      if (i >= 0) r.patches.splice(i, 1);
      for (const v of views.values()) { const o = v.overlays.get(patch); if (o) { map.removeLayer(o.layer); v.overlays.delete(patch); } }
      if (e.name !== 'AbortError') job.error = e.message;
    }
    if (state.read === job) state.read = job.error ? { year, error: job.error } : null;
    paintMeter();
    assess();
  }
  function cancelRead() {
    if (state.read && state.read.ctl) state.read.ctl.abort();
    state.read = null;
  }

  /* The button over the timeline: offer to read the active side's year for
     this view, show the read in progress, or say why there is nothing. */
  const prompt = $('#prompt');
  let promptSeq = 0;
  async function paintPrompt() {
    const seq = ++promptSeq;
    const i = state.active, s = state.sides[i], st = lastAssess[i];
    const label = sources.label(s.year);
    const set = (html, cls) => { if (seq !== promptSeq) return; prompt.className = 'prompt ' + (cls || ''); prompt.innerHTML = html; prompt.hidden = !html; };
    if (state.read && state.read.ctl) {
      const j = state.read;
      return set(`<span class="spin"></span><span>Reading ${sources.label(j.year)} from DRCOG's archive… ${Math.round(j.frac * 100)}%</span><i class="bar"><i style="width:${Math.round(j.frac * 100)}%"></i></i><button type="button" data-act="cancel" aria-label="Stop">✕</button>`, 'busy');
    }
    if (!st || st.mode === 'tiles' || st.mode === 'pending' || st.mode === 'checking') return set('');
    if (state.read && state.read.error && state.read.year === s.year) {
      return set(`<span>${label} did not load: ${state.read.error}</span><button type="button" data-act="read">Try again</button>`, 'warn');
    }
    const have = st.mode === 'patch' ? st.patch : null;
    if (!st.canRead) {
      if (st.mode === 'partial' || have) return set('');
      const areas = [...new Set((S[s.year].providers || []).map((p) => p.area))];
      const why = S[s.year].archive === 'jp2' || S[s.year].archive === 'sid'
        ? `${label} is online only for Arapahoe County. DRCOG's own ${label} files are ${S[s.year].archive === 'jp2' ? 'JPEG 2000' : 'MrSID'}, which a browser cannot open.`
        : areas.length ? `${label} covers only ${areas.join(' and ')}.` : `Nothing for ${label} here.`;
      return set(`<span>${why}</span>`, 'note');
    }
    let idx;
    const slow = setTimeout(() => set(`<span class="spin"></span><span>Looking for ${label} here…</span>`, 'busy'), 500);
    try { idx = await indexTiles(s.year, st.vb); } catch (e) {
      clearTimeout(slow);
      return set(`<span>DRCOG's index for ${label} is not answering, so ${label} cannot be found right now.</span><button type="button" data-act="retry">Retry</button>`, 'warn');
    }
    clearTimeout(slow);
    if (seq !== promptSeq) return;
    if (!idx.some((t) => t.kind === 'tif' && t.image)) return set(`<span>DRCOG has no ${label} photo of this spot.</span>`, 'note');
    const auto = state.wantRead === s.year;
    state.wantRead = null;
    if (have) {
      /* Something is loaded under the middle of the view. Two quiet offers:
         the same view in more detail, when zooming in has made that
         affordable, or the remainder of the view around a block. */
      const again = readPlan(s.year, idx, st.lat, st.lon);
      if (!again.tooSmall && !again.part && again.win.res <= have.win.res / 1.5) {
        pending = { year: s.year, plan: again, idx };
        return set(`<button type="button" class="go" data-act="read">Sharpen ${label} here<small>≈${mb(again.est.bytes)} · ${resLabel(again.win.res)} a pixel</small></button>`, 'more');
      }
      if (share(have.win, st.vb) >= 0.7) return set('');
      const whole = readPlan(s.year, idx, st.lat, st.lon, MAX_BYTES);
      if (whole.tooSmall || whole.part || whole.win.res > have.win.res * 1.01) return set('');
      pending = { year: s.year, plan: whole, idx };
      return set(`<button type="button" class="go" data-act="read">Load the whole view<small>≈${mb(whole.est.bytes)}</small></button>`, 'more');
    }
    const plan = readPlan(s.year, idx, st.lat, st.lon);
    if (plan.tooSmall) {
      /* From this far out a read would be a postage stamp. A year just picked
         goes in a level at a time until it fits; after a pan, the button does. */
      if (auto && map.getZoom() < 20) { state.wantRead = s.year; zoomedFor = s.year; map.setZoom(map.getZoom() + 1); return set(`<span class="spin"></span><span>Moving in to where ${label} can load…</span>`, 'busy'); }
      return set(`<button type="button" class="go" data-act="closer">Zoom in to load ${label}<small>too much raw archive from this far out</small></button>`, 'more');
    }
    if (auto) return read(s.year, plan, idx);
    pending = { year: s.year, plan, idx };
    set(`<button type="button" class="go" data-act="read">Load ${label} here<small>≈${mb(plan.est.bytes)}${plan.part ? ' · the middle of the view' : ''}</small></button>`, 'offer');
  }
  let pending = null, zoomedFor = null;
  prompt.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'cancel') { cancelRead(); assess(); }
    else if (b.dataset.act === 'closer') { state.wantRead = state.sides[state.active].year; map.setZoom(map.getZoom() + 1); }
    else if (b.dataset.act === 'read' && pending && pending.year === state.sides[state.active].year) read(pending.year, pending.plan, pending.idx);
    else { state.read = null; state.wantRead = state.sides[state.active].year; assess(); }
  });

  /* ---------- the timeline ---------- */
  const chips = $('#chips');
  let chipSig = '';
  function paintTimeline() {
    const years = yearsHere();
    const sel = state.sides.map((s) => s.year);
    for (const y of sel) if (!years.includes(y)) years.push(y);
    years.sort((a, b) => a - b);
    const c = map.getCenter(), vb = viewBox();
    const kinds = years.map((y) => {
      const h = how(y, c.lat, c.lng);
      if (!h) return 'off';
      if (h === 'read') return patchUnder(y, vb) ? 'got' : 'need';
      return 'now';
    });
    const sig = years.join() + '|' + kinds.join() + '|' + sel.join() + '|' + state.active + '|' + (state.read && state.read.ctl ? state.read.year : '');
    if (sig === chipSig) return;
    chipSig = sig;
    chips.innerHTML = '';
    let prev = null;
    years.forEach((y, n) => {
      if (prev != null && y - prev > 4) chips.appendChild(el('i', 'gap'));
      prev = y;
      const b = el('button', 'chip ' + kinds[n], sources.label(y));
      b.type = 'button'; b.dataset.year = y;
      const side = sel.indexOf(y);
      if (y === sel[state.active]) { b.classList.add('on'); b.setAttribute('aria-current', 'true'); }
      else if (side >= 0) b.classList.add('other');
      if (state.read && state.read.ctl && state.read.year === y) b.classList.add('busy');
      b.title = kinds[n] === 'need' ? `${sources.label(y)}: read from DRCOG's archive for the view on screen`
        : kinds[n] === 'off' ? `${sources.label(y)} has nothing here` : sources.label(y);
      chips.appendChild(b);
    });
    const on = $('.chip.on', chips);
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  chips.addEventListener('click', (ev) => {
    const b = ev.target.closest('.chip');
    if (b) { stopPlay(); pick(+b.dataset.year); }
  });

  function pick(year, quiet) {
    const s = state.sides[state.active];
    if (S[year].stream) state.contextYear = year;
    if (state.read && state.read.ctl && state.read.year !== year) cancelRead();
    if (state.read && !state.read.ctl) state.read = null;
    s.year = year;
    state.wantRead = quiet ? null : year;
    showSides();
  }
  function step(dir) {
    const years = yearsHere(), cur = state.sides[state.active].year;
    const next = dir > 0 ? years.find((y) => y > cur) : [...years].reverse().find((y) => y < cur);
    if (next != null) pick(next);
  }

  /* Play: walk the years that can be shown here without asking for anything,
     oldest to newest, round and round. */
  function playable() {
    const c = map.getCenter(), vb = viewBox();
    return yearsHere().filter((y) => how(y, c.lat, c.lng) === 'tiles' || patchUnder(y, vb));
  }
  function stopPlay() { clearInterval(state.playing); state.playing = 0; $('#play').classList.remove('on'); $('#play').setAttribute('aria-pressed', 'false'); }
  function togglePlay() {
    if (state.playing) return stopPlay();
    const tickYear = () => {
      const ys = playable(), cur = state.sides[state.active].year;
      if (ys.length < 2) return stopPlay();
      pick(ys.find((y) => y > cur) ?? ys[0], true);
    };
    $('#play').classList.add('on'); $('#play').setAttribute('aria-pressed', 'true');
    tickYear();
    state.playing = setInterval(tickYear, 1800);
  }

  /* ---------- the words ---------- */
  function sourceLine(i) {
    const s = state.sides[i], st = lastAssess[i] || {}, src = S[s.year];
    if (st.reading && st.mode !== 'tiles') return 'reading from DRCOG\'s archive…';
    if (st.mode === 'patch') return ['DRCOG archive', resLabel(st.patch.win.res) + ' a pixel', st.patch.meta].filter(Boolean).join(' · ');
    if (src.stream) {
      const sharp = prefs.sharp && dpr() >= 1.5 && map.getZoom() >= SHARPEN_ZOOM;
      const res = Math.max(SRC_RES, cssRes() / (sharp ? dpr() : 1));
      const px = res <= SRC_RES * 1.05 ? '3 in a pixel, all there is' : `${resLabel(res)} a pixel · zoom in for 3 in`;
      return ['DRCOG' + (src.interim ? ' interim mosaic' : ''), px].join(' · ');
    }
    const p = st.used && st.used.options.provider;
    if (p && (st.mode === 'tiles' || st.mode === 'partial')) return [p.credit, p.src].filter(Boolean).join(' · ');
    if (st.mode === 'checking' || st.mode === 'pending') return 'loading…';
    return st.canRead ? `not loaded here · ${state.contextYear} underneath, dimmed` : `not here · ${state.contextYear} underneath, dimmed`;
  }
  function paintStatus() {
    const i = state.active;
    $('#year-now').textContent = sources.label(state.sides[i].year);
    $('#src').textContent = sourceLine(i);
    document.title = `Denver Aerials — ${sources.label(state.sides[i].year)}`;
    state.sides.forEach((s, n) => {
      const tag = $(`#tag-${n}`);
      if (tag) { tag.querySelector('b').textContent = sources.label(s.year); tag.classList.toggle('on', n === state.active); }
    });
  }
  function paintMeter() {
    const m = tiles.meter;
    $('#meter').textContent = '↓ ' + mb(m.net);
    $('#meter').title = `${mb(m.net)} downloaded this visit in ${m.requests.toLocaleString()} requests` + (m.kept ? `; ${mb(m.kept)} more came from what this browser already had` : '');
  }
  function paintAll() { paintStatus(); paintTimeline(); paintMeter(); }
  let toastTimer = 0;
  function toast(text, ms = 4000) {
    const t = $('#toast');
    t.textContent = text; t.hidden = !text;
    clearTimeout(toastTimer);
    if (text && ms) toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  /* ---------- compare: two years, one divider ---------- */
  const divider = $('#divider');
  function clipSides() {
    const comparing = state.sides.length === 2;
    divider.hidden = !comparing;
    $('#tags').hidden = !comparing;
    document.body.classList.toggle('comparing', comparing);
    const size = map.getSize();
    const x = Math.round(size.x * state.split);
    divider.style.left = x + 'px';
    const nw = map.containerPointToLayerPoint([0, 0]), se = map.containerPointToLayerPoint(size);
    const cut = nw.x + x;
    for (const v of views.values()) {
      if (!comparing) { v.pane.style.clipPath = ''; continue; }
      const [l, r] = v.side === 0 ? [nw.x, cut] : [cut, se.x];
      v.pane.style.clipPath = `polygon(${l}px ${nw.y}px, ${r}px ${nw.y}px, ${r}px ${se.y}px, ${l}px ${se.y}px)`;
    }
  }
  function toggleCompare() {
    stopPlay();
    if (state.sides.length === 2) {
      const keep = state.sides[state.active].year;
      for (const v of views.values()) if (v.side === 1) unmount(v);
      state.sides = [{ year: keep, view: null }];
      state.active = 0;
    } else {
      /* Left is the older picture: the nearest earlier year that is here, the
         right keeps what was on show. */
      const cur = state.sides[0].year, years = yearsHere();
      const older = [...years].reverse().find((y) => y < cur) ?? years.find((y) => y !== cur) ?? cur;
      state.sides = [{ year: older, view: null }, { year: cur, view: null }];
      state.active = 0;
      state.wantRead = older;
      state.split = 0.5;
    }
    $('#compare').classList.toggle('on', state.sides.length === 2);
    $('#compare').setAttribute('aria-pressed', String(state.sides.length === 2));
    chipSig = '';
    showSides();
  }
  function dragDivider(ev) {
    ev.preventDefault();
    const rect = map.getContainer().getBoundingClientRect();
    const move = (e) => {
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      state.split = Math.max(0.04, Math.min(0.96, x / rect.width));
      clipSides();
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /* ---------- saving photos ---------- */
  const stem = (year) => { const c = map.getCenter(); return `denver-${sources.label(year)}-${c.lat.toFixed(5)}_${c.lng.toFixed(5)}`; };

  /* The view on screen for one year, as a JPEG. A mosaic year is asked for
     once, straight from DRCOG's server at the screen's density and quality 95
     (never finer than 3 in); anything else is what is on the map, redrawn on
     a canvas. Resolves null when the year has nothing here. */
  async function photo(year) {
    const src = S[year], b = map.getBounds(), size = map.getSize();
    if (src.stream && regionLL.contains(b.getCenter())) {
      const sw = map.options.crs.project(b.getSouthWest()), ne = map.options.crs.project(b.getNorthEast());
      const cos = Math.cos(b.getCenter().lat * Math.PI / 180);
      const nativePx = (ne.x - sw.x) * cos / (SRC_RES * 0.3048);
      const k = Math.min(dpr() >= 1.5 ? 2 : 1.5, nativePx / size.x, MAX_PX / Math.max(size.x, size.y));
      const w = Math.round(size.x * k), h = Math.round(size.y * k);
      const q = new URLSearchParams({ bbox: [sw.x, sw.y, ne.x, ne.y].join(','), bboxSR: '3857', imageSR: '3857', size: `${w},${h}`, format: 'jpg', compressionQuality: '95', f: 'image' });
      return tiles.blob(`${src.stream}/exportImage?${q}`, undefined, false);
    }
    /* What is drawn: this year's tiles and patches, wherever a view of it is mounted. */
    let v = [...views.values()].find((x) => x.on && x.year === year);
    let temp = null;
    if (!v) {
      const c = map.getCenter();
      if (how(year, c.lat, c.lng) !== 'tiles' && !patchUnder(year, viewBox())) return null;
      temp = v = viewOf(9, year);
      mount(v);
      await Promise.all(v.layers.filter((l) => l.options.bounds.intersects(b)).map((l) => new Promise((res) => { l.once('load', res); setTimeout(res, 15000); })));
    }
    const k = dpr();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(size.x * k); canvas.height = Math.round(size.y * k);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(k, k);
    let drew = 0;
    for (const l of v.layers) {
      const ts = l.getTileSize();
      for (const t of l.inView()) {
        if (!t.el._ok || t.el._flat) continue;
        const scale = map.getZoomScale(map.getZoom(), t.coords.z);
        const p = map.latLngToContainerPoint(map.unproject([t.coords.x * ts.x, t.coords.y * ts.y], t.coords.z));
        ctx.drawImage(t.el, p.x, p.y, ts.x * scale + 0.5, ts.y * scale + 0.5);
        drew++;
      }
    }
    for (const p of rec(year).patches) {
      const bb = L.latLngBounds(warp.bounds(p.rect));
      if (!bb.intersects(b)) continue;
      const nw = map.latLngToContainerPoint(bb.getNorthWest()), se = map.latLngToContainerPoint(bb.getSouthEast());
      const W = Math.min(OV_MAX, Math.max(256, Math.ceil((se.x - nw.x) * k)));
      ctx.drawImage(warp.toMercator(p.canvas, p.win, p.rect, W), nw.x, nw.y, se.x - nw.x, se.y - nw.y);
      drew++;
    }
    if (temp) unmount(temp);
    if (!drew) return null;
    return new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.93));
  }

  function deliver(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }
  /* On a phone the share sheet is how a picture reaches the photo library. */
  async function hand(blob, name) {
    const file = typeof File !== 'undefined' ? new File([blob], name, { type: blob.type || 'image/jpeg' }) : null;
    if (file && L.Browser.mobile && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    deliver(blob, name);
  }
  const CREDITS = [
    'Denver Aerials — https://drapp.myjimmycloud.com',
    '',
    'Aerial photographs 2002-2026: Denver Regional Aerial Photography Project,',
    'Denver Regional Council of Governments (DRCOG), https://data.drcog.org,',
    'licensed CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/).',
    'Other years come from Arapahoe County, Boulder County, South Metro Fire',
    'Rescue, the Colorado Department of Transportation and the Denver Public',
    'Library; the file name says which year each picture is.',
    '',
  ];
  async function saveOne() {
    const year = state.sides[state.active].year;
    toast(`Saving ${sources.label(year)}…`, 0);
    try {
      const b = await photo(year);
      if (!b) return toast(`${sources.label(year)} has nothing loaded here to save.`);
      await hand(b, stem(year) + '.jpg');
      toast(`Saved ${sources.label(year)} · ${mb(b.size)}`);
    } catch (e) { toast(`${sources.label(year)} did not save: ${e.message}`); }
    paintMeter();
  }
  async function saveAll() {
    const c = map.getCenter(), vb = viewBox();
    const years = yearsHere().filter((y) => how(y, c.lat, c.lng) === 'tiles' || patchUnder(y, vb));
    const skipped = yearsHere().filter((y) => !years.includes(y)).map((y) => sources.label(y));
    const files = [];
    for (const y of years) {
      toast(`Saving ${sources.label(y)} (${files.length + 1} of ${years.length})…`, 0);
      try {
        const b = await photo(y);
        if (b) files.push({ name: stem(y) + '.jpg', data: new Uint8Array(await b.arrayBuffer()) });
      } catch (e) { /* that year is left out */ }
      paintMeter();
    }
    if (!files.length) return toast('Nothing here to save.');
    const here = `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
    files.push({ name: 'CREDITS.txt', data: new TextEncoder().encode(CREDITS.concat([`Centre of these pictures: ${here}`, `Saved ${new Date().toISOString().slice(0, 10)}`]).join('\r\n')) });
    const zip = DRAPP.zip(files);
    deliver(zip, `denver-aerials-${c.lat.toFixed(5)}_${c.lng.toFixed(5)}.zip`);
    toast(`Saved ${files.length - 1} years · ${mb(zip.size)}` + (skipped.length ? ` · not loaded here: ${skipped.join(', ')}` : ''), 7000);
  }

  /* ---------- where ---------- */
  let hashTimer = 0;
  function writeHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      const c = map.getCenter(), h = new URLSearchParams();
      h.set('ll', `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`);
      h.set('z', String(map.getZoom()));
      h.set('y', state.sides.map((s) => s.year).join('-'));
      try { history.replaceState(null, '', '#' + h.toString().replace(/%2C/g, ',')); } catch (e) { /* file:// */ }
    }, 250);
  }
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    const ll = (h.get('ll') || '').split(',').map(Number);
    const ys = (h.get('y') || '').split('-').map(Number).filter((y) => sources.YEARS.includes(y)).slice(0, 2);
    const out = { years: ys, q: h.get('q') || '' };
    if (ll.length === 2 && ll.every(Number.isFinite)) { out.lat = ll[0]; out.lon = ll[1]; out.z = Math.max(9, Math.min(22, Math.round(+h.get('z')) || 19)); }
    return out;
  }
  let pin = null;
  function go(lat, lon, z, label) {
    stopPlay();
    map.setView([lat, lon], z, { animate: false });
    if (pin) map.removeLayer(pin);
    pin = null;
    if (label) {
      pin = L.circleMarker([lat, lon], { pane: 'marks', radius: 7, color: '#fff', weight: 2, fillColor: '#e8c36a', fillOpacity: 1, interactive: false }).addTo(map);
    }
    if (!regionLL.contains([lat, lon])) toast('That is outside the Denver region the photographs cover.', 6000);
  }

  const form = $('#search'), input = $('#q'), sugg = $('#places');
  function fillPlaces() {
    sugg.innerHTML = '<h2>Places to start</h2>';
    for (const [name, lat, lon, z] of PLACES) {
      const b = el('button', '', name);
      b.type = 'button';
      b.addEventListener('click', () => { input.value = name; sugg.hidden = true; go(lat, lon, z, name); });
      sugg.appendChild(b);
    }
  }
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    sugg.hidden = true;
    input.blur();
    const known = PLACES.find((p) => p[0].toLowerCase() === q.toLowerCase());
    if (known) return go(known[1], known[2], known[3], known[0]);
    form.classList.add('busy');
    try {
      const r = await geocode.geocode(q);
      go(r.lat, r.lon, Math.max(map.getZoom(), 19), r.label);
    } catch (e) { toast(e.message, 7000); }
    form.classList.remove('busy');
  });
  input.addEventListener('focus', () => { if (!input.value.trim()) sugg.hidden = false; input.select(); });
  input.addEventListener('input', () => { sugg.hidden = !!input.value.trim(); });
  document.addEventListener('pointerdown', (ev) => {
    if (!ev.target.closest('#search')) sugg.hidden = true;
    if (!ev.target.closest('#save-wrap')) $('#save-menu').hidden = true;
  });
  $('#locate').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('This browser has no location.');
    toast('Finding you…', 0);
    navigator.geolocation.getCurrentPosition(
      (pos) => { toast(''); go(pos.coords.latitude, pos.coords.longitude, 19, 'You'); },
      (err) => toast('Location unavailable: ' + err.message),
      { enableHighAccuracy: true, timeout: 10000 });
  });

  /* ---------- controls ---------- */
  $('#prev').addEventListener('click', () => { stopPlay(); step(-1); });
  $('#next').addEventListener('click', () => { stopPlay(); step(1); });
  $('#play').addEventListener('click', togglePlay);
  $('#compare').addEventListener('click', toggleCompare);
  divider.addEventListener('pointerdown', dragDivider);
  $('#tags').addEventListener('click', (ev) => {
    const t = ev.target.closest('.tag');
    if (!t) return;
    state.active = +t.dataset.side;
    chipSig = '';
    assess(); paintAll();
  });
  $('#save').addEventListener('click', () => { $('#save-menu').hidden = !$('#save-menu').hidden; });
  $('#save-one').addEventListener('click', () => { $('#save-menu').hidden = true; saveOne(); });
  $('#save-all').addEventListener('click', () => { $('#save-menu').hidden = true; saveAll(); });
  $('#share').addEventListener('click', async () => {
    writeHash();
    await new Promise((r) => setTimeout(r, 300));
    try {
      if (L.Browser.mobile && navigator.share) await navigator.share({ title: document.title, url: location.href });
      else { await navigator.clipboard.writeText(location.href); toast('Link to this view copied.'); }
    } catch (e) { if (e.name !== 'AbortError') toast(location.href, 8000); }
  });
  const about = $('#about');
  $('#info').addEventListener('click', async () => {
    const kept = await tiles.stats(), win = await cache.stats();
    const m = tiles.meter;
    $('#usage').textContent = `This visit: ${mb(m.net)} downloaded in ${m.requests.toLocaleString()} requests` + (m.kept ? `, and ${mb(m.kept)} reused from this browser.` : '.') +
      ` Kept in this browser: ${kept.tiles.toLocaleString()} map tiles and ${win.entries} archive reads (${mb(win.bytes)}).`;
    about.showModal();
  });
  $('#about-close').addEventListener('click', () => about.close());
  about.addEventListener('click', (ev) => { if (ev.target === about) about.close(); });
  function paintHd() {
    const b = $('#hd');
    b.hidden = dpr() < 1.5;
    b.classList.toggle('on', prefs.sharp);
    b.setAttribute('aria-pressed', String(prefs.sharp));
  }
  $('#hd').addEventListener('click', () => {
    prefs.sharp = !prefs.sharp;
    paintHd(); paintStatus();
    toast(prefs.sharp ? 'Full detail on: when the map rests zoomed in, it sharpens to your screen. About three times the data.' : 'Full detail off: ordinary screen detail only, about a third of the data.', 5000);
    if (prefs.sharp) restSoon();
  });
  $('#forget').addEventListener('click', async () => {
    await Promise.all([tiles.clear(), cache.clear()]);
    $('#usage').textContent = 'Kept imagery cleared from this browser.';
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.target.closest('input, textarea, dialog')) return;
    if (ev.key === 'ArrowLeft') { stopPlay(); step(-1); }
    else if (ev.key === 'ArrowRight') { stopPlay(); step(1); }
    else if (ev.key === ' ') { ev.preventDefault(); togglePlay(); }
    else if (ev.key === 'c') toggleCompare();
    else if (ev.key === '/') { ev.preventDefault(); input.focus(); }
  });

  /* ---------- sharpening when the map rests ---------- */
  let sharpTimer = 0;
  function restSoon() {
    clearTimeout(sharpTimer);
    if (!prefs.sharp || dpr() < 1.5) return;
    sharpTimer = setTimeout(async () => {
      if (map.getZoom() < SHARPEN_ZOOM || state.playing) return;
      for (const s of state.sides) if (s.view && s.view.on) for (const l of s.view.layers) await l.sharpen();
    }, 1500);
  }

  /* ---------- start ---------- */
  function init() {
    regionLL = regionBounds();
    const h = readHash();
    map = L.map('map', { zoomControl: false, attributionControl: false, minZoom: 9, maxZoom: 22, zoomSnap: 1, wheelPxPerZoomLevel: 90, maxBounds: regionLL.pad(1.5), maxBoundsViscosity: 0.6 })
      .setView([h.lat ?? HOME.lat, h.lon ?? HOME.lon], h.z ?? HOME.z);
    if (!L.Browser.mobile) L.control.zoom({ position: 'bottomright' }).addTo(map);
    map.createPane('base').style.zIndex = 200;
    map.createPane('context').style.zIndex = 300;
    map.createPane('marks').style.zIndex = 620;
    /* Outside the photographed region Esri's world imagery is the ground.
       Zoomed in, its tiles are never asked for inside the region; far out,
       where the flight's ragged edge is on screen, they are a few small
       tiles under the whole view. */
    const Base = tiles.Layer.extend({
      _isValidTile(coords) {
        if (!tiles.Layer.prototype._isValidTile.call(this, coords)) return false;
        return coords.z <= 12 || !regionLL.contains(this._tileCoordsToBounds(coords));
      },
    });
    baseLayer = new Base({ pane: 'base', kind: 'xyz', tileSize: 256, minZoom: 0, maxNativeZoom: 17, service: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' }).addTo(map);

    if (h.years.length) { state.sides = h.years.map((y) => ({ year: y, view: null })); state.wantRead = h.years[0]; }
    for (const s of state.sides) if (S[s.year].stream) state.contextYear = s.year;
    $('#compare').classList.toggle('on', state.sides.length === 2);
    fillPlaces();
    paintHd();
    tiles.watch(paintMeter);
    tiles.prune();

    map.on('move', () => { if (state.sides.length === 2) clipSides(); });
    map.on('zoomend', () => redrawAll());
    map.on('moveend', () => { clipSides(); assessSoon(); writeHash(); restSoon(); });
    map.on('movestart', () => clearTimeout(sharpTimer));
    map.on('resize', () => { clipSides(); assessSoon(); });
    /* A link pasted over this one, or the back button. Our own updates use
       replaceState, which does not fire this. */
    window.addEventListener('hashchange', () => {
      const n = readHash();
      if (n.years.length) {
        for (const v of views.values()) if (v.side >= n.years.length) unmount(v);
        state.sides = n.years.map((y) => ({ year: y, view: null }));
        state.active = 0; state.wantRead = n.years[0]; chipSig = '';
        $('#compare').classList.toggle('on', state.sides.length === 2);
      }
      if (n.lat != null) map.setView([n.lat, n.lon], n.z, { animate: false });
      showSides();
    });
    showSides();
    restSoon();
    if (h.lat == null && h.q) { input.value = h.q; form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit')); }
  }

  DRAPP.app = { state, recs, views, map: () => map, how, over, share, readPlan, sideStatus, pick, step, toggleCompare, photo, yearsHere, layerSpecs };
  init();
})();
