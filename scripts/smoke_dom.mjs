#!/usr/bin/env node
/* Page smoke test — loads index.html in jsdom with its real scripts, network
   stubbed to fail, and checks the page still builds its timeline, reads the
   hash, plans a read inside its budget, and says so instead of throwing.
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
  url: 'http://localhost/#ll=39.748200,-104.993500&z=19&y=2014-2024',
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
    window.AbortSignal = window.AbortSignal || AbortSignal;
  },
});
const { window } = dom, { document } = window;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1500);

const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };
if (pageErrors.length) { console.error('page errors:\n - ' + pageErrors.join('\n - ')); }
if (!window.DRAPP || !window.DRAPP.app) { console.error('SMOKE FAIL: the page did not start'); process.exit(1); }

const { app: A, sources: S, proj: P, estimate: E, tiles: T, providers: PR } = window.DRAPP;
const M = A.map();
check(!!document.querySelector('#map.leaflet-container'), 'Leaflet map initialised');
check(S.YEARS.length === 39 && S.YEARS[0] === 1930 && S.YEARS[38] === 2026, `39 years, 1930 to 2026: ${S.YEARS}`);
check(S.isDrapp(2024) && S.isDrapp(2026) && !S.isDrapp(1933), 'DRAPP years are told apart from provider years');
check(!!S.SOURCES[2026].stream && S.SOURCES[2026].interim, '2026 is DRCOG\'s interim mosaic');

/* The hash: place, zoom, and two years means compare is on. */
check(Math.abs(M.getCenter().lat - 39.7482) < 1e-6 && M.getZoom() === 19, 'the hash set the view');
check(A.state.sides.length === 2 && A.state.sides[0].year === 2014 && A.state.sides[1].year === 2024, 'two years in the hash open compare, older on the left');
check(!document.querySelector('#divider').hidden && document.querySelector('#tag-0 b').textContent === '2014', 'the divider and its year tags are up');
document.querySelector('#tag-1').click();
check(A.state.active === 1 && !document.querySelector('#years').hidden && document.querySelector('.opt.on b').textContent === '2024', 'a year tag drives its side and opens the year list for it');
document.querySelector('#tag-1').click();
check(document.querySelector('#years').hidden, 'the same tag again closes the list');
document.querySelector('#tag-0').click(); document.querySelector('#tag-0').click();
check(A.state.active === 0 && document.querySelector('#years').hidden, 'back on the left side, list closed');

/* The timeline shows the years that exist downtown, and no others. The years
   coarser than a metre a pixel (the list calls them blurry) wait behind one row at the foot. */
const listed = () => [...document.querySelectorAll('#years .opt b')].map((c) => c.textContent).reverse();
const chips = listed();
check(chips.join() === '1933,1963,1964,1971,1978,1980,1991,1993–94,1999,2002,2004,2006,2010,2012,2014,2016,2018,2020,2022,2024,2026,Satellite', `downtown timeline without the blurry years, the satellite last while comparing: ${chips}`);
const more = () => document.querySelector('#years .more');
check(more() && /^Show 8 blurry years/.test(more().textContent), `the blurry years wait behind one row: ${more() && more().textContent}`);
more().click();
check(listed().join() === '1933,1953,1963,1964,1969,1970,1971,1972,1975,1978,1980,1983,1984,1988,1991,1993–94,1999,2002,2004,2006,2010,2012,2014,2016,2018,2020,2022,2024,2026,Satellite' && /^Hide the 8 blurry years/.test(more().textContent), `asked for, every year is listed: ${listed()}`);
more().click();
check(listed().length === 22 && /^Show 8/.test(more().textContent), 'and they fold away again');
check(document.querySelector('.opt[data-year="2014"]').classList.contains('need'), 'an archive year not yet read is marked as needing a load');
check(document.querySelector('.opt[data-year="2024"]').classList.contains('now'), 'a mosaic year is instant');
check(document.querySelector('#years').hidden && document.querySelector('#years .opt b').textContent === 'Satellite', 'the year list waits closed, newest first');
check(document.querySelector('.opt[data-year="1971"] .who').textContent === 'USGS' && document.querySelector('.opt[data-year="2024"] .who').textContent === 'DRCOG'
  && document.querySelector('.opt[data-year="2014"] .who').textContent === 'DRCOG archive', 'each year in the list says where it comes from here');
