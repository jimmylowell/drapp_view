#!/usr/bin/env node
/* Dev tool: render one year's window from the archive tiles in Node, no browser,
   and write it as a PPM next to the streamed version of the same window for
   comparison. Exercises tiffwindow.js exactly as the page does.
   Run: node scripts/render_node.mjs <year> <lat> <lon> [sideFt] [outdir] */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [year, lat, lon, side = '300', outdir = '.'] = process.argv.slice(2);
if (!year || !lat || !lon) { console.error('usage: render_node.mjs <year> <lat> <lon> [sideFt] [outdir]'); process.exit(2); }

globalThis.window = globalThis; globalThis.self = globalThis; globalThis.DRAPP = {};
if (typeof Worker === "undefined") globalThis.Worker = class {};   // geotiff.js touches it at load; unused without a pool
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.cancelAnimationFrame = clearTimeout;
for (const f of ['js/vendor/proj4.js', 'js/vendor/geotiff.js', 'js/proj.js', 'js/sources.js', 'js/tileindex.js', 'js/tiffwindow.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const { proj, tileindex, tiffwindow, sources } = DRAPP;

let img = null;
const ctx = {
  createImageData: (w, h) => (img = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  putImageData: () => {},
};
const canvas = { getContext: () => ctx };

const PX = 480;
const sp = proj.toStatePlane(+lon, +lat);
const win = proj.windowFor(sp.x, sp.y, +side, PX);
console.log(`window ${side} ft at state plane ${sp.x.toFixed(1)}, ${sp.y.toFixed(1)}`);

const t0 = Date.now();
const tiles = await tileindex.tilesFor(+year, win);
console.log(`${tiles.length} tile(s):`, tiles.map((t) => `${t.tile} ${t.kind}`).join(', '));
let last = -1;
const out = await tiffwindow.render(tiles, win, canvas, new AbortController().signal, (f, note) => {
  const pct = Math.floor(f * 10);
  if (pct !== last) { last = pct; process.stdout.write(`\r  ${Math.round(f * 100)}% ${note}          `); }
});
console.log(`\nrendered via ${out.mode} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

function ppm(file, data) {
  const rgb = Buffer.alloc(PX * PX * 3);
  for (let i = 0, o = 0; i < data.length; i += 4, o += 3) { rgb[o] = data[i]; rgb[o + 1] = data[i + 1]; rgb[o + 2] = data[i + 2]; }
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`P6\n${PX} ${PX}\n255\n`), rgb]));
}
fs.mkdirSync(outdir, { recursive: true });
const base = path.join(outdir, `${year}_${side}ft`);
ppm(base + '_archive.ppm', img.data);
console.log('wrote', base + '_archive.ppm');

const stream = sources.SOURCES[year] && sources.SOURCES[year].stream;
if (stream) {
  const url = `${stream}/exportImage?bbox=${win.xmin},${win.ymin},${win.xmax},${win.ymax}&bboxSR=2232&imageSR=2232&size=${PX},${PX}&format=jpg&f=image`;
  const r = await fetch(url);
  fs.writeFileSync(base + '_stream.jpg', Buffer.from(await r.arrayBuffer()));
  console.log('wrote', base + '_stream.jpg');
}
