/* The imagery is rendered on a state-plane grid (grid-north up). The map is
   Web Mercator (true-north up), and the two differ by a small rotation, about
   0.2–0.5° across the Denver region. That is a few pixels across a square, so
   a finished window is drawn onto the map through one canvas affine. Locally
   the projection difference is affine to well under a pixel, and the same
   affine, inverted, takes a Mercator tile mosaic onto the state-plane grid
   (js/xyz.js).

   The state-plane canvas is the master copy and is never encoded: the map
   overlay is a second canvas warped from it at whatever density the screen
   needs right now (js/app.js re-warps on zoom), so every zoom level is one
   resample from the source pixels rather than a resample of a JPEG of a
   resample. */
(function () {
  const M = 'EPSG:3857', SP = 'EPSG:2232', LL = 'EPSG:4326';

  /* Mercator metres of state-plane pixel corner (i, j) of `win`. */
  function pixelToMerc(win, i, j) {
    return proj4(SP, M, [win.xmin + i * win.res, win.ymax - j * win.res]);
  }

  /* The Mercator box that just contains the (slightly rotated) window. */
  function mercRect(win) {
    const c = [[0, 0], [win.px, 0], [win.px, win.py], [0, win.py]].map(([i, j]) => pixelToMerc(win, i, j));
    return {
      mxmin: Math.min(...c.map((p) => p[0])), mxmax: Math.max(...c.map((p) => p[0])),
      mymin: Math.min(...c.map((p) => p[1])), mymax: Math.max(...c.map((p) => p[1])),
    };
  }

  /* Leaflet bounds [[south, west], [north, east]] for a Mercator box. */
  function bounds(rect) {
    const sw = proj4(M, LL, [rect.mxmin, rect.mymin]);
    const ne = proj4(M, LL, [rect.mxmax, rect.mymax]);
    return [[sw[1], sw[0]], [ne[1], ne[0]]];
  }

  /* The window's four corners as [lat, lon], for drawing its outline. */
  function corners(win) {
    return [[0, 0], [win.px, 0], [win.px, win.py], [0, win.py]].map(([i, j]) => {
      const m = pixelToMerc(win, i, j);
      const ll = proj4(M, LL, m);
      return [ll[1], ll[0]];
    });
  }

  /* The affine [a, b, c, d, e, f] (canvas setTransform order) taking
     state-plane pixel (i, j) of `win` to output pixel (u, v), where the
     output is a Mercator grid with `mres` metres a pixel and its top-left at
     (mx0, my0). Fitted at three corners; the fourth lands within a pixel. */
  function toMercAffine(win, mx0, my0, mres) {
    const out = (i, j) => { const m = pixelToMerc(win, i, j); return [(m[0] - mx0) / mres, (my0 - m[1]) / mres]; };
    const [u0, v0] = out(0, 0), [u1, v1] = out(win.px, 0), [u2, v2] = out(0, win.py);
    return [(u1 - u0) / win.px, (v1 - v0) / win.px, (u2 - u0) / win.py, (v2 - v0) / win.py, u0, v0];
  }

  function invert([a, b, c, d, e, f]) {
    const det = a * d - b * c;
    const ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
    return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
  }

  /* Draw the state-plane canvas into a Mercator canvas `W` pixels wide
     covering `rect` (height follows the box). Pass a canvas to reuse it. */
  function toMercator(spCanvas, win, rect, W, out) {
    const mres = (rect.mxmax - rect.mxmin) / W;
    const H = Math.max(1, Math.round((rect.mymax - rect.mymin) / mres));
    out = out || document.createElement('canvas');
    if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
    const ctx = out.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(...toMercAffine(win, rect.mxmin, rect.mymax, mres));
    ctx.drawImage(spCanvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return out;
  }

  /* The other way: a Mercator canvas whose top-left is (mx0, my0) at `mres`
     metres a pixel, drawn onto the state-plane grid of `win`. */
  function fromMercator(mercCanvas, mx0, my0, mres, win, ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(...invert(toMercAffine(win, mx0, my0, mres)));
    ctx.drawImage(mercCanvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* Leaflet's image overlay, but holding a canvas element instead of an <img>
     with a URL: nothing is encoded, and the canvas can be redrawn in place at
     a new size (Leaflet sizes it by CSS, so the pixel size is ours to change). */
  const CanvasOverlay = L.ImageOverlay.extend({
    _initImage() {
      const el = this._image = this._url;
      L.DomUtil.addClass(el, 'leaflet-image-layer');
      if (this._zoomAnimated) L.DomUtil.addClass(el, 'leaflet-zoom-animated');
      if (this.options.className) L.DomUtil.addClass(el, this.options.className);
      el.onselectstart = L.Util.falseFn;
      el.onmousemove = L.Util.falseFn;
      if (this.options.zIndex) this._updateZIndex();
    },
  });

  DRAPP.warp = { mercRect, bounds, corners, toMercator, fromMercator, pixelToMerc, CanvasOverlay };
})();
