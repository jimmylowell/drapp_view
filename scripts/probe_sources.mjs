#!/usr/bin/env node
/* Health check for every upstream this site leans on. Run: node scripts/probe_sources.mjs
   Exits non-zero if anything that used to work stops answering. No dependencies. */

const POINTS = [
  { name: 'downtown Denver', lon: -104.9935, lat: 39.7482 },
  { name: 'Golden (Jeffco)', lon: -105.2220, lat: 39.7548 },
  { name: 'Castle Rock (Douglas)', lon: -104.8600, lat: 39.3727 },
];
const SANBORN = 'https://drcog-data.sanborn.com/arcgis/rest/services/';
const STREAM = {
  2024: SANBORN + 'DRCOG_2024/DRCOG_Final_Ortho_2024/ImageServer',
  2022: SANBORN + 'DRCOG_2022/Mosaics_2022/ImageServer',
  2020: SANBORN + 'DRCOG_2020/Orthos_3in_6in_12in/ImageServer',
  2018: SANBORN + 'DRCOG_2018/Orthos_3in_6in_12in/ImageServer',
};
const YEARS = [2002, 2004, 2006, 2008, 2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024];
const INDEX = (y) => `https://gis.drcog.org/server/rest/services/RDC/TIFF_${y}_INDEX/MapServer/0/query`;

let failures = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m) => { failures++; console.log('  FAIL ' + m); };

async function timed(fn) { const t = Date.now(); const r = await fn(); return [r, Date.now() - t]; }

for (const p of POINTS) {
  console.log(`\n${p.name} (${p.lat}, ${p.lon})`);
  for (const y of YEARS) {
    const q = new URLSearchParams({
      geometry: `${p.lon},${p.lat}`, geometryType: 'esriGeometryPoint', inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'false', f: 'json',
    });
    try {
      const [d, ms] = await timed(async () => (await fetch(INDEX(y) + '?' + q)).json());
      if (d.error) throw new Error(d.error.message);
      const f = (d.features || [])[0];
      if (!f) { bad(`${y} index: no tile at this point`); continue; }
      const a = f.attributes;
      const link = Object.entries(a).find(([k, v]) => /(_link)$/.test(k) && v && !/(tfw|j2w|sdw)_link$/.test(k));
      if (link) {
        const h = await fetch(link[1], { headers: { Range: 'bytes=0-15' } });
        const size = (h.headers.get('content-range') || '').split('/')[1];
        if (h.status === 206) ok(`${y} index ${ms}ms → ${link[1].split('/').pop()} (${(size / 1e6).toFixed(0)} MB, ranges ok)`);
        else bad(`${y} archive ${link[1]} HTTP ${h.status}`);
      } else {
        ok(`${y} index ${ms}ms → tile ${a.tile || ''} (no download link published)`);
      }
    } catch (e) { bad(`${y} index: ${e.message}`); }
  }
  for (const [y, svc] of Object.entries(STREAM)) {
    const url = `${svc}/exportImage?bbox=${p.lon - 0.0005},${p.lat - 0.0004},${p.lon + 0.0005},${p.lat + 0.0004}&bboxSR=4326&imageSR=3857&size=200,160&format=jpg&f=image`;
    try {
      const [r, ms] = await timed(() => fetch(url, { headers: { Origin: 'https://drapp.myjimmycloud.com' } }));
      const buf = new Uint8Array(await r.arrayBuffer());
      const cors = r.headers.get('access-control-allow-origin');
      if (r.ok && buf.length > 3000 && cors) ok(`${y} stream ${ms}ms, ${buf.length} bytes, CORS ${cors}`);
      else bad(`${y} stream HTTP ${r.status}, ${buf.length} bytes, CORS ${cors}`);
    } catch (e) { bad(`${y} stream: ${e.message}`); }
  }
}

/* Base maps. None of these are documented public APIs either, so they get the same
   treatment: one real tile over downtown Denver, plus the Wayback release list. */
