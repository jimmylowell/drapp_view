/* Page logic: address → window → one card per DRAPP year. */
(function () {
  const { proj, sources, tileindex, imageserver, tiffwindow, geocode, cache } = DRAPP;
  const PX = 480;
  const SIDES = [150, 300, 600, 1200];

  const state = { lat: null, lon: null, side: 300, label: '', cross: true, fresh: false };
  let controller = null;        // aborts the in-flight render set
  const cards = new Map();      // year → card record

  const $ = (sel, el = document) => el.querySelector(sel);
  const grid = $('#grid');
  const status = $('#status');
  const form = $('#addr-form');
  const input = $('#addr');

  /* ---------- cards ---------- */
  function makeCard(year) {
    const src = sources.SOURCES[year];
    const el = document.createElement('article');
    el.className = 'card';
    el.dataset.year = year;
    el.innerHTML = `
      <header><h2>${year}</h2><span class="meta"></span></header>
      <div class="frame">
        <canvas width="${PX}" height="${PX}" aria-label="DRAPP ${year} aerial at the chosen address"></canvas>
        <div class="cross" hidden></div>
        <div class="overlay"><div class="msg">waiting</div><div class="bar"><i></i></div></div>
      </div>
      <footer>
        <span class="src">${src.stream ? sources.STREAM_LABEL : (src.archive === 'tif' ? sources.ARCHIVE_LABEL : 'download only')}</span>
        <div class="actions">
          <button type="button" class="larger" disabled>Larger</button>
          <details class="tiles"><summary>Tiles</summary><ul></ul></details>
        </div>
      </footer>`;
    const rec = {
      year, el,
      canvas: $('canvas', el), meta: $('.meta', el), overlay: $('.overlay', el),
      msg: $('.msg', el), bar: $('.bar i', el), src: $('.src', el),
      larger: $('.larger', el), tiles: $('.tiles ul', el), cross: $('.cross', el),
      ready: false,
    };
    rec.larger.addEventListener('click', () => openLightbox(year));
    grid.appendChild(el);
    return rec;
  }

  function setOverlay(rec, text, frac) {
    rec.overlay.hidden = text == null;
    if (text != null) rec.msg.textContent = text;
    rec.bar.parentElement.hidden = frac == null;
    if (frac != null) rec.bar.style.width = Math.round(frac * 100) + '%';
  }

  function resetCard(rec) {
    rec.canvas.getContext('2d').clearRect(0, 0, PX, PX);
    rec.ready = false;
    rec.larger.disabled = true;
    rec.el.classList.remove('done', 'failed');
    rec.meta.textContent = '';
    rec.tiles.innerHTML = '<li class="dim">looking up tiles…</li>';
    setOverlay(rec, 'queued', null);
  }

  function markDone(rec, sourceLabel) {
    rec.ready = true;
    rec.larger.disabled = false;
    rec.el.classList.add('done');
    if (sourceLabel) rec.src.textContent = sourceLabel;
    setOverlay(rec, null);
  }

  function markFailed(rec, text) {
    rec.el.classList.add('failed');
    setOverlay(rec, text, null);
  }

  function fillTiles(rec, tiles) {
    rec.tiles.innerHTML = '';
    if (!tiles.length) { rec.tiles.innerHTML = '<li class="dim">no tile indexed here</li>'; return; }
    const res = tiles.map((t) => t.resolution).filter(Boolean)[0];
    const date = tileindex.prettyDate(tiles.map((t) => t.photoDate).filter(Boolean)[0]);
    rec.meta.textContent = [res, date].filter(Boolean).join(' · ');
    for (const t of tiles) {
      const li = document.createElement('li');
      if (t.image) {
        const ext = t.image.split('.').pop();
        li.innerHTML = `<span class="tname">${t.tile}</span> <a href="${t.image}" rel="noopener">.${ext}</a>` +
          (t.world ? ` <a href="${t.world}" rel="noopener">.${t.world.split('.').pop()}</a>` : '');
      } else {
        li.innerHTML = `<span class="tname">${t.tile}</span> <span class="dim">not yet published for download</span>`;
      }
      rec.tiles.appendChild(li);
    }
  }

  /* ---------- rendering a location ---------- */
  async function show() {
    if (controller) controller.abort();
    controller = new AbortController();
    const { signal } = controller;

    const sp = proj.toStatePlane(state.lon, state.lat);
    if (!proj.inRegion(sp)) {
      say(`${state.label} is outside the DRAPP footprint (the Denver region). Nothing to show.`, 'warn');
      for (const rec of cards.values()) { resetCard(rec); markFailed(rec, 'outside region'); }
      return;
    }
    const win = proj.windowFor(sp.x, sp.y, state.side, PX);
    say(`${state.label} — ${state.side} ft across. Streaming years first, then reading the archive tiles.`);
    $('#scale').textContent = `${state.side} ft`;
    for (const rec of cards.values()) resetCard(rec);

    /* Anything already rendered for this exact window paints from IndexedDB. */
    const cached = new Set();
    if (!state.fresh) {
      await Promise.all(sources.YEARS.map(async (year) => {
        const rec = cards.get(year);
        const hit = await cache.get(year, win);
        if (!hit || signal.aborted) return;
        try {
          await cache.draw(hit, rec.canvas);
          rec.meta.textContent = hit.meta || '';
          markDone(rec, (hit.src || '') + ' · from this browser\'s cache');
          cached.add(year);
        } catch (e) { /* fall through to a live render */ }
      }));
      if (signal.aborted) return;
    }
    const years = sources.YEARS.filter((y) => !cached.has(y));
    if (!years.length) { say(`${state.label} — ${state.side} ft across. All years from cache.`); updateCacheNote(); return; }

    /* Tile lookups for every year, in parallel; they are tiny. */
    const tilesByYear = new Map();
    const lookups = sources.YEARS.map(async (year) => {
      const rec = cards.get(year);
      try {
        const tiles = await tileindex.tilesFor(year, win, signal);
        tilesByYear.set(year, tiles);
        if (cached.has(year)) return;      // keep the cached meta line; links are still useful
        fillTiles(rec, tiles);
      } catch (e) {
        if (e.name === 'AbortError') return;
        tilesByYear.set(year, []);
        rec.tiles.innerHTML = `<li class="dim">tile index unavailable (${e.message})</li>`;
      }
    });

    /* Streamed years, all at once. A failure with an archive copy joins the
       archive queue instead of giving up. */
    const fallbacks = [], toCache = [];
    const streamed = years.filter((y) => sources.SOURCES[y].stream).map(async (year) => {
      const rec = cards.get(year);
      setOverlay(rec, 'requesting from image service…', null);
      try {
        await imageserver.render(sources.SOURCES[year].stream, win, rec.canvas, signal);
        markDone(rec, sources.STREAM_LABEL);
        toCache.push(year);      // written after the tile lookups so the meta line is in the record
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (sources.SOURCES[year].archive === 'tif') {
          setOverlay(rec, 'image service failed; queued for archive read', null);
          fallbacks.push(year);
        } else {
          markFailed(rec, e.message);
        }
      }
    });

    /* Archive years one at a time, newest first, so the request stream stays polite. */
    async function fromArchive(year) {
      const rec = cards.get(year);
      const src = sources.SOURCES[year];
      const tiles = tilesByYear.get(year) || [];
      if (src.archive !== 'tif') {
        markFailed(rec, src.archive === 'jp2'
          ? '2002 is JPEG 2000 — download the tile below (≈8 MB)'
          : '2008 is MrSID — download the tile below and open it in QGIS or ArcGIS');
        return;
      }
      if (!tiles.length) { markFailed(rec, 'no archive tile indexed here'); return; }
      const t0 = performance.now();
      try {
        setOverlay(rec, 'opening archive tile…', 0);
        const out = await tiffwindow.render(tiles, win, rec.canvas, signal, (f, note) => setOverlay(rec, note, f));
        const secs = ((performance.now() - t0) / 1000).toFixed(1);
        markDone(rec, `${sources.ARCHIVE_LABEL} (${out.mode}, ${secs}s)`);
        cache.put(year, win, rec.canvas, { src: sources.ARCHIVE_LABEL, meta: rec.meta.textContent });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        markFailed(rec, 'could not read tile: ' + e.message);
      }
    }
    await Promise.all(lookups);
    if (signal.aborted) return;
    try {
      for (const year of years.filter((y) => !sources.SOURCES[y].stream).sort((a, b) => b - a)) {
        await fromArchive(year);
      }
      await Promise.all(streamed);
      for (const year of toCache) {
        const rec = cards.get(year);
        cache.put(year, win, rec.canvas, { src: sources.STREAM_LABEL, meta: rec.meta.textContent });
      }
      for (const year of fallbacks.sort((a, b) => b - a)) await fromArchive(year);
    } catch (e) {
      if (e.name === 'AbortError') return;
      throw e;
    }
    if (!signal.aborted) { say(`${state.label} — ${state.side} ft across. Done.`); updateCacheNote(); }
  }

  /* The cached-years line in the footer. */
  async function updateCacheNote() {
    const st = await cache.stats();
    const el = $('#cache-note');
    if (!el) return;
    el.textContent = st.entries
      ? `${st.entries} rendered square${st.entries === 1 ? '' : 's'} (${(st.bytes / 1e6).toFixed(1)} MB) kept in this browser.`
      : 'Nothing cached in this browser yet.';
  }

  /* ---------- status + hash ---------- */
  function say(text, kind) {
    status.textContent = text;
    status.className = kind || '';
  }

  function writeHash() {
    const h = new URLSearchParams();
    h.set('ll', `${state.lat.toFixed(6)},${state.lon.toFixed(6)}`);
    h.set('s', state.side);
    if (state.label) h.set('q', state.label);
    history.replaceState(null, '', '#' + h.toString());
  }

  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    const ll = (h.get('ll') || '').split(',').map(Number);
    const s = +h.get('s');
    if (SIDES.includes(s)) state.side = s;
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

  const sizeBtns = [...document.querySelectorAll('#sizes button')];
  function paintSizes() { for (const b of sizeBtns) b.setAttribute('aria-pressed', +b.dataset.side === state.side); }
  for (const b of sizeBtns) {
    b.addEventListener('click', () => {
      state.side = +b.dataset.side;
      paintSizes();
      if (state.lat != null) { writeHash(); show(); }
    });
  }

  for (const b of document.querySelectorAll('#nudge button[data-dx]')) {
    b.addEventListener('click', () => {
      if (state.lat == null) return;
      const sp = proj.toStatePlane(state.lon, state.lat);
      const step = state.side / 4;
      const ll = proj.toLonLat(sp.x + step * +b.dataset.dx, sp.y + step * +b.dataset.dy);
      go(ll.lat, ll.lon, `${ll.lat.toFixed(5)}, ${ll.lon.toFixed(5)}`);
    });
  }

  $('#cross-toggle').addEventListener('click', (ev) => {
    state.cross = !state.cross;
    ev.currentTarget.setAttribute('aria-pressed', state.cross);
    for (const rec of cards.values()) rec.cross.hidden = !state.cross;
  });

  /* ---------- save every year as one image ---------- */
  function contactSheet() {
    const ready = sources.YEARS.filter((y) => cards.get(y).ready);
    if (!ready.length) return null;
    const cols = 4, gap = 16, label = 34, footer = 40;
    const rows = Math.ceil(sources.YEARS.length / cols);
    const sheet = document.createElement('canvas');
    sheet.width = cols * PX + (cols + 1) * gap;
    sheet.height = rows * (PX + label) + (rows + 1) * gap + footer;
    const ctx = sheet.getContext('2d');
    ctx.fillStyle = '#0f1418'; ctx.fillRect(0, 0, sheet.width, sheet.height);
    ctx.textBaseline = 'middle';
    sources.YEARS.forEach((year, i) => {
      const rec = cards.get(year);
      const x = gap + (i % cols) * (PX + gap), y = gap + Math.floor(i / cols) * (PX + label + gap);
      ctx.fillStyle = '#e6e9ec'; ctx.font = '600 22px system-ui, sans-serif';
      ctx.fillText(String(year), x, y + label / 2);
      ctx.fillStyle = '#98a3ad'; ctx.font = '14px system-ui, sans-serif';
      const meta = rec.meta.textContent;
      if (meta) ctx.fillText(meta, x + 70, y + label / 2);
      if (rec.ready) ctx.drawImage(rec.canvas, x, y + label);
      else {
        ctx.fillStyle = '#171e25'; ctx.fillRect(x, y + label, PX, PX);
        ctx.fillStyle = '#98a3ad'; ctx.textAlign = 'center';
        ctx.fillText(rec.msg.textContent.slice(0, 60), x + PX / 2, y + label + PX / 2);
        ctx.textAlign = 'left';
      }
    });
    ctx.fillStyle = '#98a3ad'; ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(`${state.label} · ${state.side} ft across · DRAPP imagery, DRCOG Regional Data Catalog (CC BY 3.0) · drapp.myjimmycloud.com`, gap, sheet.height - footer / 2);
    return sheet;
  }
  $('#save-all').addEventListener('click', () => {
    const sheet = contactSheet();
    if (!sheet) return say('Nothing rendered yet to save.', 'warn');
    const a = document.createElement('a');
    a.href = sheet.toDataURL('image/png');
    a.download = `drapp-all-years-${state.lat.toFixed(5)}_${state.lon.toFixed(5)}-${state.side}ft.png`;
    document.body.appendChild(a); a.click(); a.remove();
  });
  $('#clear-cache').addEventListener('click', async (ev) => {
    ev.preventDefault();
    await cache.clear();
    updateCacheNote();
    say('Cache cleared. The next address will be fetched fresh.');
  });

  /* ---------- lightbox ---------- */
  const dlg = $('#lightbox');
  const big = $('#big');
  let lbYear = null;
  function openLightbox(year) {
    lbYear = year;
    const rec = cards.get(year);
    big.getContext('2d').clearRect(0, 0, PX, PX);
    big.getContext('2d').drawImage(rec.canvas, 0, 0);
    $('#lb-title').textContent = `${year} · ${rec.meta.textContent || ''}`.replace(/ · $/, '');
    $('#lb-sub').textContent = `${state.label} · ${state.side} ft across · ${rec.src.textContent}`;
    $('#lb-save').href = big.toDataURL('image/png');
    $('#lb-save').download = `drapp-${year}-${state.lat.toFixed(5)}_${state.lon.toFixed(5)}-${state.side}ft.png`;
    $('#lb-cross').hidden = !state.cross;
    if (!dlg.open) dlg.showModal();
  }
  function stepLightbox(dir) {
    const ready = sources.YEARS.filter((y) => cards.get(y).ready);
    if (!ready.length) return;
    let i = ready.indexOf(lbYear);
    i = (i + dir + ready.length) % ready.length;
    openLightbox(ready[i]);
  }
  $('#lb-prev').addEventListener('click', () => stepLightbox(-1));
  $('#lb-next').addEventListener('click', () => stepLightbox(1));
  $('#lb-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });
  dlg.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowLeft') stepLightbox(-1);
    if (ev.key === 'ArrowRight') stepLightbox(1);
  });

  /* ---------- boot ---------- */
  for (const y of sources.YEARS) cards.set(y, makeCard(y));
  for (const rec of cards.values()) rec.cross.hidden = !state.cross;
  const h = readHash();
  paintSizes();
  if (h === true) { input.value = state.label; show(); }
  else if (h === 'geocode') form.requestSubmit();
  else say('Type an address in the Denver region to see it in every DRAPP year.');
  updateCacheNote();

  DRAPP.app = { state, show, cards, contactSheet };
})();
