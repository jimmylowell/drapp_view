/* The imagery is rendered on a state-plane grid (square, grid-north up). The
   map is Web Mercator (true-north up), and the two differ by a small rotation,
   about 0.2–0.5° across the Denver region. That is a few pixels across a
   square, so each finished square is warped once with a canvas affine
   transform before it goes on the map. Locally the projection difference is
   affine to well under a pixel. */
(function () {
  const M = 'EPSG:3857', SP = 'EPSG:2232', LL = 'EPSG:4326';

  /* A square of `sideFt` feet on the ground, centred on lat/lon, expressed as
     a Mercator-aligned box. Mercator stretches by 1/cos(lat), so the box is
     wider in metres than the ground distance. */
  function mercSquare(lat, lon, sideFt) {
    const [mx, my] = proj4(LL, M, [lon, lat]);
    const half = (sideFt * 0.3048 / 2) / Math.cos(lat * Math.PI / 180);
    return { mxmin: mx - half, mxmax: mx + half, mymin: my - half, mymax: my + half };
  }

  /* Leaflet bounds [[south, west], [north, east]] for a Mercator box. */
  function bounds(sq) {
    const sw = proj4(M, LL, [sq.mxmin, sq.mymin]);
    const ne = proj4(M, LL, [sq.mxmax, sq.mymax]);
    return [[sw[1], sw[0]], [ne[1], ne[0]]];
  }

  /* Draw the state-plane canvas into an N×N Mercator canvas covering `sq`. */
  function toMercator(spCanvas, win, sq, N) {
    const out = document.createElement('canvas');
    out.width = out.height = N;
    const ctx = out.getContext('2d');
    const mres = (sq.mxmax - sq.mxmin) / N;
    const toOut = (i, j) => {
      const x = win.xmin + i * win.res, y = win.ymax - j * win.res;
      const m = proj4(SP, M, [x, y]);
      return [(m[0] - sq.mxmin) / mres, (sq.mymax - m[1]) / mres];
    };
    const P = win.px;
    const [u0, v0] = toOut(0, 0), [u1, v1] = toOut(P, 0), [u2, v2] = toOut(0, P);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform((u1 - u0) / P, (v1 - v0) / P, (u2 - u0) / P, (v2 - v0) / P, u0, v0);
    ctx.drawImage(spCanvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return out;
  }

  DRAPP.warp = { mercSquare, bounds, toMercator };
})();
