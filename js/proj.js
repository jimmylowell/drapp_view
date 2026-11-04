/* Coordinate helpers. Every DRAPP tile is Colorado State Plane Central, US survey
   feet. Later years are NAD83(HARN)/NAD83(2011) realisations, which differ from
   plain NAD83 by well under a foot, so one definition (EPSG:2232) serves all. */
(function () {
  proj4.defs('EPSG:2232',
    '+proj=lcc +lat_1=39.75 +lat_2=38.45 +lat_0=37.83333333333334 +lon_0=-105.5 ' +
    '+x_0=914401.8288036576 +y_0=304800.6096012192 +ellps=GRS80 +datum=NAD83 ' +
    '+units=us-ft +no_defs +type=crs');

  /* Extent of DRCOG's tile index layers (ft). Outside this there is no DRAPP. */
  const REGION = { xmin: 2877392, ymin: 1467992, xmax: 3510992, ymax: 1906232 };

  /* DRAPP's finest ground sample, 3 inches. Every archive tile and the Sanborn
     mosaics sit on a grid of whole feet, so a window whose origin and pixel
     size are multiples of this lands exactly on source pixels: the server
     copies instead of resampling, and the row reader takes whole pixels. An
     unsnapped window measured 40% softer (Laplacian variance 156 vs 262) from
     the same service, before anything else touched it. */
  const GRID = 0.25;

  function toStatePlane(lon, lat) {
    const [x, y] = proj4('EPSG:4326', 'EPSG:2232', [lon, lat]);
    return { x, y };
  }
  function toLonLat(x, y) {
    const [lon, lat] = proj4('EPSG:2232', 'EPSG:4326', [x, y]);
    return { lon, lat };
  }
  function inRegion(p) {
    return p.x >= REGION.xmin && p.x <= REGION.xmax && p.y >= REGION.ymin && p.y <= REGION.ymax;
  }

  /* Feet per pixel, rounded up to the source grid. */
  function snapRes(res) {
    return Math.max(GRID, Math.ceil(res / GRID - 1e-9) * GRID);
  }

  /* A ground window covering at least the box, on the source grid at `res`
     feet a pixel: origin snapped outward, whole pixels, so px × py is exact. */
  function windowBox(xmin, ymin, xmax, ymax, res) {
    res = snapRes(res);
    const x0 = Math.floor(xmin / res) * res, y1 = Math.ceil(ymax / res) * res;
    const px = Math.max(1, Math.ceil((xmax - x0) / res - 1e-9));
    const py = Math.max(1, Math.ceil((y1 - ymin) / res - 1e-9));
    return {
      xmin: x0, ymax: y1, xmax: x0 + px * res, ymin: y1 - py * res,
      res, px, py, w: px * res, h: py * res, cx: x0 + px * res / 2, cy: y1 - py * res / 2,
    };
  }
  /* A window of exactly wFt × hFt (to the nearest pixel) centred as near
     (cx, cy) as the grid allows. */
  function windowFor(cx, cy, wFt, hFt, res) {
    res = snapRes(res);
    const px = Math.max(1, Math.round(wFt / res)), py = Math.max(1, Math.round(hFt / res));
    const x0 = Math.round((cx - px * res / 2) / res) * res, y1 = Math.round((cy + py * res / 2) / res) * res;
    return {
      xmin: x0, ymax: y1, xmax: x0 + px * res, ymin: y1 - py * res,
      res, px, py, w: px * res, h: py * res, cx: x0 + px * res / 2, cy: y1 - py * res / 2,
    };
  }
  /* Same bbox, another pixel size: how a coarser source renders the same ground. */
  function rewindow(win, res) {
    return windowBox(win.xmin, win.ymin, win.xmax, win.ymax, res);
  }

  window.DRAPP = Object.assign(window.DRAPP || {}, {
    proj: { toStatePlane, toLonLat, inRegion, snapRes, windowBox, windowFor, rewindow, REGION, GRID },
  });
})();
