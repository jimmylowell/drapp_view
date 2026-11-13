#!/usr/bin/env node
/* Bake DRCOG's tile index into the site.

   DRCOG publishes one tile-index layer per DRAPP year
   (gis.drcog.org/server/rest/services/RDC/TIFF_{YEAR}_INDEX/MapServer/0):
   each tile's footprint, flight date, resolution and download links. The page
   needs it to know which archive file is under the view. Asked live it is one
   query per view per year, and when that server stalls (it did for an hour on
   2026-11-12, while the archive itself was fine) no older year can load.

   So the index is fetched here, once per year, and written to
   data/index/{year}.json — a few thousand rows of name, box, date and link.
   The page reads that file and only falls back to the live query if it is
   missing. Nothing is derived: every value is the index's own field.

   Run: node scripts/bake_index.mjs [year ...]        (Node 18+, no dependencies) */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'data', 'index');
const LAYER = (y) => `https://gis.drcog.org/server/rest/services/RDC/TIFF_${y}_INDEX/MapServer/0`;
const YEARS = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [2004, 2006, 2010, 2012, 2014, 2016];   // the years the page reads out of the archive
const PAGE = 1000;

async function getJson(url, tries = 4) {
  for (let n = 1; ; n++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (d.error) throw new Error(d.error.message || 'server error');
      return d;
    } catch (e) {
      if (n >= tries) throw e;
      await new Promise((res) => setTimeout(res, 3000 * n));
    }
  }
}

/* Field names carry table prefixes in some years ("DBO.TIFF_2022_INDEX.area"). */
function pick(a, suffix) {
  for (const k of Object.keys(a)) {
    if (k.toLowerCase().endsWith(suffix) && a[k] != null && String(a[k]).trim() !== '') return String(a[k]).trim();
  }
  return '';
}

async function bake(year) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const q = new URLSearchParams({
      where: '1=1', outFields: '*', returnGeometry: 'true', outSR: '2232', f: 'json',
      orderByFields: 'OBJECTID', resultOffset: String(offset), resultRecordCount: String(PAGE),
    });
    const d = await getJson(`${LAYER(year)}/query?${q}`);
    const feats = d.features || [];
    for (const f of feats) {
      const a = f.attributes || {};
      let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
      for (const ring of (f.geometry && f.geometry.rings) || []) {
        for (const [x, y] of ring) { xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
      }
      if (!Number.isFinite(xmin)) continue;
      const tif = pick(a, 'tif_link'), jp2 = pick(a, 'jp2_link'), sid = pick(a, 'sid_link');
      const image = tif || jp2 || sid;
      const world = tif ? pick(a, 'tfw_link') : jp2 ? pick(a, 'j2w_link') : sid ? pick(a, 'sdw_link') : '';
      rows.push({
        tile: pick(a, 'tile') || pick(a, 'drcog_id'), box: [xmin, ymin, xmax, ymax].map((v) => Math.round(v * 100) / 100),
        date: pick(a, 'photo_date'), res: pick(a, 'resolution'), kind: tif ? 'tif' : jp2 ? 'jp2' : sid ? 'sid' : '', image, world,
      });
    }
    process.stderr.write(`  ${year}: ${rows.length} tiles\r`);
    if (feats.length < PAGE && !d.exceededTransferLimit) break;
  }
  /* Kept small without changing a value: links share one folder per year
     (`base`); a file named after its tile with the year's usual extension is
     written as '' (`ext` says which); dates and resolutions repeat, so a row
     holds their position in `dates` and `resolutions`. */
  const dir = (u) => u.slice(0, u.lastIndexOf('/') + 1);
  const bases = [...new Set(rows.filter((r) => r.image).map((r) => dir(r.image)))];
  const base = bases.length === 1 ? bases[0] : '';
  const extOf = (u) => u.slice(u.lastIndexOf('.') + 1);
  const withFile = rows.find((r) => r.image);
  const ext = withFile ? { image: extOf(withFile.image), world: withFile.world ? extOf(withFile.world) : '' } : { image: '', world: '' };
  const short = (u, tile, e) => (!u ? null : base && u === `${base}${tile}.${e}` ? '' : base && u.startsWith(base) ? u.slice(base.length) : u);
  const dates = [...new Set(rows.map((r) => r.date))], resolutions = [...new Set(rows.map((r) => r.res))];
  const out = {
    year, source: LAYER(year), retrieved: new Date().toISOString().slice(0, 10), crs: 'EPSG:2232', base, ext, dates, resolutions,
    fields: ['tile', 'xmin', 'ymin', 'xmax', 'ymax', 'photo_date (position in dates)', 'resolution (position in resolutions)', 'kind', 'image', 'world'],
    tiles: rows.map((r) => [r.tile, ...r.box, dates.indexOf(r.date), resolutions.indexOf(r.res), r.kind, short(r.image, r.tile, ext.image), short(r.world, r.tile, ext.world)]),
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${year}.json`), JSON.stringify(out) + '\n');
  console.log(`${year}: ${rows.length} tiles, ${rows.filter((r) => r.image).length} with a file, base ${base || '(mixed)'}`);
}

let failed = 0;
for (const y of YEARS) {
  try { await bake(y); } catch (e) { failed++; console.error(`${y}: ${e.message}`); }
}
process.exit(failed ? 1 : 0);
