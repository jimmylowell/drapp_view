/* Which archive file is under a window, for a DRAPP year.

   DRCOG publishes one tile-index layer per year: footprint, flight date,
   resolution, download links. scripts/bake_index.mjs copies each into
   data/index/{year}.json, and that file is what the page reads: one fetch per
   year, then every lookup is a loop over a few thousand boxes. The live query
   is only the fallback for a year with no baked file — it is one request per
   view, and on 2026-11-12 DRCOG's server left every query hanging for an hour
   while the archive itself was fine.

   The link field names changed over the years (tif/tfw, jp2/j2w, sid/sdw);
   both paths normalise them into {kind, image, world}. */
(function () {
  const { INDEX } = DRAPP.sources;
  const LIVE_TIMEOUT = 12000;

  /* ---------- baked ---------- */
  const baked = new Map();           // year → Promise<rows | null>
  function loadBaked(year) {
    if (!baked.has(year)) {
      baked.set(year, fetch(`data/index/${year}.json`).then((r) => (r.ok ? r.json() : null)).then((d) => {
        if (!d || !Array.isArray(d.tiles)) return null;
        /* '' is "named after the tile, the year's usual extension"; null is no file. */
        const full = (u, tile, ext) => (u == null ? '' : u === '' ? `${d.base}${tile}.${ext}` : /^https?:/.test(u) ? u : d.base + u);
        return d.tiles.map(([tile, xmin, ymin, xmax, ymax, date, res, kind, image, world]) => ({
          year, tile, resolution: d.resolutions[res] || '', photoDate: d.dates[date] || '', kind: kind || null,
          image: full(image, tile, d.ext.image), world: full(world, tile, d.ext.world), bbox: { xmin, ymin, xmax, ymax },
        }));
      }).catch(() => null));
    }
    return baked.get(year);
  }

  /* ---------- live ---------- */
  async function query(year, win, signal) {
    const geometry = JSON.stringify({
      xmin: win.xmin, ymin: win.ymin, xmax: win.xmax, ymax: win.ymax,
      spatialReference: { wkid: 2232 },
    });
    const q = new URLSearchParams({
      geometry, geometryType: 'esriGeometryEnvelope', inSR: '2232', outSR: '2232',
      spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'true', f: 'json',
    });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), LIVE_TIMEOUT);
    if (signal) signal.addEventListener('abort', () => ctl.abort(), { once: true });
    try {
      const r = await fetch(INDEX.replace('{Y}', year) + '/query?' + q, { signal: ctl.signal });
      if (!r.ok) throw new Error('tile index HTTP ' + r.status);
      const d = await r.json();
      if (d.error) throw new Error('tile index: ' + (d.error.message || 'error'));
      return (d.features || []).map((f) => normalize(year, f));
    } catch (e) {
      if (e.name === 'AbortError' && !(signal && signal.aborted)) throw new Error('DRCOG\'s tile index did not answer');
      throw e;
    } finally { clearTimeout(timer); }
  }

  async function tilesFor(year, win, signal) {
    const rows = await loadBaked(year);
    if (rows) {
      return rows.filter((t) => t.bbox.xmin < win.xmax && t.bbox.xmax > win.xmin && t.bbox.ymin < win.ymax && t.bbox.ymax > win.ymin);
    }
    return query(year, win, signal);
  }

  /* Field names carry table prefixes in some years ("DBO.TIFF_2022_INDEX.area"),
     so match on the suffix. */
  function pick(attrs, suffix) {
    for (const k of Object.keys(attrs)) {
      if (k.toLowerCase().endsWith(suffix) && attrs[k] != null && String(attrs[k]).trim() !== '') {
        return String(attrs[k]).trim();
      }
    }
    return '';
  }

  function normalize(year, f) {
    const a = f.attributes || {};
    let bbox = null;
    for (const ring of (f.geometry && f.geometry.rings) || []) {
      for (const [x, y] of ring) {
        if (!bbox) bbox = { xmin: x, xmax: x, ymin: y, ymax: y };
        else {
          bbox.xmin = Math.min(bbox.xmin, x); bbox.xmax = Math.max(bbox.xmax, x);
          bbox.ymin = Math.min(bbox.ymin, y); bbox.ymax = Math.max(bbox.ymax, y);
        }
      }
    }
    const tif = pick(a, 'tif_link'), jp2 = pick(a, 'jp2_link'), sid = pick(a, 'sid_link');
    let kind = null, image = '', world = '';
    if (tif) { kind = 'tif'; image = tif; world = pick(a, 'tfw_link'); }
    else if (jp2) { kind = 'jp2'; image = jp2; world = pick(a, 'j2w_link'); }
    else if (sid) { kind = 'sid'; image = sid; world = pick(a, 'sdw_link'); }
    return {
      year,
      tile: pick(a, 'tile') || pick(a, 'drcog_id') || '',
      resolution: pick(a, 'resolution'),
      photoDate: pick(a, 'photo_date'),
      kind, image, world, bbox,
    };
  }

  /* "20220315 20220321" / "4/12/2006" / "" → something readable. */
  function prettyDate(s) {
    if (!s) return '';
    const parts = s.split(/\s+/).map((p) => {
      const m = p.match(/^(\d{4})(\d{2})(\d{2})$/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      return p;
    });
    const uniq = [...new Set(parts)];
    return uniq.length > 2 ? `${uniq[0]} … ${uniq[uniq.length - 1]}` : uniq.join(', ');
  }

  DRAPP.tileindex = { tilesFor, prettyDate, loadBaked };
})();
