/* DRCOG publishes one tile-index layer per year. Querying it with our window
   envelope returns the 1–4 tiles that touch it, each with download links. The
   link field names changed over the years (tif/tfw, jp2/j2w, sid/sdw), so this
   normalises them into {kind, image, world}. */
(function () {
  const { INDEX } = DRAPP.sources;

  async function tilesFor(year, win, signal) {
    const geometry = JSON.stringify({
      xmin: win.xmin, ymin: win.ymin, xmax: win.xmax, ymax: win.ymax,
      spatialReference: { wkid: 2232 },
    });
    const q = new URLSearchParams({
      geometry, geometryType: 'esriGeometryEnvelope', inSR: '2232', outSR: '2232',
      spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'true', f: 'json',
    });
    const url = INDEX.replace('{Y}', year) + '/query?' + q;
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error('tile index HTTP ' + r.status);
    const d = await r.json();
    if (d.error) throw new Error('tile index: ' + (d.error.message || 'error'));
    return (d.features || []).map((f) => normalize(year, f));
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

  DRAPP.tileindex = { tilesFor, prettyDate };
})();
