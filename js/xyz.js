/* Cached Web Mercator z/x/y tiles onto our state-plane window. The tiles
   under the window (plus a margin for the rotation) are mosaicked on a
   Mercator canvas, then that is drawn onto the state-plane grid with the
   inverse of the affine the finished window is warped with — so a tiled
   source lines up with the DRAPP years to the same sub-pixel tolerance.

   Zoom is the shallowest level at least as fine as the window's own pixels,
   capped by the source; a 300 ft square at 1200 px wants zoom 20 and gets
   the source's 19, which is what it actually holds. */
(function () {
  const R = 20037508.342789244;      // half the Mercator world, metres
  const TILE = 256;
  const MAX_TILES = 64;

  function tileUrl(tpl, z, x, y) {
    return tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  }

  /* Which zoom and how many tiles a window would take: shared with the cost
     estimate so the number it shows is the number that gets fetched. */
  function plan(p, win) {
    const { warp } = DRAPP;
    const rect = warp.mercRect(win);
    const lat = proj4('EPSG:3857', 'EPSG:4326', [(rect.mxmin + rect.mxmax) / 2, (rect.mymin + rect.mymax) / 2])[1];
    const wantRes = win.res * 0.3048 / Math.cos(lat * Math.PI / 180);   // Mercator metres per output pixel
    let z = Math.min(p.maxZoom, Math.max(0, Math.ceil(Math.log2((2 * R / TILE) / wantRes))));
    for (;; z--) {
      const tres = 2 * R / TILE / 2 ** z, tsize = tres * TILE;
      const range = {
        z, tres,
        x0: Math.floor((rect.mxmin + R) / tsize), x1: Math.floor((rect.mxmax + R) / tsize),
        y0: Math.floor((R - rect.mymax) / tsize), y1: Math.floor((R - rect.mymin) / tsize),
      };
      range.count = (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1);
      if (range.count <= MAX_TILES || z === 0) return range;
    }
  }

  async function render(p, win, canvas, signal) {
    const { warp, imageserver } = DRAPP;
    const range = plan(p, win);
    const nx = range.x1 - range.x0 + 1, ny = range.y1 - range.y0 + 1;
    const mosaic = document.createElement('canvas');
    mosaic.width = nx * TILE; mosaic.height = ny * TILE;
    const mctx = mosaic.getContext('2d');
    let hits = 0;
    const jobs = [];
    for (let ty = range.y0; ty <= range.y1; ty++) {
      for (let tx = range.x0; tx <= range.x1; tx++) {
        jobs.push(imageserver.loadImage(tileUrl(p.url, range.z, tx, ty), signal, 30000).then((im) => {
          mctx.drawImage(im, (tx - range.x0) * TILE, (ty - range.y0) * TILE);
          hits++;
        }, (e) => { if (e.name === 'AbortError') throw e; /* a missing tile is just no coverage there */ }));
      }
    }
    await Promise.all(jobs);
    if (!hits) throw new Error('no tiles at this spot');
    const ctx = canvas.getContext('2d');
    const tsize = range.tres * TILE;
    warp.fromMercator(mosaic, range.x0 * tsize - R, R - range.y0 * tsize, range.tres, win, ctx);
    if (imageserver.isBlank(ctx, win.px, win.py)) {
      ctx.clearRect(0, 0, win.px, win.py);
      throw new Error('no imagery at this spot on the service');
    }
    return { zoom: range.z, tiles: hits };
  }

  DRAPP.xyz = { render, plan, MAX_TILES };
})();
