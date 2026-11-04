/* Page logic: address → window → one overlay per year on the base map, and
   "load this view" for anything past the first square.

   Two ways in, one loader:
     - An address renders a square (150–1200 ft) in every year: the reasonable
       first download, newest year first, then back through the archive.
     - Panning or zooming away from what is loaded raises a prompt with the
       cost of the current map view per year (js/estimate.js); nothing past
       the square is fetched until the user picks years and says go. That is
       what keeps a curious pan from turning into thousands of range requests
       against DRCOG's bucket.

   Resolution: every window sits on DRAPP's 3-inch grid (js/proj.js) so the
   source pixels arrive untouched, and the map overlay is re-warped from the
   lossless state-plane canvas at the screen's own pixel density whenever the
   zoom changes (js/warp.js) — the pixels you see at any zoom are one resample
   from the source. */
(function () {
  const { proj, sources, tileindex, imageserver, tiffwindow, geocode, cache, warp, basemaps, providers, estimate } = DRAPP;
  const SRC_RES = proj.GRID;       // 0.25 ft: DRAPP's finest ground sample
  /* The automatic square is rendered no coarser than the source and no finer
     than the screen, with a per-path ceiling because the paths cost
     differently: the ImageServer is one request whatever the size (refuses
     past 4096); the archive is one range request per source row. 150 and
     300 ft squares always get the source's own pixels — the resolution is the
     thing you came to see — so the screen ceiling never drops below 1200. */
  const CAP_STREAM = 2048, CAP_ARCHIVE = 1280, PX_FLOOR = 1200;
  const CAP_VIEW = 4096;           // a loaded view is at most this many pixels a side; coarser past that
  const VIEW_MAX_FT = 10560;       // 2 miles wide is the most a view load will offer
  const VIEW_MIN_ZOOM = 14;
  const OV_MAX = 4096;             // overlay canvas of the year on show, pixels a side
  const OV_IDLE = 1024;            // years not on show are kept at most this big
  const CELL = 768;                // contact-sheet cell
  const SIDES = [150, 300, 600, 1200];
  const R = 20037508.342789244;    // Web Mercator half-circumference, metres

  const state = { lat: null, lon: null, side: 300, label: '', fresh: false, selected: null, opacity: 1, load: null };
  let controller = null;           // aborts the in-flight load
  let queue = [];                  // archive years still to read, front first
  const recs = new Map();          // year → record
  let map, box, pin, base;
  const extraCredit = 'Historical: ' + [...new Set(sources.YEARS.flatMap((y) => (sources.SOURCES[y].providers || []).map((p) => p.credit)))].join(', ');

  const $ = (sel, el = document) => el.querySelector(sel);
  const status = $('#status');
  const form = $('#addr-form');
  const input = $('#addr');
  const menu = $('#year-menu');
  const yearBtn = $('#year-btn');

  /* ---------- map ---------- */
  function initMap() {
    map = L.map('map', { zoomControl: false, maxZoom: 22, zoomSnap: 0.5 }).setView([39.74, -105.0], 10);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution(
      'DRAPP imagery <a href="https://data.drcog.org" rel="noopener">DRCOG</a> (CC BY 3.0)');
    map.createPane('marks').style.zIndex = 450;   // outline and pin above the imagery overlays
    base = basemaps.init(map, { button: $('#base-btn'), menu: $('#base-menu') });
    map.on('zoomend', () => { const cur = currentYear(); if (cur != null) fitDensity(recs.get(cur)); scheduleViewCheck(); });
    map.on('moveend resize', scheduleViewCheck);
  }

  const dpr = () => window.devicePixelRatio || 1;

  /* Device pixels the square lands on once it is fitted to the map. */
  function screenPx() {
    const s = map.getSize();
    return Math.max(1, Math.min(s.x, s.y) - 80) * dpr();
  }

  /* Ground feet per device pixel at the map centre, at the current zoom. */
  function deviceRes() {
    const lat = map.getCenter().lat;
    const mPerCss = (2 * R / 256 / 2 ** map.getZoom()) * Math.cos(lat * Math.PI / 180);
    return mPerCss / dpr() / 0.3048;
  }

  /* Feet per pixel for a square: source pixels, screen pixels, path ceiling —
     coarsest wins, snapped to the source grid. */
  function squareRes(sideFt, cap, screen = screenPx()) {
    const px = Math.min(sideFt / SRC_RES, Math.max(PX_FLOOR, Math.min(screen, cap)));
    return proj.snapRes(sideFt / px);
  }

  /* The map view as a state-plane window at the screen's density, no finer
     than the source, no bigger than CAP_VIEW a side. */
  function viewWindow() {
    const b = map.getBounds();
    const pts = [[b.getWest(), b.getSouth()], [b.getEast(), b.getSouth()], [b.getEast(), b.getNorth()], [b.getWest(), b.getNorth()]]
      .map(([lon, lat]) => proj.toStatePlane(lon, lat));
    const xmin = Math.min(...pts.map((p) => p.x)), xmax = Math.max(...pts.map((p) => p.x));
    const ymin = Math.min(...pts.map((p) => p.y)), ymax = Math.max(...pts.map((p) => p.y));
    let res = proj.snapRes(Math.max(SRC_RES, deviceRes()));
    while ((xmax - xmin) / res > CAP_VIEW || (ymax - ymin) / res > CAP_VIEW) res = proj.snapRes(res * 2);
    return proj.windowBox(xmin, ymin, xmax, ymax, res);
  }

  /* Does window `w` serve view `v`: centre inside, at least half the area,
     and not much coarser than the screen (when finer exists). */
  function covers(w, v) {
    if (!w) return false;
    if (v.cx < w.xmin || v.cx > w.xmax || v.cy < w.ymin || v.cy > w.ymax) return false;
    const ix = Math.max(0, Math.min(w.xmax, v.xmax) - Math.max(w.xmin, v.xmin));
    const iy = Math.max(0, Math.min(w.ymax, v.ymax) - Math.max(w.ymin, v.ymin));
    if (ix * iy < 0.5 * v.w * v.h) return false;
    if (w.res > SRC_RES && w.res >= 1.5 * v.res) return false;
    return true;
  }

  /* ---------- per-year records + menu rows ---------- */
  function makeRec(year) {
    const row = document.createElement('div');
    row.className = 'yrow';
    row.dataset.year = year;
    row.innerHTML = `
      <button type="button" class="pick" aria-pressed="false">
        <b>${sources.label(year)}</b><span class="st">idle</span><i class="pbar" hidden><i></i></i>
      </button>
      <details class="files"><summary aria-label="Files for ${sources.label(year)}">⤓</summary><ul></ul></details>`;
    menu.querySelector('.rows').appendChild(row);
    const canvas = document.createElement('canvas');
    const rec = {
      year, row, canvas,
      pick: $('.pick', row), st: $('.st', row), bar: $('.pbar i', row), files: $('.files ul', row),
      status: 'idle', src: '', meta: '', credit: '', tiles: [],
      win: null, rect: null, overlay: null, ovCanvas: null, ovW: 0,
    };
    rec.pick.addEventListener('click', () => choose(year));
    return rec;
  }

  function setStatus(rec, status, text, frac) {
    rec.status = status;
    rec.row.className = 'yrow ' + status;
    rec.st.textContent = text;
    rec.bar.parentElement.hidden = frac == null;
    if (frac != null) rec.bar.style.width = Math.round(frac * 100) + '%';
    if (status !== 'loading') paintButton();
  }

  function resetRec(rec) {
    rec.canvas.getContext('2d').clearRect(0, 0, rec.canvas.width, rec.canvas.height);
    if (rec.overlay) { map.removeLayer(rec.overlay); rec.overlay = null; }
    rec.win = null; rec.rect = null; rec.ovW = 0;
    rec.src = ''; rec.meta = ''; rec.credit = ''; rec.tiles = []; rec.indexError = '';
    rec.files.innerHTML = '<li class="dim">looking up tiles…</li>';
    setStatus(rec, 'queued', 'queued', null);
  }

  /* Years served by another agency have no DRCOG tiles to list; say where
     they come from instead. */
  function fillSources(rec) {
    rec.files.innerHTML = '';
    for (const p of sources.SOURCES[rec.year].providers) {
      const li = document.createElement('li');
      li.innerHTML = `<a href="${p.home}" rel="noopener">${p.credit}</a> <span class="dim">${p.src}</span>`;
      rec.files.appendChild(li);
    }
  }

  function fillFiles(rec, tiles) {
    rec.tiles = tiles;
    rec.files.innerHTML = '';
    if (!tiles.length) { rec.files.innerHTML = '<li class="dim">no tile indexed here</li>'; return; }
    const res = shortRes(tiles.map((t) => t.resolution).filter(Boolean)[0]);
    const date = tileindex.prettyDate(tiles.map((t) => t.photoDate).filter(Boolean)[0]);
    rec.meta = [res, date].filter(Boolean).join(' · ');
    for (const t of tiles) {
      const li = document.createElement('li');
      if (t.image) {
        li.innerHTML = `<span class="tname">${t.tile}</span> <a href="${t.image}" rel="noopener">.${t.image.split('.').pop()}</a>` +
          (t.world ? ` <a href="${t.world}" rel="noopener">.${t.world.split('.').pop()}</a>` : '');
      } else {
        li.innerHTML = `<span class="tname">${t.tile}</span> <span class="dim">not yet published</span>`;
      }
      rec.files.appendChild(li);
    }
    if (rec.status === 'ready') setStatus(rec, 'ready', readyText(rec), null);
  }

  const readyText = (rec) => rec.meta || 'ready';

  /* "3 Inch, 6 Inch" → "3–6 in", "6 Inch" → "6 in" */
  function shortRes(r) {
    if (!r) return '';
    const n = [...r.matchAll(/(\d+)\s*inch/gi)].map((m) => +m[1]);
    if (!n.length) return r;
    if (n.length === 1 && n[0] >= 12 && n[0] % 12 === 0) return `${n[0] / 12} ft`;
    return (n.length > 1 ? `${Math.min(...n)}–${Math.max(...n)}` : String(n[0])) + ' in';
  }

  /* ---------- overlays ---------- */

  /* Redraw a year's overlay from its state-plane master at the density the
     screen needs now: device pixels across the window, in steps of 256, up to
     OV_MAX. Bigger than the screen wastes memory and, past 2×, sharpness (the
     browser's own downscale is a plain bilinear). */
  function fitDensity(rec, idle) {
    if (!rec.overlay || !rec.rect) return;
    const b = L.latLngBounds(warp.bounds(rec.rect));
    const sw = map.latLngToContainerPoint(b.getSouthWest()), ne = map.latLngToContainerPoint(b.getNorthEast());
    const want = Math.max(256, Math.ceil(Math.abs(ne.x - sw.x) * dpr() / 256) * 256);
    const W = Math.min(idle ? OV_IDLE : OV_MAX, want);
    if (W === rec.ovW) return;
    warp.toMercator(rec.canvas, rec.win, rec.rect, W, rec.ovCanvas);
    rec.ovW = W;
  }

  /* A finished window: put it on the map, fade it in if it is the one to show. */
  function finish(rec, win, srcLabel, note) {
    rec.src = srcLabel + (note ? ' ' + note : '');
    rec.win = win;
    rec.rect = warp.mercRect(win);
    rec.ovCanvas = rec.ovCanvas || document.createElement('canvas');
    rec.ovW = 0;
    rec.overlay = new warp.CanvasOverlay(rec.ovCanvas, warp.bounds(rec.rect), { opacity: 0, className: 'drapp-ov', interactive: false, zIndex: 400 });
    setStatus(rec, 'ready', readyText(rec), null);
    const onShow = currentYear() === rec.year;
    fitDensity(rec, !onShow);
    rec.overlay.addTo(map);
    showBest();
  }

  /* Which year is on top: the user's pick if it is ready, else the newest ready year. */
  function currentYear() {
    const ready = sources.YEARS.filter((y) => recs.get(y).status === 'ready' && recs.get(y).overlay);
    if (!ready.length) return null;
    if (state.selected != null && ready.includes(state.selected)) return state.selected;
    return ready[ready.length - 1];
  }
  let demoteTimer = 0;
  function showBest() {
    const cur = currentYear();
    if (cur != null && recs.get(cur).credit) map.attributionControl.addAttribution(extraCredit);
    else map.attributionControl.removeAttribution(extraCredit);
    for (const rec of recs.values()) {
      if (!rec.overlay) continue;
      rec.overlay.setOpacity(rec.year === cur ? state.opacity : 0);
      if (rec.year === cur) { fitDensity(rec); rec.overlay.bringToFront(); }
    }
    /* Once the crossfade is over, shrink whatever is no longer on show. */
    clearTimeout(demoteTimer);
    demoteTimer = setTimeout(() => {
      const now = currentYear();
      for (const rec of recs.values()) if (rec.year !== now && rec.ovW > OV_IDLE) fitDensity(rec, true);
    }, 900);
    paintButton();
    scheduleViewCheck();
  }
  function paintButton() {
    const cur = currentYear();
    const want = state.selected;
    for (const rec of recs.values()) rec.pick.setAttribute('aria-pressed', String(rec.year === (want ?? cur)));
    if (cur == null) {
      yearBtn.textContent = state.load == null ? 'Years' : (want ? `${sources.label(want)} · loading…` : 'loading…');
    } else if (want != null && want !== cur) {
      const r = recs.get(want);
      yearBtn.textContent = `${sources.label(cur)} · ${sources.label(want)} ${r.status === 'failed' || r.status === 'download' ? 'unavailable' : 'loading…'}`;
    } else {
      yearBtn.textContent = sources.label(cur);
    }
    const r = cur != null ? recs.get(cur) : null;
    $('#year-src').textContent = r ? [r.meta, r.win ? `${r.win.w.toFixed(0)}×${r.win.h.toFixed(0)} ft at ${resLabel(r.win.res)}` : '', r.src].filter(Boolean).join(' · ') : '';
    $('#fade').hidden = cur == null;
    $('#save-year').disabled = cur == null;
  }
  const resLabel = (res) => res < 1 ? `${Math.round(res * 12)} in` : `${+res.toFixed(2)} ft`;

  function closeMenu() { menu.hidden = true; yearBtn.setAttribute('aria-expanded', 'false'); }

  function choose(year) {
    state.selected = year;
    const rec = recs.get(year);
    if (rec.status === 'queued' && queue.includes(year)) {          // jump the queue
      queue = [year, ...queue.filter((y) => y !== year)];
      setStatus(rec, 'queued', 'next up', null);
    }
    writeHash();
    showBest();
    closeMenu();
  }

  function stepYear(dir) {
    const ready = sources.YEARS.filter((y) => recs.get(y).status === 'ready');
    if (!ready.length) return;
    let i = ready.indexOf(currentYear());
    i = (i + dir + ready.length) % ready.length;
    choose(ready[i]);
  }

  /* ---------- tile lookups, shared by the loader and the estimate ---------- */
  const tilesCache = new Map();
  /* The index is asked once per year for the square and again for the view
     prompt; sixteen queries at once has had DRCOG's server answer some with
     errors, so they go four at a time. */
  const INDEX_LANES = 4;
  let lanes = 0; const waiting = [];
  function lane(fn) {
    return new Promise((resolve, reject) => {
      const run = () => { lanes++; fn().then(resolve, reject).finally(() => { lanes--; if (waiting.length) waiting.shift()(); }); };
      lanes < INDEX_LANES ? run() : waiting.push(run);
    });
  }
  function lookupTiles(year, win, signal) {
    const key = `${year}|${win.xmin.toFixed(0)}|${win.ymin.toFixed(0)}|${win.xmax.toFixed(0)}|${win.ymax.toFixed(0)}`;
    if (!tilesCache.has(key)) {
      if (tilesCache.size > 300) tilesCache.clear();
      const p = lane(() => tileindex.tilesFor(year, win, signal));
      p.then((t) => { p.settled = true; p.value = t; }, () => {
        p.settled = true; p.value = [];
        setTimeout(() => { if (tilesCache.get(key) === p) tilesCache.delete(key); }, 15000);   // a failure is retried later, not in a loop
      });
      tilesCache.set(key, p);
    }
    return tilesCache.get(key);
  }

  /* The window a year renders for a base window: streamed years take it as
     is; archive years may take a coarser sibling (the square's ceiling); a
     year from another agency renders at that source's own ground sample —
     asking a 1 ft flight for 3 inch pixels only invents them. */
  function winFor(year, base, archiveRes, lat, lon) {
    const src = sources.SOURCES[year];
    if (src.stream) return base;
    if (sources.isDrapp(year) && src.archive === 'tif') return archiveRes && archiveRes !== base.res ? proj.rewindow(base, archiveRes) : base;
    const here = (src.providers || []).filter((p) => providers.covers(p, lat, lon));
    if (!here.length) return base;
    const finest = Math.min(...here.map((p) => p.res / 12), 1);
    return finest > base.res ? proj.rewindow(base, finest) : base;
  }

  /* ---------- the loader ---------- */
  function drawBox(win) {
    if (box) map.removeLayer(box);
    box = L.polygon(warp.corners(win), { pane: 'marks', color: '#e8c36a', weight: 1.5, fill: false, dashArray: '5 5', interactive: false }).addTo(map);
  }

  /* Render `years` for the base window. o: {lat, lon, label, archiveRes, fit}. */
  async function load(base, years, o) {
    if (controller) controller.abort();
    controller = new AbortController();
    const { signal } = controller;
    const { lat, lon } = o;
    state.load = { win: base, lat, lon, label: o.label };
    hideView();
    drawBox(base);
    if (o.fit) map.fitBounds(warp.bounds(warp.mercRect(base)), { padding: [40, 40], maxZoom: 20 });
    say(`${o.label} — ${base.w.toFixed(0)} × ${base.h.toFixed(0)} ft at ${resLabel(base.res)} a pixel. ${years.length === sources.YEARS.length ? 'Newest year first, then back through the archive.' : years.length + (years.length === 1 ? ' year.' : ' years.')}`);
    map.attributionControl.removeAttribution(extraCredit);
    const winOf = (year) => winFor(year, base, o.archiveRes, lat, lon);
    for (const y of years) { const rec = recs.get(y); resetRec(rec); rec.win = winOf(y); }
    paintButton();
    const prep = (rec, w) => {
      rec.win = w;
      rec.canvas.width = w.px; rec.canvas.height = w.py;   // also clears it
      return w;
    };

    /* Cached windows first. */
    const cached = new Set();
    if (!state.fresh) {
      await Promise.all(years.map(async (year) => {
        const rec = recs.get(year);
        const w = winOf(year);
        const hit = await cache.get(year, w);
        if (!hit || signal.aborted) return;
        try {
          prep(rec, w);
          await cache.draw(hit, rec.canvas);
          rec.meta = hit.meta || ''; rec.credit = hit.credit || '';
          finish(rec, w, hit.src || '', '· cached');
          cached.add(year);
        } catch (e) { /* fall through to a live render */ }
      }));
      if (signal.aborted) return;
    }
    const todo = years.filter((y) => !cached.has(y));

    /* Tile lookups for every year, in parallel; they are tiny. */
    const lookups = years.map(async (year) => {
      const rec = recs.get(year);
      if (!sources.isDrapp(year)) { fillSources(rec); return; }
      try {
        fillFiles(rec, await lookupTiles(year, base, signal));
      } catch (e) {
        if (e.name === 'AbortError') return;
        rec.indexError = e.message;
        rec.files.innerHTML = `<li class="dim">tile index unavailable (${e.message})</li>`;
      }
    });

    /* Streamed years, all at once; the newest fades in as soon as it lands. */
    const fallbacks = [], toCache = [];
    const streamed = todo.filter((y) => sources.SOURCES[y].stream).map(async (year) => {
      const rec = recs.get(year);
      setStatus(rec, 'loading', 'streaming…', null);
      const w = winOf(year);
      try {
        await imageserver.render(sources.SOURCES[year].stream, prep(rec, w), rec.canvas, signal);
        finish(rec, w, sources.STREAM_LABEL);
        toCache.push(year);
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (sources.SOURCES[year].archive === 'tif') {
          setStatus(rec, 'queued', 'service failed, will read archive', null);
          fallbacks.push(year);
        } else {
          setStatus(rec, 'failed', e.message, null);
        }
      }
    });

    /* A year from another agency's service: one request, drawn on the same
       grid. Resolves true if it rendered. */
    async function fromProviders(year) {
      const rec = recs.get(year);
      const list = sources.SOURCES[year].providers;
      if (!list || !list.some((p) => providers.covers(p, lat, lon))) return false;
      setStatus(rec, 'loading', 'asking ' + [...new Set(list.map((p) => p.credit))].join(', ') + '…', null);
      const w = winOf(year);
      try {
        const r = await providers.render(list, lat, lon, prep(rec, w), rec.canvas, signal);
        rec.meta = [shortRes(r.provider.res + ' inch'), r.provider.credit].join(' · ');
        rec.credit = r.provider.credit;
        finish(rec, w, r.provider.src, r.note);
        cache.put(year, w, rec.canvas, { src: r.provider.src, meta: rec.meta, credit: rec.credit });
        return true;
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        setStatus(rec, 'failed', e.message, null);
        return false;
      }
    }
    const extras = todo.filter((y) => !sources.isDrapp(y)).map(async (year) => {
      const rec = recs.get(year);
      const list = sources.SOURCES[year].providers;
      if (!list.some((p) => providers.covers(p, lat, lon))) {
        setStatus(rec, 'failed', 'only ' + [...new Set(list.map((p) => p.area))].join(', '), null);
        return;
      }
      try { await fromProviders(year); } catch (e) { /* aborted */ }
    });

    async function fromArchive(year) {
      const rec = recs.get(year);
      const src = sources.SOURCES[year];
      if (src.archive !== 'tif') {
        if (await fromProviders(year)) return;
        if (rec.status === 'failed') return;   // a county service covers here but did not answer; say that, not "download"
        setStatus(rec, 'download', src.archive === 'jp2' ? 'JPEG 2000 — download only (≈8 MB)' : 'MrSID — download only, opens in QGIS', null);
        return;
      }
      if (!rec.tiles.length) { setStatus(rec, 'failed', rec.indexError ? 'tile index: ' + rec.indexError : 'no archive tile indexed here', null); return; }
      const w = winOf(year);
      const t0 = performance.now();
      try {
        setStatus(rec, 'loading', 'opening tile…', 0);
        const out = await tiffwindow.render(rec.tiles, prep(rec, w), rec.canvas, signal, (f, note) => setStatus(rec, 'loading', note, f));
        const secs = (performance.now() - t0) / 1000;
        estimate.learn(out.requests, out.bytes, secs);
        finish(rec, w, sources.ARCHIVE_LABEL, `(${out.mode}, ${out.requests} requests, ${estimate.mb(out.bytes)}, ${secs.toFixed(1)}s)`);
        cache.put(year, w, rec.canvas, { src: sources.ARCHIVE_LABEL, meta: rec.meta });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        setStatus(rec, 'failed', e.message, null);
      }
    }

    await Promise.all(lookups);
    if (signal.aborted) return;
    queue = todo.filter((y) => sources.isDrapp(y) && !sources.SOURCES[y].stream).sort((a, b) => b - a);
    if (state.selected != null && queue.includes(state.selected)) queue = [state.selected, ...queue.filter((y) => y !== state.selected)];
    for (const y of queue) setStatus(recs.get(y), 'queued', 'queued', null);
    try {
      while (queue.length) {
        if (signal.aborted) return;
        await fromArchive(queue.shift());
      }
      await Promise.all([...streamed, ...extras]);
      for (const year of toCache) {
        const rec = recs.get(year);
        cache.put(year, rec.win, rec.canvas, { src: sources.STREAM_LABEL, meta: rec.meta });
      }
      queue = fallbacks.sort((a, b) => b - a);
      while (queue.length) {
        if (signal.aborted) return;
        await fromArchive(queue.shift());
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      throw e;
    }
    if (!signal.aborted) {
      say(`${o.label} — ${years.length === sources.YEARS.length ? 'all years' : years.length === 1 ? sources.label(years[0]) : years.length + ' years'} loaded.`);
      updateCacheNote();
      scheduleViewCheck();
    }
  }

  /* An address: the square, every year. */
  function show() {
    const sp = proj.toStatePlane(state.lon, state.lat);
    if (!proj.inRegion(sp)) {
      say(`${state.label} is outside the DRAPP footprint (the Denver region). Nothing to show.`, 'warn');
      for (const rec of recs.values()) { resetRec(rec); setStatus(rec, 'failed', 'outside region', null); }
      map.setView([state.lat, state.lon], 12);
      return;
    }
    if (pin) map.removeLayer(pin);
    pin = L.circleMarker([state.lat, state.lon], { pane: 'marks', radius: 4, color: '#e8c36a', weight: 2, fillColor: '#0f1418', fillOpacity: 1, interactive: false }).addTo(map);
    const base = proj.windowFor(sp.x, sp.y, state.side, state.side, squareRes(state.side, CAP_STREAM));
    return load(base, sources.YEARS, { lat: state.lat, lon: state.lon, label: `${state.label} · ${state.side} ft square`, archiveRes: squareRes(state.side, CAP_ARCHIVE), fit: true });
  }

  /* ---------- load this view ---------- */
  const view = {
    el: $('#view-load'), chip: $('#view-chip'), panel: $('#view-panel'), desc: $('#view-desc'),
    years: $('#view-years'), go: $('#view-go'), all: $('#view-all'), none: $('#view-none'), dismiss: $('#view-dismiss'),
  };
  const viewSel = new Set();       // years ticked in the prompt; kept across views
  let viewWin = null;              // the window the prompt is about
  let dismissedWin = null;
  let viewTimer = 0;

  function scheduleViewCheck() {
    clearTimeout(viewTimer);
    viewTimer = setTimeout(viewCheck, 250);
  }
  function hideView() { view.el.hidden = true; viewWin = null; }

  function viewCheck() {
    if (!map || map.getZoom() < VIEW_MIN_ZOOM) return hideView();
    const c = map.getCenter();
    if (!proj.inRegion(proj.toStatePlane(c.lng, c.lat))) return hideView();
    const vw = viewWindow();
    const year = state.selected ?? currentYear();
    const rec = year != null ? recs.get(year) : null;
    if (rec && covers(rec.win, vw)) return hideView();
    if (dismissedWin && covers(dismissedWin, vw) && covers(vw, dismissedWin)) return hideView();
    viewWin = vw;
    if (!viewSel.size) viewSel.add(year ?? newestLoadable(vw));
    view.el.hidden = false;
    paintView();
  }

  const loadable = (year, vw) => {
    const src = sources.SOURCES[year];
    if (src.stream || (sources.isDrapp(year) && src.archive === 'tif')) return true;
    const { lat, lon } = proj.toLonLat(vw.cx, vw.cy);
    return (src.providers || []).some((p) => providers.covers(p, lat, lon));
  };
  /* The default tick: the newest DRAPP mosaic, which is one cheap request;
     failing that the newest year that can render here at all. */
  const newestLoadable = (vw) => [...sources.YEARS].reverse().find((y) => sources.SOURCES[y].stream)
    ?? [...sources.YEARS].reverse().find((y) => loadable(y, vw));

  /* Estimates for the prompt: streamed years are known at once; archive years
     wait for their tile lookup and repaint when it lands. */
  let viewEsts = new Map();
  function paintView() {
    const vw = viewWin;
    if (!vw) return;
    const { lat, lon } = proj.toLonLat(vw.cx, vw.cy);
    const wide = vw.w > VIEW_MAX_FT;
    view.desc.textContent = `${vw.w.toFixed(0)} × ${vw.h.toFixed(0)} ft at ${resLabel(vw.res)} a pixel (${vw.px.toLocaleString()} × ${vw.py.toLocaleString()} px)`;
    if (wide) {
      view.chip.textContent = `Zoom in to load imagery — the view is ${(vw.w / 5280).toFixed(1)} mi wide`;
      view.chip.disabled = true;
      view.panel.hidden = true;
      return;
    }
    view.chip.disabled = false;
    const ests = new Map();
    for (const year of sources.YEARS) {
      if (!loadable(year, vw)) continue;
      const w = winFor(year, vw, null, lat, lon);
      const src = sources.SOURCES[year];
      let tiles;
      if (sources.isDrapp(year) && src.archive === 'tif' && !src.stream) {
        const p = lookupTiles(year, vw);
        tiles = p.settled ? p.value : null;
        if (!p.settled && !p.repaint) {
          p.repaint = true;
          p.catch(() => {}).then(() => { if (viewWin === vw) paintView(); });
        }
      }
      ests.set(year, estimate.forYear(year, w, tiles, lat, lon));
    }
    viewEsts = ests;
    paintTotals();
    if (view.panel.hidden) return;
    view.years.innerHTML = '';
    for (const year of [...sources.YEARS].reverse()) {
      if (!ests.has(year)) continue;
      const e = ests.get(year);
      const row = document.createElement('label');
      row.className = 'vrow' + (e && e.why ? ' off' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = year;
      cb.checked = viewSel.has(year) && !(e && e.why);
      cb.disabled = !!(e && e.why);
      cb.addEventListener('change', () => { if (cb.checked) viewSel.add(year); else viewSel.delete(year); paintTotals(); });
      const em = document.createElement('em');
      em.textContent = e === undefined ? '…' : e.why ? e.why : estimate.long(e) + (e.how ? ` · ${e.how}` : '');
      row.append(cb, Object.assign(document.createElement('b'), { textContent: sources.label(year) }), em);
      view.years.appendChild(row);
    }
  }
  /* The chip and the go button: the ticked years' total. */
  function paintTotals() {
    const ests = viewEsts;
    const picked = [...viewSel].filter((y) => ests.has(y) && !(ests.get(y) && ests.get(y).why));
    const total = estimate.sum(picked.map((y) => ests.get(y)));
    const unknown = picked.some((y) => ests.get(y) === undefined);
    const who = picked.length === 1 ? sources.label(picked[0]) : `${picked.length} years`;
    view.chip.textContent = picked.length ? `Load this view · ${who} ${unknown ? '…' : estimate.short(total)}` : 'Load this view…';
    view.go.textContent = picked.length ? `Load ${who}${unknown ? '' : ' · ' + estimate.long(total)}` : 'Pick a year';
    view.go.disabled = !picked.length || unknown;
    for (const cb of view.years.querySelectorAll('input')) cb.checked = viewSel.has(+cb.value) && !cb.disabled;
  }

  view.chip.addEventListener('click', () => {
    view.panel.hidden = !view.panel.hidden;
    view.chip.setAttribute('aria-expanded', String(!view.panel.hidden));
    paintView();
  });
  view.all.addEventListener('click', () => { for (const y of sources.YEARS) if (viewWin && loadable(y, viewWin)) viewSel.add(y); paintTotals(); });
  view.none.addEventListener('click', () => { viewSel.clear(); paintTotals(); });
  view.dismiss.addEventListener('click', () => { dismissedWin = viewWin; view.panel.hidden = true; hideView(); });
  view.go.addEventListener('click', () => {
    if (!viewWin) return;
    const vw = viewWin;
    const years = [...sources.YEARS].reverse().filter((y) => viewSel.has(y) && loadable(y, vw));
    if (!years.length) return;
    const { lat, lon } = proj.toLonLat(vw.cx, vw.cy);
    view.panel.hidden = true;
    view.chip.setAttribute('aria-expanded', 'false');
    if (state.selected == null || !years.includes(state.selected)) { state.selected = years[0]; writeHash(); }
    load(vw, years, { lat, lon, label: 'Map view' });
  });

  /* ---------- status + hash ---------- */
  function say(text, kind) {
    status.textContent = text;
    status.className = kind || '';
  }

  async function updateCacheNote() {
    const st = await cache.stats();
    const el = $('#cache-note');
    if (!el) return;
    el.textContent = st.entries
      ? `${st.entries} rendered window${st.entries === 1 ? '' : 's'} (${(st.bytes / 1e6).toFixed(1)} MB) kept in this browser.`
      : 'Nothing cached in this browser yet.';
  }

  function writeHash() {
    if (state.lat == null) return;
    const h = new URLSearchParams();
    h.set('ll', `${state.lat.toFixed(6)},${state.lon.toFixed(6)}`);
    h.set('s', state.side);
    if (state.selected != null) h.set('y', state.selected);
    if (state.label) h.set('q', state.label);
    history.replaceState(null, '', '#' + h.toString());
  }

  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    const ll = (h.get('ll') || '').split(',').map(Number);
    const s = +h.get('s');
    if (SIDES.includes(s)) state.side = s;
    const y = +h.get('y');
    if (sources.YEARS.includes(y)) state.selected = y;
    state.fresh = h.get('fresh') === '1';
    if (ll.length === 2 && ll.every((v) => Number.isFinite(v))) {
      state.lat = ll[0]; state.lon = ll[1];
      state.label = h.get('q') || `${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}`;
      return true;
    }
    if (h.get('q')) { input.value = h.get('q'); return 'geocode'; }
    return false;
  }

  function go(lat, lon, label) {
    state.lat = lat; state.lon = lon; state.label = label;
    input.value = label;
    writeHash();
    show();
  }

  /* ---------- controls ---------- */
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    say('Finding that address…');
    try {
      const r = await geocode.geocode(q);
      go(r.lat, r.lon, r.label);
    } catch (e) {
      say(e.message, 'warn');
    }
  });

  $('#locate').addEventListener('click', () => {
    if (!navigator.geolocation) return say('This browser has no geolocation.', 'warn');
    say('Asking the browser where you are…');
    navigator.geolocation.getCurrentPosition(
      (pos) => go(pos.coords.latitude, pos.coords.longitude, `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`),
      (err) => say('Location unavailable: ' + err.message, 'warn'),
      { enableHighAccuracy: true, timeout: 10000 });
  });

  $('#load-here').addEventListener('click', () => {
    const c = map.getCenter();
    go(c.lat, c.lng, `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`);
  });

  const sizeBtns = [...document.querySelectorAll('#sizes button')];
  function paintSizes() { for (const b of sizeBtns) b.setAttribute('aria-pressed', String(+b.dataset.side === state.side)); }
  for (const b of sizeBtns) {
    b.addEventListener('click', () => {
      state.side = +b.dataset.side;
      paintSizes();
      if (state.lat != null) { writeHash(); show(); }
    });
  }

  yearBtn.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    yearBtn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', (ev) => {
    if (!menu.hidden && !ev.target.closest('.panel-years')) closeMenu();
  });
  $('#year-prev').addEventListener('click', () => stepYear(-1));
  $('#year-next').addEventListener('click', () => stepYear(1));
  document.addEventListener('keydown', (ev) => {
    if (ev.target.closest('input, textarea')) return;
    if (ev.key === 'ArrowLeft') stepYear(-1);
    if (ev.key === 'ArrowRight') stepYear(1);
    if (ev.key === 'Escape' && !menu.hidden) closeMenu();
  });
  const opacity = $('#opacity');
  opacity.addEventListener('input', () => { state.opacity = +opacity.value / 100; showBest(); });

  /* ---------- save ---------- */
  function download(canvas, name) {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  const fileStem = (rec) => `drapp-${rec.year}-${proj.toLonLat(rec.win.cx, rec.win.cy).lat.toFixed(5)}_${proj.toLonLat(rec.win.cx, rec.win.cy).lon.toFixed(5)}-${rec.win.w.toFixed(0)}x${rec.win.h.toFixed(0)}ft`;
  $('#save-year').addEventListener('click', () => {
    const cur = currentYear();
    if (cur == null) return;
    const rec = recs.get(cur);
    download(warp.toMercator(rec.canvas, rec.win, rec.rect, rec.win.px), fileStem(rec) + '.png');   // north up, source pixels
  });

  function contactSheet() {
    if (!sources.YEARS.some((y) => recs.get(y).status === 'ready')) return null;
    const cols = 4, gap = 16, label = 34, footer = 40;
    const rows = Math.ceil(sources.YEARS.length / cols);
    const sheet = document.createElement('canvas');
    sheet.width = cols * CELL + (cols + 1) * gap;
    sheet.height = rows * (CELL + label) + (rows + 1) * gap + footer;
    const ctx = sheet.getContext('2d');
    ctx.fillStyle = '#0f1418'; ctx.fillRect(0, 0, sheet.width, sheet.height);
    ctx.textBaseline = 'middle';
    ctx.imageSmoothingQuality = 'high';
    sources.YEARS.forEach((year, i) => {
      const rec = recs.get(year);
      const x = gap + (i % cols) * (CELL + gap), y = gap + Math.floor(i / cols) * (CELL + label + gap);
      ctx.fillStyle = '#e6e9ec'; ctx.font = '600 22px system-ui, sans-serif';
      ctx.fillText(sources.label(year), x, y + label / 2);
      ctx.fillStyle = '#98a3ad'; ctx.font = '14px system-ui, sans-serif';
      if (rec.meta) ctx.fillText(rec.meta, x + 70, y + label / 2);
      if (rec.status === 'ready' && rec.win) {
        const s = Math.min(CELL / rec.win.px, CELL / rec.win.py), w = rec.win.px * s, h = rec.win.py * s;
        ctx.fillStyle = '#171e25'; ctx.fillRect(x, y + label, CELL, CELL);
        ctx.drawImage(rec.canvas, x + (CELL - w) / 2, y + label + (CELL - h) / 2, w, h);
      } else {
        ctx.fillStyle = '#171e25'; ctx.fillRect(x, y + label, CELL, CELL);
        ctx.fillStyle = '#98a3ad'; ctx.textAlign = 'center';
        ctx.fillText(rec.st.textContent.slice(0, 60), x + CELL / 2, y + label + CELL / 2);
        ctx.textAlign = 'left';
      }
    });
    ctx.fillStyle = '#98a3ad'; ctx.font = '14px system-ui, sans-serif';
    const credits = ['DRAPP imagery, DRCOG Regional Data Catalog (CC BY 3.0)',
      ...new Set(sources.YEARS.filter((y) => recs.get(y).status === 'ready' && recs.get(y).credit).map((y) => recs.get(y).credit))];
    const l = state.load;
    ctx.fillText(`${l ? l.label : ''} · grid north up · ${credits.join(' · ')} · drapp.myjimmycloud.com`, gap, sheet.height - footer / 2);
    return sheet;
  }
  $('#save-all').addEventListener('click', () => {
    const sheet = contactSheet();
    if (!sheet) return say('Nothing rendered yet to save.', 'warn');
    const l = state.load;
    download(sheet, `drapp-all-years-${l ? l.lat.toFixed(5) + '_' + l.lon.toFixed(5) : 'view'}.png`);
  });
  $('#clear-cache').addEventListener('click', async (ev) => {
    ev.preventDefault();
    await cache.clear();
    updateCacheNote();
    say('Cache cleared. The next address will be fetched fresh.');
  });

  /* ---------- boot ---------- */
  initMap();
  for (const y of [...sources.YEARS].reverse()) recs.set(y, makeRec(y));
  const h = readHash();
  paintSizes();
  paintButton();
  if (h === true) { input.value = state.label; show(); }
  else if (h === 'geocode') form.requestSubmit();
  else say('Type an address in the Denver region to see it in every DRAPP year — or zoom the map in and load the view.');
  updateCacheNote();

  DRAPP.app = { state, show, load, recs, contactSheet, currentYear, squareRes, viewWindow, covers, map: () => map, base: () => base };
})();