check(document.querySelector('.opt[data-year="2024"] .px').textContent === '3 in' && document.querySelector('.opt[data-year="1971"] .px').textContent === '3 ft'
  && document.querySelector('.opt[data-year="1933"] .px').textContent === '1 ft', 'each year in the list says how much ground one pixel covers');
document.querySelector('#year-pick').click();
check(!document.querySelector('#years').hidden && document.querySelector('#year-pick').getAttribute('aria-expanded') === 'true', 'the year opens the list');
document.querySelector('.opt[data-year="2022"]').click();
check(document.querySelector('#years').hidden && A.state.sides[A.state.active].year === 2022, 'picking from the list sets the year and closes it');
A.pick(2014, true);
check(A.how(1977, 39.7482, -104.9935) === null && A.how(1933, 39.7482, -104.9935) === 'tiles', '1977 is Boulder County only; 1933 covers downtown');
check(A.how(2014, 39.7482, -104.9935) === 'read' && A.how(2024, 39.7482, -104.9935) === 'tiles', '2014 downtown is a read, 2024 is tiles');
check(A.how(2024, 38.83, -104.82) === null, 'Colorado Springs is outside the region');
check(PR.covers(S.SOURCES[1933].providers[0], 39.7482, -104.9935), 'downtown Denver is inside the 1933 King coverage');
check(S.SOURCES[1970].providers[0].usgs && S.label(1970) === '1970' && S.label(1990) === '1990s', 'downtown, 1970 is the USGS year and reads as its year; 1990 is still the decade cache');

/* Tiles: a first ask is one image pixel per CSS pixel at quality 78; the
   sharpen pass asks for the screen's density, never finer than 3 in. */
const lay = A.state.sides[1].view.layers[0];
check(M.hasLayer(lay) && lay.options.kind === 'image' && lay.options.tileSize === 512, '2024 is on the map as 512 px mosaic tiles');
const u = lay.url({ x: 109216, y: 198944, z: 20 }, false);
check(/exportImage\?/.test(u) && /size=512%2C512/.test(u) && /compressionQuality=78/.test(u), `a tile is an exportImage call, 512 px, quality 78: ${u.slice(-90)}`);
const sz20 = 2 * 20037508.342789244 / (2 ** 20 * 256 / 512), my = 4828000;
check(T.tilePx(512, sz20, my, 0.25, 1) === 512, 'zoom 20 at one pixel per CSS pixel asks for 512');
check(T.tilePx(512, sz20, my, 0.25, 2) > 700 && T.tilePx(512, sz20, my, 0.25, 2) < 800, `zoom 20 sharpened stops at the source's 3 in (~772 px): ${T.tilePx(512, sz20, my, 0.25, 2)}`);
check(T.tilePx(512, sz20 / 2, my, 0.25, 2) < 400, 'zoom 21 is already at the source pixel');
check(T.nativeZoom(0.25) === 21, `tiles stop at zoom 21: ${T.nativeZoom(0.25)}`);
const arap = A.layerSpecs(2008)[0];
check(arap.kind === 'map' && arap.layer === 9 && arap.detectFlat, 'Arapahoe 2008 is a map-service layer whose blank tiles are hidden');
const jc = [2006, 2008, 2010, 2012, 2014, 2016].map((y) => A.layerSpecs(y).find((l) => l.provider && l.provider.credit === 'Jefferson County'));
check(jc.every((l, i) => l && l.kind === 'image' && l.detectFlat && l.service.endsWith(`/DRAPP${[2006, 2008, 2010, 2012, 2014, 2016][i]}/ImageServer`)),
  'Jefferson County 2006-2016 are its own image services, whose blank tiles are hidden');
const jp = jc[1].provider;
check(PR.covers(jp, 39.7555, -105.2211) && PR.covers(jp, 39.7047, -105.0814) && !PR.covers(jp, 39.7392, -104.9849) && !PR.covers(jp, 39.60, -104.88),
  'Jefferson County covers Golden and Lakewood, not the Capitol or Centennial');
check(jp.gate && /DRAPP2014\/ImageServer\/exportImage$/.test(jp.gate.url) && arap.provider.gate && /\/export$/.test(arap.provider.gate.url),
  'each county says how to ask whether a spot is inside it');
