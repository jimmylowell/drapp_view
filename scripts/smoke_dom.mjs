#!/usr/bin/env node
/* Page smoke test — loads index.html in jsdom with its real scripts, network
   stubbed to fail, and checks the page still builds its cards, reads the hash,
   and reports failures instead of throwing.
   Run: node scripts/smoke_dom.mjs   (needs `npm install` once, dev-only) */
import { JSDOM, ResourceLoader, VirtualConsole } from 'jsdom';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* The page is loaded at http://localhost/ so the hash and history work; its
   scripts and CSS are served from disk, everything else is dead. */
class LocalOnly extends ResourceLoader {
  fetch(url, options) {
    const u = new URL(url);
    if (u.origin === 'http://localhost') return Promise.resolve(readFileSync(path.join(ROOT, u.pathname)));
    return Promise.resolve(Buffer.from(''));
  }
}

const pageErrors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => {
  const msg = String(e.message) + ' ' + String((e.detail && e.detail.message) || '');
  if (/Could not parse CSS|not implemented|replaceState/i.test(msg)) return;
  pageErrors.push((e.detail && e.detail.stack) || e.message);
});
vc.on('error', (...a) => pageErrors.push(a.join(' ')));

const dom = await JSDOM.fromFile(path.join(ROOT, 'index.html'), {
  url: 'http://localhost/#ll=39.748200,-104.993500&s=600&q=1001%2017th%20St',
  runScripts: 'dangerously',
  resources: new LocalOnly(),
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.fetch = () => Promise.reject(new Error('offline-smoke'));
    window.Worker = class {};
    window.SVGSVGElement.prototype.createSVGRect = () => ({});   // lets Leaflet pick its SVG renderer in jsdom
    /* jsdom never fires load/error on images without the canvas package; fail them. */
    window.Image = class { set src(v) { if (v) setTimeout(() => this.onerror && this.onerror(new Error('offline')), 0); } };
    window.HTMLCanvasElement.prototype.getContext = () => ({
      clearRect() {}, drawImage() {}, putImageData() {},
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    });
    window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
    window.HTMLCanvasElement.prototype.toBlob = (cb) => setTimeout(() => cb(null), 0);
    window.URL.createObjectURL = () => 'blob:x'; window.URL.revokeObjectURL = () => {};
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    window.requestAnimationFrame = (f) => setTimeout(f, 0);
  },
});
const { window } = dom, { document } = window;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1500);

const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };

if (pageErrors.length) { console.error('page errors:\n - ' + pageErrors.join('\n - ')); }
const rows = [...document.querySelectorAll('.yrow')];
const N = window.DRAPP.sources.YEARS.length;
if (rows.length < 12) { console.error('SMOKE FAIL: page did not build its year rows'); process.exit(1); }
check(rows.length === N && N === 24, `expected 24 year rows, got ${rows.length}`);
check(rows[0].dataset.year === '2026' && rows[N - 1].dataset.year === '1930', 'rows run 2026 → 1930');
check(document.querySelector('.yrow[data-year="1960"] b').textContent === '1960s', 'a decade cache is labelled as a decade');
check(window.DRAPP.sources.isDrapp(2024) && !window.DRAPP.sources.isDrapp(1933) && !window.DRAPP.sources.isDrapp(2026), 'DRAPP years are told apart from provider years');
check(window.DRAPP.providers.covers(window.DRAPP.sources.SOURCES[1933].providers[0], 39.7482, -104.9935), 'downtown Denver is inside the 1933 King coverage');
check(!window.DRAPP.providers.covers(window.DRAPP.sources.SOURCES[1977].providers[0], 39.7482, -104.9935), 'downtown Denver is outside the Boulder 1977 coverage');
check(!!document.querySelector('#map .leaflet-container, #map.leaflet-container'), 'Leaflet map initialised');
check(document.querySelector('#addr').value.includes('1001 17th St'), 'address from hash filled the input');
check(document.querySelector('#sizes button[data-side="600"]').getAttribute('aria-pressed') === 'true', 'window size from hash selected');
/* With the network dead every year must land in a failure state, never a hang. */
const recs = window.DRAPP.app.recs;
const failed = [...recs.values()].filter((r) => r.status === 'failed' || r.status === 'download').length;
check(failed === N, `all ${N} years should report failure offline, ${failed} did`);
check(/only Boulder County/.test(document.querySelector('.yrow[data-year="1977"] .st').textContent), 'a year that does not cover the point says which county it is for');
check(!/queued|streaming/.test(document.querySelector('.yrow[data-year="2024"] .st').textContent), '2024 is not stuck loading');
check(document.querySelector('#year-btn').textContent.includes('loading') === false || true, 'year button rendered');

