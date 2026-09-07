/* Page logic: address → window → one card per DRAPP year. */
(function () {
  const { proj, sources, tileindex, imageserver, tiffwindow, geocode } = DRAPP;
  const PX = 480;
  const SIDES = [150, 300, 600, 1200];

  const state = { lat: null, lon: null, side: 300, label: '', cross: true };
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

    /* Tile lookups for every year, in parallel; they are tiny. */
    const tilesByYear = new Map();
    const lookups = sources.YEARS.map(async (year) => {
      const rec = cards.get(year);
      try {
        const tiles = await tileindex.tilesFor(year, win, signal);
        tilesByYear.set(year, tiles);
        fillTiles(rec, tiles);
      } catch (e) {
        if (e.name === 'AbortError') return;
        tilesByYear.set(year, []);
        rec.tiles.innerHTML = `<li class="dim">tile index unavailable (${e.message})</li>`;
      }
    });

    /* Streamed years, all at once. A failure with an archive copy joins the
       archive queue instead of giving up. */
    const fallbacks = [];
    const streamed = sources.YEARS.filter((y) => sources.SOURCES[y].stream).map(async (year) => {
      const rec = cards.get(year);
      setOverlay(rec, 'requesting from image service…', null);
      try {
        await imageserver.render(sources.SOURCES[year].stream, win, rec.canvas, signal);
        markDone(rec, sources.STREAM_LABEL);
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
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        markFailed(rec, 'could not read tile: ' + e.message);
      }
    }
    await Promise.all(lookups);
    if (signal.aborted) return;
    try {
      for (const year of sources.YEARS.filter((y) => !sources.SOURCES[y].stream).sort((a, b) => b - a)) {
        await fromArchive(year);
      }
      await Promise.all(streamed);
      for (const year of fallbacks.sort((a, b) => b - a)) await fromArchive(year);
    } catch (e) {
      if (e.name === 'AbortError') return;
      throw e;
    }
    if (!signal.aborted) say(`${state.label} — ${state.side} ft across. Done.`);
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

  DRAPP.app = { state, show, cards };
})();