check(A.layerSpecs(2004).every((l) => !l.provider || l.provider.credit !== 'Jefferson County') && A.layerSpecs(2018).every((l) => !l.provider || l.provider.credit !== 'Jefferson County'),
  'Jefferson County is not asked for 2004 or for a mosaic year');
check(A.layerSpecs(1933)[0].kind === 'xyz' && A.layerSpecs(1933)[0].tileSize === 256, '1933 is a plain tile cache');

/* The USGS years: each a PMTiles file in our bucket; a year over 512 MB keeps
   its deepest zoom in a second file. */
const u71 = A.layerSpecs(1971)[0], u91 = A.layerSpecs(1991)[0], o02 = S.SOURCES[2002].providers.find((p) => p.pm);
check(u71.kind === 'xyz' && u71.pm && u71.minNativeZoom === 10 && u71.maxNativeZoom === 17, '1971 is read from one tile file, zoom 10 to 17');
check(/^https:\/\/drapp-tiles\.myjimmycloud\.com\/usgs\/1971\.pmtiles\?v=\d+$/.test(T.pmFile(u71.pm, 16)) && /\/usgs\/1971-z17\.pmtiles\?v=\d+$/.test(T.pmFile(u71.pm, 17)), `1971 keeps zoom 17 in its own file, both with the replaced files' ?v=: ${T.pmFile(u71.pm, 17)}`);
check(!u91.pm.deep && /\/usgs\/1991\.pmtiles$/.test(T.pmFile(u91.pm, 17)), '1991 is one file at every zoom');
check(o02 && /\/usgs\/ortho-2002-z18\.pmtiles$/.test(T.pmFile(o02.pm, 18)) && /\/usgs\/ortho-2002\.pmtiles$/.test(T.pmFile(o02.pm, 17)), '2002 across central Denver keeps zoom 18 in its own file');
check(Object.values(S.SOURCES).every((y) => (y.providers || []).every((p) => p.kind !== 'xyz' || p.url || p.pm)), 'every tiled source has an address or a file');

/* The read plan: an archive year is read at the screen's density for as much
   of the middle of the view as the budget buys. */
const vb = { cx: 3142421.6, cy: 1697808.8 };
const idx = [{ kind: 'tif', image: 'x', bbox: { xmin: 3141392, ymin: 1695032, xmax: 3144032, ymax: 1700312 } }];
const plan = A.readPlan(2016, idx, 39.7482, -104.9935);
check(plan.est && plan.est.bytes <= 8e6 * 1.05 && plan.win.px <= 4096, `a 2016 read stays inside 8 MB: ${JSON.stringify(plan.est)}`);
check(plan.win.xmin % 0.25 === 0 && plan.win.res >= 0.25, 'the read sits on DRAPP\'s 3 in grid');
const big = A.readPlan(2016, idx, 39.7482, -104.9935, 40e6);
check(big.win.w * big.win.h >= plan.win.w * plan.win.h, 'a bigger budget buys at least as much ground');
const w = P.windowFor(3142421.6, 1697808.8, 300, 300, 0.25);
check(w.px === 1200 && w.res === 0.25, 'window snaps to the grid');
const e16 = E.forYear(2016, w, idx, 39.7482, -104.9935);
check(e16 && e16.requests === 1200 && e16.bytes > 5e6 && e16.bytes < 7e6, `2016 over 300 ft at 3 in: 1200 requests, ~6 MB, got ${JSON.stringify(e16)}`);
check(A.over(w, { cx: w.cx, cy: w.cy }) && !A.over(w, { cx: w.cx + 400, cy: w.cy }), 'a patch serves a view whose middle is inside it');