console.log('\nbase maps');
const BASE = [
  ['Bing aerial', 'https://ecn.t0.tiles.virtualearth.net/tiles/a0230102303011.jpeg?g=1'],
  ['Bing road', 'https://ecn.t0.tiles.virtualearth.net/tiles/r0230102303011.png?g=1'],
  ['Esri world imagery', 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/14/6222/3413'],
];
for (const [name, url] of BASE) {
  try {
    const [r, ms] = await timed(() => fetch(url));
    const n = (await r.arrayBuffer()).byteLength;
    if (r.ok && n > 1000) ok(`${name} ${ms}ms, ${n} bytes`);
    else bad(`${name} HTTP ${r.status}, ${n} bytes`);
  } catch (e) { bad(`${name}: ${e.message}`); }
}
try {
  const [cfg, ms] = await timed(async () => (await fetch('https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json')).json());
  const rels = Object.keys(cfg).length;
  const newest = Object.values(cfg).map((v) => v.itemTitle).sort().pop();
  if (rels > 50) ok(`Esri Wayback list ${ms}ms, ${rels} releases, newest ${newest}`);
  else bad(`Esri Wayback list: only ${rels} releases`);
} catch (e) { bad(`Esri Wayback list: ${e.message}`); }

/* One whole-region DRAPP tile: the same service the square uses, but a Mercator
   tile box rather than a state-plane window. */
const T = { xmin: -11689361.8616, ymin: 4816144.2782, xmax: -11686915.8767, ymax: 4818590.2631 };
for (const [y, svc] of Object.entries(STREAM)) {
  const url = `${svc}/exportImage?bbox=${T.xmin},${T.ymin},${T.xmax},${T.ymax}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&f=image`;
  try {
    const [r, ms] = await timed(() => fetch(url));
    const n = (await r.arrayBuffer()).byteLength;
    if (r.ok && n > 3000) ok(`DRAPP ${y} region-wide tile ${ms}ms, ${n} bytes`);
    else bad(`DRAPP ${y} region-wide tile HTTP ${r.status}, ${n} bytes`);
  } catch (e) { bad(`DRAPP ${y} region-wide tile: ${e.message}`); }
}

/* Other agencies' services, one state-plane export each at a point they cover.
   These are what carry the page past 2002 (and 2024). A flat answer means the
   service is up but has no pixels there, which is also worth knowing. */
console.log('\nother agencies');
const SP = (x, y, h = 150) => `${x - h},${y - h},${x + h},${y + h}`;
const OTHERS = [
  ['Arapahoe 2026', `https://gis.arapahoegov.com/arcgis/rest/services/Aerials/MapServer/export?bbox=${SP(3187911, 1691254)}&bboxSR=2232&imageSR=2232&size=256,256&layers=show:0&format=jpg&f=image`],
  ['Arapahoe 1998', `https://gis.arapahoegov.com/arcgis/rest/services/Aerials/MapServer/export?bbox=${SP(3187911, 1691254)}&bboxSR=2232&imageSR=2232&size=256,256&layers=show:14&format=jpg&f=image`],
  ['Boulder 1977', `https://maps.bouldercounty.org/arcgis/rest/services/RASTER/AERIAL1977_1FT/MapServer/export?bbox=${SP(3064287, 1794685)}&bboxSR=2232&imageSR=2232&size=256,256&format=jpg&f=image`],
  ['Boulder 2000', `https://maps.bouldercounty.org/arcgis/rest/services/RASTER/color2000/MapServer/export?bbox=${SP(3064287, 1794685)}&bboxSR=2232&imageSR=2232&size=256,256&format=jpg&f=image`],
  ['DPL 1933 King tile', 'https://tiles.arcgis.com/tiles/44C95LOqZjbh8Row/arcgis/rest/services/Denver_1933_Aerial/MapServer/tile/17/49740/27309'],
  ['CDOT Golden 1930 tile', 'https://tiles.arcgis.com/tiles/yzB9WM8W0BO3Ql7d/arcgis/rest/services/Golden_1930_Aerial/MapServer/tile/17/49743/27232'],
  ['CDOT Englewood 1953 tile', 'https://tiles.arcgis.com/tiles/yzB9WM8W0BO3Ql7d/arcgis/rest/services/Englewood_and_Littleton_1953_Aerial/MapServer/tile/17/49810/27317'],
  ['SMFR 1960s tile', 'https://tiles.arcgis.com/tiles/sszu6VPfua0T2iye/arcgis/rest/services/HIstorical_Aerial_Imagery___1960_69_WTL1/MapServer/tile/16/24910/13676'],
];
for (const [name, url] of OTHERS) {
  try {
    const [r, ms] = await timed(() => fetch(url, { headers: { Origin: 'https://drapp.myjimmycloud.com' } }));
    const n = (await r.arrayBuffer()).byteLength;
    const cors = r.headers.get('access-control-allow-origin');
    if (r.ok && n > 3000 && cors) ok(`${name} ${ms}ms, ${n} bytes, CORS ${cors}`);
    else bad(`${name} HTTP ${r.status}, ${n} bytes, CORS ${cors}`);
  } catch (e) { bad(`${name}: ${e.message}`); }
}

console.log(failures ? `\n${failures} problem(s)` : '\nall sources answering');
process.exit(failures ? 1 : 0);
