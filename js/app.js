/* Page logic: address → window → one overlay per DRAPP year on an OSM map. */
(function () {
  const { proj, sources, tileindex, imageserver, tiffwindow, geocode, cache, warp } = DRAPP;
  const PX = 512;                 // state-plane render size
  const PAD = 1.03;               // render a little wider than shown, so the rotated square covers the box
  const SIDES = [150, 300, 600, 1200];

  const state = { lat: null, lon: null, side: 300, label: '', fresh: false, selected: null, opacity: 1 };
  let controller = null;          // aborts the in-flight render set
  let queue = [];                 // archive years still to read, front first
  const recs = new Map();         // year → record
  let map, box, pin;

  const $ = (sel, el = document) => el.querySelector(sel);
  const status = $('#status');
  const form = $('#addr-form');
  const input = $('#addr');
  const menu = $('#year-menu');
  const yearBtn = $('#year-btn');

  /* ---------- map ---------- */
  function initMap() {
    map = L.map('map', { zoomControl: true, maxZoom: 22, zoomSnap: 0.5 }).setView([39.74, -105.0], 10);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 22, maxNativeZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · imagery <a href="https://data.drcog.org">DRCOG DRAPP</a> (CC BY 3.0)',
    }).addTo(map);
    map.attributionControl.setPrefix(false);
    map.createPane('marks').style.zIndex = 450;   // outline and pin above the imagery overlays
  }

  /* ---------- per-year records + menu rows ---------- */
  function makeRec(year) {
    const row = document.createElement('div');
    row.className = 'yrow';
    row.dataset.year = year;
    row.innerHTML = `
      <button type="button" class="pick" aria-pressed="false">
        <b>${year}</b><span class="st">idle</span><i class="pbar" hidden><i></i></i>
      </button>
      <details class="files"><summary aria-label="Files for ${year}">⤓</summary><ul></ul></details>`;
    menu.querySelector('.rows').appendChild(row);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PX;
    const rec = {
      year, row, canvas,
      pick: $('.pick', row), st: $('.st', row), bar: $('.pbar i', row), files: $('.files ul', row),
      status: 'idle', src: '', meta: '', tiles: [], overlay: null, merc: null,
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
    rec.canvas.getContext('2d').clearRect(0, 0, PX, PX);
    if (rec.overlay) { map.removeLayer(rec.overlay); rec.overlay = null; }
    rec.merc = null; rec.src = ''; rec.meta = ''; rec.tiles = [];
    rec.files.innerHTML = '<li class="dim">looking up tiles…</li>';
    setStatus(rec, 'queued', 'queued', null);
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
    return (n.length > 1 ? `${Math.min(...n)}–${Math.max(...n)}` : String(n[0])) + ' in';
  }

  /* A finished square: warp onto the map, fade in if it is the one to show. */
  function finish(rec, win, sq, srcLabel, note) {
    rec.src = srcLabel + (note ? ' ' + note : '');
    rec.merc = warp.toMercator(rec.canvas, win, sq, PX);
    setStatus(rec, 'ready', readyText(rec), null);
    rec.merc.toBlob((blob) => {
      if (!blob || rec.status !== 'ready') return;
      const url = URL.createObjectURL(blob);
      rec.overlay = L.imageOverlay(url, warp.bounds(sq), { opacity: 0, className: 'drapp-ov', interactive: false, zIndex: 400 });
      rec.overlay.once('load', () => { URL.revokeObjectURL(url); showBest(); });
      rec.overlay.addTo(map);
    }, 'image/jpeg', 0.92);
  }

  /* Which year is on top: the user's pick if it is ready, else the newest ready year. */
  function currentYear() {
    const ready = sources.YEARS.filter((y) => recs.get(y).status === 'ready' && recs.get(y).overlay);
    if (!ready.length) return null;
    if (state.selected != null && ready.includes(state.selected)) return state.selected;
    return ready[ready.length - 1];
  }
  function showBest() {
    const cur = currentYear();
    for (const rec of recs.values()) {
      if (!rec.overlay) continue;
      rec.overlay.setOpacity(rec.year === cur ? state.opacity : 0);
      if (rec.year === cur) rec.overlay.bringToFront();
    }
    paintButton();
  }
  function paintButton() {
    const cur = currentYear();
    const want = state.selected;
    for (const rec of recs.values()) rec.pick.setAttribute('aria-pressed', String(rec.year === (want ?? cur)));
    if (cur == null) {
      yearBtn.textContent = state.lat == null ? 'Years' : (want ? `${want} · loading…` : 'loading…');
    } else if (want != null && want !== cur) {
      const r = recs.get(want);
      yearBtn.textContent = `${cur} · ${want} ${r.status === 'failed' || r.status === 'download' ? 'unavailable' : 'loading…'}`;
    } else {
      yearBtn.textContent = String(cur);
    }
    $('#year-src').textContent = cur != null ? (recs.get(cur).meta ? recs.get(cur).meta + ' · ' : '') + recs.get(cur).src : '';
    $('#save-year').disabled = cur == null;
  }

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

  /* ---------- rendering a location ---------- */
  async function show() {
    if (controller) controller.abort();
    controller = new AbortController();
    const { signal } = controller;

    const sp = proj.toStatePlane(state.lon, state.lat);
    if (!proj.inRegion(sp)) {
      say(`${state.label} is outside the DRAPP footprint (the Denver region). Nothing to show.`, 'warn');
      for (const rec of recs.values()) { resetRec(rec); setStatus(rec, 'failed', 'outside region', null); }
      map.setView([state.lat, state.lon], 12);
      return;
    }
    const win = proj.windowFor(sp.x, sp.y, state.side * PAD, PX);
    const sq = warp.mercSquare(state.lat, state.lon, state.side);
    const b = warp.bounds(sq);
    say(`${state.label} — ${state.side} ft square. Newest year first, then back through the archive.`);
    for (const rec of recs.values()) resetRec(rec);
    paintButton();

    if (box) map.removeLayer(box);
    if (pin) map.removeLayer(pin);
    box = L.rectangle(b, { pane: 'marks', color: '#e8c36a', weight: 1.5, fill: false, dashArray: '5 5', interactive: false }).addTo(map);
    pin = L.circleMarker([state.lat, state.lon], { pane: 'marks', radius: 4, color: '#e8c36a', weight: 2, fillColor: '#0f1418', fillOpacity: 1, interactive: false }).addTo(map);
    map.fitBounds(b, { padding: [40, 40], maxZoom: 20 });

    /* Cached squares first. */
    const cached = new Set();
    if (!state.fresh) {
      await Promise.all(sources.YEARS.map(async (year) => {
        const rec = recs.get(year);
        const hit = await cache.get(year, win);
        if (!hit || signal.aborted) return;
        try {
          await cache.draw(hit, rec.canvas);
          rec.meta = hit.meta || '';
          finish(rec, win, sq, hit.src || '', '· cached');
          cached.add(year);
        } catch (e) { /* fall through to a live render */ }
      }));
      if (signal.aborted) return;
    }
    const years = sources.YEARS.filter((y) => !cached.has(y));

    /* Tile lookups for every year, in parallel; they are tiny. */
    const lookups = sources.YEARS.map(async (year) => {
      const rec = recs.get(year);
      try {
        fillFiles(rec, await tileindex.tilesFor(year, win, signal));
      } catch (e) {
        if (e.name === 'AbortError') return;
        rec.files.innerHTML = `<li class="dim">tile index unavailable (${e.message})</li>`;
      }
    });

    /* Streamed years, all at once; the newest fades in as soon as it lands. */
    const fallbacks = [], toCache = [];
    const streamed = years.filter((y) => sources.SOURCES[y].stream).map(async (year) => {
      const rec = recs.get(year);
      setStatus(rec, 'loading', 'streaming…', null);
      try {
        await imageserver.render(sources.SOURCES[year].stream, win, rec.canvas, signal);
        finish(rec, win, sq, sources.STREAM_LABEL);
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

    async function fromArchive(year) {
      const rec = recs.get(year);
      const src = sources.SOURCES[year];
      if (src.archive !== 'tif') {
        setStatus(rec, 'download', src.archive === 'jp2' ? 'JPEG 2000 — download only (≈8 MB)' : 'MrSID — download only, opens in QGIS', null);
        return;
      }
      if (!rec.tiles.length) { setStatus(rec, 'failed', 'no archive tile indexed here', null); return; }
      const t0 = performance.now();
      try {
        setStatus(rec, 'loading', 'opening tile…', 0);
        const out = await tiffwindow.render(rec.tiles, win, rec.canvas, signal, (f, note) => setStatus(rec, 'loading', note, f));
        const secs = ((performance.now() - t0) / 1000).toFixed(1);
        finish(rec, win, sq, sources.ARCHIVE_LABEL, `(${out.mode}, ${secs}s)`);
        cache.put(year, win, rec.canvas, { src: sources.ARCHIVE_LABEL, meta: rec.meta });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        setStatus(rec, 'failed', e.message, null);
      }
    }

    await Promise.all(lookups);
    if (signal.aborted) return;
    queue = years.filter((y) => !sources.SOURCES[y].stream).sort((a, b) => b - a);
    if (state.selected != null && queue.includes(state.selected)) queue = [state.selected, ...queue.filter((y) => y !== state.selected)];
    for (const y of queue) setStatus(recs.get(y), 'queued', 'queued', null);
    try {
      while (queue.length) {
        if (signal.aborted) return;
        await fromArchive(queue.shift());
      }
      await Promise.all(streamed);
      for (const year of toCache) {
        const rec = recs.get(year);
        cache.put(year, win, rec.canvas, { src: sources.STREAM_LABEL, meta: rec.meta });
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
    if (!signal.aborted) { say(`${state.label} — ${state.side} ft square. All years loaded.`); updateCacheNote(); }
  }

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
      ? `${st.entries} rendered square${st.entries === 1 ? '' : 's'} (${(st.bytes / 1e6).toFixed(1)} MB) kept in this browser.`
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
  $('#save-year').addEventListener('click', () => {
    const cur = currentYear();
    if (cur == null) return;
    download(recs.get(cur).merc, `drapp-${cur}-${state.lat.toFixed(5)}_${state.lon.toFixed(5)}-${state.side}ft.png`);
  });

  function contactSheet() {
    if (!sources.YEARS.some((y) => recs.get(y).status === 'ready')) return null;
    const cols = 4, gap = 16, label = 34, footer = 40;
    const rows = Math.ceil(sources.YEARS.length / cols);
    const sheet = document.createElement('canvas');
    sheet.width = cols * PX + (cols + 1) * gap;
    sheet.height = rows * (PX + label) + (rows + 1) * gap + footer;
    const ctx = sheet.getContext('2d');
    ctx.fillStyle = '#0f1418'; ctx.fillRect(0, 0, sheet.width, sheet.height);
    ctx.textBaseline = 'middle';
    sources.YEARS.forEach((year, i) => {
      const rec = recs.get(year);
      const x = gap + (i % cols) * (PX + gap), y = gap + Math.floor(i / cols) * (PX + label + gap);
      ctx.fillStyle = '#e6e9ec'; ctx.font = '600 22px system-ui, sans-serif';
      ctx.fillText(String(year), x, y + label / 2);
      ctx.fillStyle = '#98a3ad'; ctx.font = '14px system-ui, sans-serif';
      if (rec.meta) ctx.fillText(rec.meta, x + 70, y + label / 2);
      if (rec.status === 'ready' && rec.merc) ctx.drawImage(rec.merc, x, y + label);
      else {
        ctx.fillStyle = '#171e25'; ctx.fillRect(x, y + label, PX, PX);
        ctx.fillStyle = '#98a3ad'; ctx.textAlign = 'center';
        ctx.fillText(rec.st.textContent.slice(0, 60), x + PX / 2, y + label + PX / 2);
        ctx.textAlign = 'left';
      }
    });
    ctx.fillStyle = '#98a3ad'; ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(`${state.label} · ${state.side} ft square, north up · DRAPP imagery, DRCOG Regional Data Catalog (CC BY 3.0) · drapp.myjimmycloud.com`, gap, sheet.height - footer / 2);
    return sheet;
  }
  $('#save-all').addEventListener('click', () => {
    const sheet = contactSheet();
    if (!sheet) return say('Nothing rendered yet to save.', 'warn');
    download(sheet, `drapp-all-years-${state.lat.toFixed(5)}_${state.lon.toFixed(5)}-${state.side}ft.png`);
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
  else say('Type an address in the Denver region to see it in every DRAPP year.');
  updateCacheNote();

  DRAPP.app = { state, show, recs, contactSheet, currentYear, map: () => map };
})();