/* Picking and stepping. */
A.state.active = 1;
A.pick(2020);
await sleep(50);
check(A.state.sides[1].year === 2020 && document.querySelector('#year-now').textContent === '2020', 'picking a year puts it on the active side');
A.step(1);
await sleep(50);
check(A.state.sides[1].year === 2022, 'stepping goes to the next year that exists here');
/* The split runs either way: flipping stacks the years, older on top. */
const wasStacked = A.stacked();
A.flipSplit();
check(A.stacked() === !wasStacked && document.querySelector('#divider').classList.contains('stack') === A.stacked(), 'the flip button turns the split the other way');
check(document.body.classList.contains('stacked') === A.stacked() && !document.querySelector('#flip').hidden, 'stacked compare marks the page and keeps the flip button up');
A.flipSplit();
check(A.stacked() === wasStacked && !document.querySelector('#divider').classList.contains('stack') === !wasStacked, 'flipping again turns it back');
A.toggleCompare();
await sleep(50);
check(document.querySelector('#flip').hidden, 'the flip button goes with compare');
check(A.state.sides.length === 1 && A.state.sides[0].year === 2022 && document.querySelector('#divider').hidden, 'leaving compare keeps the active side\'s year');
const one = [...document.querySelectorAll('#years .opt b')].map((c) => c.textContent);
check(!one.includes('Satellite'), `the satellite is offered only while comparing: ${one}`);

/* The satellite: one side of Compare, Esri's tiles to level 20, credited,
   never played or saved, `esri` in the link. */
const SAT = S.SAT;
const satSpec = A.layerSpecs(SAT)[0];
check(satSpec.kind === 'xyz' && satSpec.maxNativeZoom === 20 && /World_Imagery\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}$/.test(satSpec.service), 'the satellite is Esri World Imagery tiles to level 20');
check(!S.YEARS.includes(SAT) && A.how(SAT, 39.7482, -104.9935) === 'tiles', 'the satellite is not a year, and is instant downtown');
A.toggleCompare();
await sleep(50);
A.state.active = 1;
A.pick(SAT);
await sleep(300);
check(A.state.sides[1].year === SAT && document.querySelector('#year-now').textContent === 'Satellite', 'the satellite can be picked as a side');
check(!document.querySelector('#credit').hidden && /Esri/.test(document.querySelector('#credit').textContent), 'Esri\'s credit shows while the satellite is on');
check(/Esri/.test(document.querySelector('#tag-1 small').textContent) && /DRCOG|Library|archive/.test(document.querySelector('#tag-0 small').textContent + ' '), `each tag says whose picture: "${document.querySelector('#tag-0 small').textContent}" / "${document.querySelector('#tag-1 small').textContent}"`);
check(/^Esri World Imagery/.test(document.querySelector('#src').textContent), `the line under the year names Esri: ${document.querySelector('#src').textContent}`);
await sleep(400);
check(/y=\d{4}-esri/.test(window.location.hash), `the link says esri: ${window.location.hash}`);
A.toggleCompare();
await sleep(50);
check(A.state.sides.length === 1 && A.state.sides[0].year !== SAT && document.querySelector('#credit').hidden, 'leaving compare from the satellite side keeps the year, and the credit goes');
window.location.hash = '#ll=39.739250,-104.984850&z=21&y=2024-esri';
await sleep(300);
check(A.state.sides.length === 2 && A.state.sides[0].year === 2024 && A.state.sides[1].year === SAT && M.getZoom() === 21, 'a show-off link opens 2024 against the satellite at zoom 21');
check(Math.abs(A.state.split - 0.5) < 0.11, `the divider starts near halfway: ${A.state.split}`);
A.toggleCompare();
await sleep(50);
window.location.hash = '#ll=39.739250,-104.984850&z=19&y=esri';
await sleep(300);
check(A.state.sides.every((s) => s.year !== SAT), 'the satellite alone in a link is not a view');

/* The zip writer: a valid end-of-central-directory record and the right CRC. */
check(window.DRAPP.crc32(new TextEncoder().encode('123456789')) === 0xCBF43926, 'crc32 of "123456789"');

/* Lat/lon parsing and projection. */
const ll = window.DRAPP.geocode.parseLatLon('-104.9935, 39.7482');
check(ll && Math.abs(ll.lat - 39.7482) < 1e-9 && Math.abs(ll.lon + 104.9935) < 1e-9, 'swapped lon,lat is corrected');
const sp = P.toStatePlane(-104.9935, 39.7482);
check(Math.abs(sp.x - 3142421.6) < 2 && Math.abs(sp.y - 1697808.8) < 2, `state plane projection off: ${sp.x}, ${sp.y}`);

check(pageErrors.length === 0, 'page errors: ' + pageErrors.join(' | '));
if (fails.length) { console.error('SMOKE FAIL\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('smoke ok: map, timeline for the place, compare from the hash, tile sizes, read plan inside its budget, picking and stepping, zip crc, projection');
process.exit(0);
