/* Read just our window out of a huge GeoTIFF on S3 without downloading it.

   geotiff.js opens the file with range requests and parses the directory. Then:
   - Uncompressed, pixel-interleaved, stripped files (2006, 2012–2022: one row
     per strip, 42 KB a row, no overviews) are read here by hand: for every
     source row the window touches, one Range request for only the byte span of
     the columns we need. ~2 KB a row instead of 42 KB, and each row is painted
     as it lands.
   - Anything tiled or compressed (2004, 2010) goes through geotiff.js, which
     fetches just the tiles under the window, using an overview level when the
     window is coarser than full resolution. */
(function () {
  const CONCURRENCY = 6;

  function abortError() { return new DOMException('aborted', 'AbortError'); }

  async function fetchRange(url, start, end, signal, attempt = 0) {
    try {
      /* no-store: Chrome serialises concurrent requests for one URL through its
         HTTP cache lock, which turns six parallel row reads into one at a time. */
      const r = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, cache: 'no-store', signal });
      if (r.status !== 206) {
        const e = new Error(r.status === 404 ? 'file is missing from DRCOG\'s archive (HTTP 404)' : 'range request got HTTP ' + r.status);
        e.permanent = r.status >= 400 && r.status < 500;
        throw e;
      }
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      if (e.name === 'AbortError' || e.permanent || attempt >= 2) throw e;
      await new Promise((res) => setTimeout(res, 300 * (attempt + 1)));
      return fetchRange(url, start, end, signal, attempt + 1);
    }
  }

  async function worldFile(url, signal) {
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error('world file HTTP ' + r.status);
    const v = (await r.text()).trim().split(/\s+/).map(Number);
    if (v.length < 6 || v.some(Number.isNaN)) throw new Error('bad world file');
    const [A, , , E, C, F] = v;                 // x-scale, y-scale (neg), centre of top-left px
    return { dx: Math.abs(A), dy: Math.abs(E), x0: C - A / 2, y0: F - E / 2 };
  }

  async function open(tile, signal) {
    await fetchRange(tile.image, 0, 0, signal);   // surfaces a 404 with a clear message before geotiff.js hides it
    const tiff = await GeoTIFF.fromUrl(tile.image, { allowFullFile: false, blockSize: 65536, cacheSize: 400 }, signal);
    const img = await tiff.getImage(0);
    const fd = img.fileDirectory;
    let geo;
    try {
      const o = img.getOrigin(), r = img.getResolution();
      geo = { x0: o[0], y0: o[1], dx: Math.abs(r[0]), dy: Math.abs(r[1]) };
    } catch (e) {
      if (!tile.world) throw new Error('tile has no georeference');
      geo = await worldFile(tile.world, signal);
    }
    const bps = fd.BitsPerSample;
    return {
      tiff, img, fd, url: tile.image, ...geo,
      W: img.getWidth(), H: img.getHeight(), spp: img.getSamplesPerPixel(),
      stripped: !fd.TileWidth,
      uncompressed: (fd.Compression || 1) === 1,
      chunky: (fd.PlanarConfiguration || 1) === 1,
      eightBit: !bps || (bps[0] || bps) === 8,
    };
  }

  /* Hand-rolled row reads for the simple layout. */
  async function renderStripped(t, win, imgData, signal, onRow) {
    const N = win.px, p = win.res, spp = t.spp;
    const cols = new Int32Array(N);
    let cmin = Infinity, cmax = -Infinity;
    for (let i = 0; i < N; i++) {
      const c = Math.floor((win.xmin + (i + 0.5) * p - t.x0) / t.dx);
      cols[i] = c >= 0 && c < t.W ? c : -1;
      if (cols[i] >= 0) { cmin = Math.min(cmin, c); cmax = Math.max(cmax, c); }
    }
    if (cmin === Infinity) return 0;

    const bySrc = new Map();                    // source row → output rows
    for (let j = 0; j < N; j++) {
      const r = Math.floor((t.y0 - (win.ymax - (j + 0.5) * p)) / t.dy);
      if (r < 0 || r >= t.H) continue;
      if (!bySrc.has(r)) bySrc.set(r, []);
      bySrc.get(r).push(j);
    }
    const queue = [...bySrc.keys()].sort((a, b) => a - b);
    const total = queue.length;
    const offs = t.fd.StripOffsets, rps = t.fd.RowsPerStrip || t.H;
    const rowBytes = t.W * spp;
    let done = 0;

    async function worker() {
      while (queue.length) {
        if (signal.aborted) throw abortError();
        const r = queue.shift();
        const strip = Math.floor(r / rps);
        const base = Number(offs[strip]) + (r - strip * rps) * rowBytes;
        const bytes = await fetchRange(t.url, base + cmin * spp, base + (cmax + 1) * spp - 1, signal);
        const d = imgData.data;
        for (const j of bySrc.get(r)) {
          let o = j * N * 4;
          for (let i = 0; i < N; i++, o += 4) {
            const c = cols[i];
            if (c < 0) continue;
            const k = (c - cmin) * spp;
            d[o] = bytes[k]; d[o + 1] = bytes[k + 1]; d[o + 2] = bytes[k + 2]; d[o + 3] = 255;
          }
        }
        done++;
        onRow(done / total);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return total;
  }

  /* geotiff.js path: pick the coarsest overview still at least as fine as the
     window, read the covering pixel block, nearest-neighbour into the canvas. */
  async function renderTiled(t, win, imgData, signal) {
    const count = await t.tiff.getImageCount();
    let best = t.img, dx = t.dx, dy = t.dy;
    for (let k = 1; k < count; k++) {
      const im = await t.tiff.getImage(k);
      const f = t.W / im.getWidth();
      if (t.dx * f <= win.res * 1.001 && t.dx * f > dx) { best = im; dx = t.dx * f; dy = t.dy * f; }
    }
    const W = best.getWidth(), H = best.getHeight();
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const c0 = clamp(Math.floor((win.xmin - t.x0) / dx), 0, W), c1 = clamp(Math.ceil((win.xmax - t.x0) / dx), 0, W);
    const r0 = clamp(Math.floor((t.y0 - win.ymax) / dy), 0, H), r1 = clamp(Math.ceil((t.y0 - win.ymin) / dy), 0, H);
    if (c1 <= c0 || r1 <= r0) return 0;
    const ras = await best.readRasters({ window: [c0, r0, c1, r1], interleave: true, samples: [0, 1, 2], signal });
    const w = c1 - c0, h = r1 - r0, N = win.px, p = win.res, d = imgData.data;
    for (let j = 0; j < N; j++) {
      const r = Math.floor((t.y0 - (win.ymax - (j + 0.5) * p)) / dy) - r0;
      if (r < 0 || r >= h) continue;
      for (let i = 0; i < N; i++) {
        const c = Math.floor((win.xmin + (i + 0.5) * p - t.x0) / dx) - c0;
        if (c < 0 || c >= w) continue;
        const k = (r * w + c) * 3, o = (j * N + i) * 4;
        d[o] = ras[k]; d[o + 1] = ras[k + 1]; d[o + 2] = ras[k + 2]; d[o + 3] = 255;
      }
    }
    return h;
  }

  /* Render every GeoTIFF tile touching the window into one canvas.
     onProgress(fraction, note) is called as rows land. */
  async function render(tiles, win, canvas, signal, onProgress) {
    const usable = tiles.filter((x) => x.kind === 'tif' && x.image);
    if (!usable.length) throw new Error('no GeoTIFF covers this spot');
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(win.px, win.px);
    let raf = 0;
    const paint = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; ctx.putImageData(imgData, 0, 0); });
    };
    let n = 0, mode = '';
    for (const tile of usable) {
      onProgress(n / usable.length, 'opening tile ' + tile.tile);
      const t = await open(tile, signal);
      if (t.stripped && t.uncompressed && t.chunky && t.eightBit) {
        mode = 'rows';
        await renderStripped(t, win, imgData, signal, (f) => {
          onProgress((n + f) / usable.length, `reading rows from ${tile.tile}`);
          paint();
        });
      } else {
        mode = 'tiles';
        onProgress((n + 0.1) / usable.length, `reading tiles from ${tile.tile}`);
        await renderTiled(t, win, imgData, signal);
        paint();
      }
      n++;
    }
    if (raf) cancelAnimationFrame(raf);
    ctx.putImageData(imgData, 0, 0);
    return { tiles: usable.length, mode };
  }

  DRAPP.tiffwindow = { render };
})();