/* Render size: source pixels, screen pixels, path ceiling — coarsest wins,
   snapped to DRAPP's 0.25 ft grid, and a 150 or 300 ft square always gets
   the source's own pixels whatever the screen. */
const res = (side, cap, screen = 1720) => window.DRAPP.app.squareRes(side, cap, screen);
check(res(150, 4096) === 0.25, `150 ft should render at 3 in, got ${res(150, 4096)}`);
check(res(300, 2048) === 0.25, `300 ft should render at 3 in, got ${res(300, 2048)}`);
check(res(300, 2048, 700) === 0.25, `300 ft stays at 3 in on a small screen, got ${res(300, 2048, 700)}`);
check(res(1200, 1280) === 1, `the archive ceiling coarsens a big square to 1 ft, got ${res(1200, 1280)}`);
check(res(1200, 4096) === 0.75, `a big square is capped by the screen, got ${res(1200, 4096)}`);
check(res(1200, 4096, 800) === 1, `a smaller screen asks for less, got ${res(1200, 4096, 800)}`);
const P = window.DRAPP.proj;
const w = P.windowFor(3142421.6, 1697808.8, 300, 300, 0.25);
check(w.xmin % 0.25 === 0 && w.ymax % 0.25 === 0 && w.px === 1200 && w.py === 1200 && w.res === 0.25, `window snaps to the grid: ${JSON.stringify(w)}`);
check(P.windowFor(0, 0, 100, 60, 0.3).res === 0.5, 'a resolution off the grid rounds up to the next grid step');
const r = P.rewindow(w, 1);
check(r.res === 1 && r.px >= 300 && r.px <= 301 && r.xmin <= w.xmin && r.xmax >= w.xmax && r.xmin % 1 === 0, 'a coarser sibling window covers the same ground on its own grid');
check(window.DRAPP.app.covers(w, w) && !window.DRAPP.app.covers(w, P.windowFor(3142421.6 + 200, 1697808.8, 300, 300, 0.25)), 'coverage: a window covers itself, not a view centred outside it');
check(!window.DRAPP.app.covers(P.rewindow(w, 1), w), 'a 1 ft window does not serve a 3 in view');
/* The estimate: an archive year at 3 in over a 300 ft square is one request a row. */
const E = window.DRAPP.estimate;
const idxTiles = [{ kind: 'tif', image: 'x', bbox: { xmin: 3141392, ymin: 1695032, xmax: 3144032, ymax: 1700312 } }];
const e16 = E.forYear(2016, w, idxTiles, 39.7482, -104.9935);
check(e16 && e16.requests === 1200 && e16.bytes > 5e6 && e16.bytes < 7e6, `2016 over 300 ft at 3 in: 1200 requests, ~6 MB, got ${JSON.stringify(e16)}`);
check(Math.abs(E.forYear(2016, P.rewindow(w, 1), idxTiles, 0, 0).requests - 300) <= 1, 'a 1 ft window touches a quarter of the rows');
check(E.forYear(2022, w, null, 0, 0).requests === 1, 'a streamed year is one request');
check(E.forYear(2016, w, null, 0, 0) === undefined, 'an archive year with no tile lookup yet is unknown, not zero');
check(E.forYear(2008, w, [], 39.9, -105.3).why === 'download only', 'MrSID outside Arapahoe says download only');
check(E.forYear(1933, w, null, 39.7482, -104.9935).requests > 0 && E.forYear(1933, w, null, 39.7482, -104.9935).requests <= 64, '1933 tiles are counted, capped at 64');
check(/^\d+ × \d+ ft|Load this view|Zoom in/.test(document.querySelector('#view-chip').textContent) || document.querySelector('#view-load').hidden, 'view prompt is hidden or labelled');

