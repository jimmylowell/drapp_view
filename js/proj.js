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
  /* A square ground window of `side` feet centred on (cx, cy), rendered into a
     px×px canvas. `res` is feet per output pixel. */
  function windowFor(cx, cy, side, px) {
    return {
      cx, cy, side, px, res: side / px,
      xmin: cx - side / 2, xmax: cx + side / 2,
      ymin: cy - side / 2, ymax: cy + side / 2,
    };
  }

  window.DRAPP = Object.assign(window.DRAPP || {}, {
    proj: { toStatePlane, toLonLat, inRegion, windowFor, REGION },
  });
})();
