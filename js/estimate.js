/* What a window would cost before anything is fetched: requests, bytes and a
   guess at seconds, per year. This is what the "load this view" prompt shows,
   so the expensive path (one range request per source row, js/tiffwindow.js)
   is never entered without the user seeing the number first.

   The archive numbers come from the tile layouts in js/sources.js and the
   tiles the index returned for the window; the streamed years are one export
   whose bytes scale with the pixels. Seconds use a rate that starts at a
   measured default and follows what this browser actually achieved. */
(function () {
  const { sources, providers, xyz } = DRAPP;
  const BLOCK = 65536;                          // geotiff.js fetch block

  /* Defaults from measurement downtown: 1200 rows in 27 s over six connections
     to S3; a 1200² export at quality 95 is 560 KB and takes ~0.7 s. */
  const rate = { rowsPerSec: 45, bytesPerSec: 3e6 };
  function learn(requests, bytes, secs) {
    if (secs < 1 || requests < 50) return;
    rate.rowsPerSec = 0.5 * rate.rowsPerSec + 0.5 * (requests / secs);
    if (bytes > 1e6) rate.bytesPerSec = 0.5 * rate.bytesPerSec + 0.5 * (bytes / secs);
  }

  function intersect(a, b) {
    const xmin = Math.max(a.xmin, b.xmin), xmax = Math.min(a.xmax, b.xmax);
    const ymin = Math.max(a.ymin, b.ymin), ymax = Math.min(a.ymax, b.ymax);
    if (xmax <= xmin || ymax <= ymin) return null;
    return { w: xmax - xmin, h: ymax - ymin };
  }

  const one = (bytes, secs, how) => ({ requests: 1, bytes, secs, how });
  const exportSecs = (px, py) => 0.4 + (px * py) / 3.3e6;   // 512²→0.37 s, 2048²→1.3 s measured

  function archive(layout, win, tiles) {
    let requests = 0, bytes = 0;
    for (const t of tiles) {
      const ix = t.bbox ? intersect(win, t.bbox) : { w: win.w, h: win.h };
      if (!ix) continue;
      if (layout.kind === 'strips') {
        const rows = Math.ceil(ix.h / Math.max(win.res, layout.res));
        const cols = Math.ceil(ix.w / layout.res) + 1;
        requests += rows; bytes += rows * cols * layout.spp;
      } else {
        let f = 1;
        for (const k of layout.levels) if (layout.res * k <= win.res * 1.001) f = k;
        const blockFt = layout.block * layout.res * f;
        const across = Math.floor(ix.w / blockFt) + 2, down = Math.floor(ix.h / blockFt) + 2;
        const b = across * down * layout.bytesPerBlock;
        bytes += b; requests += down + Math.ceil(b / BLOCK) / 2;
      }
    }
    if (!requests) return null;
    requests = Math.round(requests);
    return { requests, bytes, secs: 0.8 + requests / rate.rowsPerSec + bytes / rate.bytesPerSec, how: layout.kind === 'strips' ? 'archive rows' : 'archive tiles' };
  }

  /* Cost of rendering `win` for `year`. `tiles` is the index result for the
     window (DRAPP years; null while it is still being looked up). Returns
     {requests, bytes, secs, how}, {why} when the year cannot render here, or
     undefined when it is not known yet. */
  function forYear(year, win, tiles, lat, lon) {
    const src = sources.SOURCES[year];
    if (src.stream) return one(win.px * win.py * 0.4, exportSecs(win.px, win.py), 'one export');
    if (sources.isDrapp(year) && src.archive === 'tif') {
      if (tiles === null || tiles === undefined) return undefined;
      const usable = tiles.filter((t) => t.kind === 'tif' && t.image);
      if (usable.length && src.layout) return archive(src.layout, win, usable) || { why: 'no archive tile here' };
      if (!usable.length) return { why: 'no archive tile here' };
    }
    const here = (src.providers || []).filter((p) => providers.covers(p, lat, lon));
    if (here.length) {
      const p = here[0];
      if (p.kind === 'map') return one(win.px * win.py * 0.25, exportSecs(win.px, win.py), p.credit);
      const n = xyz.plan(p, win).count;
      return { requests: n, bytes: n * 25000, secs: 0.5 + n / 12, how: `${p.credit}, ${n} tiles` };
    }
    if (sources.isDrapp(year) && src.archive && src.archive !== 'tif') return { why: 'download only' };
    return { why: 'not here' };
  }

  function sum(list) {
    const t = { requests: 0, bytes: 0, secs: 0, years: 0 };
    for (const e of list) if (e && e.requests) { t.requests += e.requests; t.bytes += e.bytes; t.secs += e.secs; t.years++; }
    return t;
  }

  const mb = (b) => b >= 1e6 ? `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
  const time = (s) => s < 3 ? `${Math.max(1, Math.round(s))} s` : s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`;
  const short = (e) => `≈${mb(e.bytes)} · ~${time(e.secs)}`;
  const long = (e) => `≈${mb(e.bytes)} · ${e.requests.toLocaleString()} request${e.requests === 1 ? '' : 's'} · ~${time(e.secs)}`;

  DRAPP.estimate = { forYear, sum, learn, rate, mb, time, short, long };
})();
