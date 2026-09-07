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

console.log(failures ? `\n${failures} problem(s)` : '\nall sources answering');
process.exit(failures ? 1 : 0);