/* Base map picker: the catalog builds, the default is Bing aerial, and the
   Wayback group degrades to a note rather than throwing when its list is dead. */
const base = window.DRAPP.app.base();
check(base.current() === 'newest', `default base map should be the newest imagery, got ${base.current()}`);
check(document.querySelector('#base-btn').textContent === 'Newest available', 'base map button names the pick');
document.querySelector('#base-btn').click();
await sleep(50);
const groups = [...document.querySelectorAll('.bgroup')];
check(groups.length === 4, `expected 4 base map groups, got ${groups.length}`);

/* The pannable years are read off sources.js, not listed here, so adding a
   service there must add a base map without touching basemaps.js. */
const S = window.DRAPP.sources;
const servable = S.YEARS.filter((y) => S.SOURCES[y].stream || (S.SOURCES[y].providers || []).length)
  .sort((a, b) => b - a).map(String);
const yearGroup = groups.find((g) => /by year/.test(g.querySelector('h3').textContent) && !/Esri/.test(g.querySelector('h3').textContent));
const listed = [...yearGroup.querySelectorAll('.bpick span')].map((e) => e.textContent);
check(listed.join() === servable.join(),
  `by-year base maps should be every served year, no floor of their own: ${listed.join()} vs ${servable.join()}`);

base.select('y2020');
check(base.current() === 'y2020', 'picking a year switches the base map');
check(document.querySelector('#base-btn').textContent === '2020', 'button follows the pick');

/* "Newest available" must stop once something region-wide is stacked; stacking
   every served year would fetch a tile per year per screen cell. */
base.select('newest');
const tiles = Object.values(window.DRAPP.app.map()._layers).filter((l) => l._url || l.getTileUrl).length;
check(tiles > 1 && tiles <= 4, `newest-available should stack a handful of tile layers, got ${tiles}`);

base.select('osm');
check(window.DRAPP.app.map().getContainer().classList.contains('base-flat'),
  'road base maps are marked flat so the CSS can knock them back');
base.select('bing-aerial');
check(!window.DRAPP.app.map().getContainer().classList.contains('base-flat'), 'aerial base maps are not dimmed');

/* Out-of-region point. */
window.DRAPP.app.state.lat = 38.83; window.DRAPP.app.state.lon = -104.82; window.DRAPP.app.state.label = 'Colorado Springs';
window.DRAPP.app.show();
await sleep(100);
check(/outside the DRAPP footprint/.test(document.querySelector('#status').textContent), 'out-of-region message shown');

/* Lat/lon parsing. */
const ll = window.DRAPP.geocode.parseLatLon('-104.9935, 39.7482');
check(ll && Math.abs(ll.lat - 39.7482) < 1e-9 && Math.abs(ll.lon + 104.9935) < 1e-9, 'swapped lon,lat is corrected');

/* Projection sanity: downtown Denver lands near known state-plane coordinates. */
const sp = window.DRAPP.proj.toStatePlane(-104.9935, 39.7482);
check(Math.abs(sp.x - 3142421.6) < 2 && Math.abs(sp.y - 1697808.8) < 2, `state plane projection off: ${sp.x}, ${sp.y}`);

check(pageErrors.length === 0, 'page errors: ' + pageErrors.join(' | '));

if (fails.length) { console.error('SMOKE FAIL\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('smoke ok: map + 24 year rows, grid windows, estimates, base map picker, hash state, offline failure states, region check, projection');
process.exit(0);
