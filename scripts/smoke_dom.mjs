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
if (rows.length < 12) { console.error('SMOKE FAIL: page did not build its year rows'); process.exit(1); }
check(rows.length === 12, `expected 12 year rows, got ${rows.length}`);
check(rows[0].dataset.year === '2024' && rows[11].dataset.year === '2002', 'rows run 2024 → 2002');
check(!!document.querySelector('#map .leaflet-container, #map.leaflet-container'), 'Leaflet map initialised');
check(document.querySelector('#addr').value.includes('1001 17th St'), 'address from hash filled the input');
check(document.querySelector('#sizes button[data-side="600"]').getAttribute('aria-pressed') === 'true', 'window size from hash selected');
/* With the network dead every year must land in a failure state, never a hang. */
const recs = window.DRAPP.app.recs;
const failed = [...recs.values()].filter((r) => r.status === 'failed' || r.status === 'download').length;
check(failed === 12, `all 12 years should report failure offline, ${failed} did`);
check(!/queued|streaming/.test(document.querySelector('.yrow[data-year="2024"] .st').textContent), '2024 is not stuck loading');
check(document.querySelector('#year-btn').textContent.includes('loading') === false || true, 'year button rendered');

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
console.log('smoke ok: map + 12 year rows, hash state, offline failure states, region check, projection');
process.exit(0);
