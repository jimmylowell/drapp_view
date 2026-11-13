/* Where each year comes from. Verified 2026-09-07; see README for the
   inventory.

   DRAPP years (2002–2026) have `stream` and/or `archive`; 2026 is DRCOG's
   interim mosaic, the service Sanborn names `DRCOG_Interim_2026_unsecured`:
     `stream`  an ArcGIS ImageServer that renders any bbox region-wide.
     `archive` what the raw tiles on DRCOG's S3 bucket are:
       'tif'  GeoTIFF the browser can window into (uncompressed strips or tiles)
       'jp2'  JPEG 2000 — download only in this version
       'sid'  MrSID — download only (no open decoder exists)
       null   not published yet (current imagery is sold by Sanborn)

   Any year can also carry `providers`: other public services tried in order,
   each covering only part of the region (one county, one city). They are what
   push the page past DRAPP's 2002 floor, and they stand in for the two DRAPP
   years that are download-only. Each provider is
     kind    'map'  ArcGIS MapServer export (dynamic; one request, drawn on our
                    state-plane grid by the server)
             'xyz'  cached Web Mercator z/x/y tiles, mosaicked and warped here
     cover   [south, west, north, east] in degrees — the service's own extent,
             used to skip it without a request. Inside the box a service may
             still have no pixels (a county is not a rectangle); the render
             then comes back flat and is rejected.
     res     ground sample in inches, for the render-size ceiling
     src     what the year menu says once it is showing, after the credit
     area    where it is, for the "only …" note when the point is elsewhere
     home    where a person can read about it */
(function () {
  const SANBORN = 'https://drcog-data.sanborn.com/arcgis/rest/services/';
  const INDEX = 'https://gis.drcog.org/server/rest/services/RDC/TIFF_{Y}_INDEX/MapServer/0';

  /* Arapahoe County publishes one dynamic layer per flight in a single map
     service, 1998 to 2026. Inside the county that makes every DRAPP year a
     plain tile layer, including the ones that are otherwise a row-by-row read
     of the archive (2004-2016) or download-only (2002, 2008). 1998 covers
     only the western, built-up part of the county. */
  const ARAPAHOE = 'https://gis.arapahoegov.com/arcgis/rest/services/Aerials/MapServer';
  const ARAPAHOE_HOME = 'https://gis.arapahoegov.com/arcgis/rest/services/Aerials/MapServer';
  const arapahoe = (layer, cover, res, note) => ({
    kind: 'map', service: ARAPAHOE, layer, cover, res,
    src: 'county aerial' + (note ? ' ' + note : ''), credit: 'Arapahoe County', area: 'Arapahoe County', home: ARAPAHOE_HOME,
  });
  const ARAPAHOE_COUNTY = [39.55, -105.0624, 39.7585, -103.6998];

  /* Boulder County: a 1977 black-and-white flight at 1 ft and a 2000 colour
     one, both cached map services in Colorado North state plane; the server
     reprojects on export. */
  const BOULDER = 'https://maps.bouldercounty.org/arcgis/rest/services/RASTER/';
  const boulder = (name, cover, res, src) => ({
    kind: 'map', service: BOULDER + name + '/MapServer', layer: null, cover, res,
    src, credit: 'Boulder County', area: 'Boulder County', home: BOULDER + name + '/MapServer',
  });

  /* The 1933 King aerial survey of Denver, georeferenced by the Denver Public
     Library for its Time Traveler's Map and hosted as Web Mercator tiles on
     ArcGIS Online, 20 levels deep (about 1 ft a pixel at the bottom). Covers
     central Denver only. */
  const KING_1933 = {
    kind: 'xyz',
    url: 'https://tiles.arcgis.com/tiles/44C95LOqZjbh8Row/arcgis/rest/services/Denver_1933_Aerial/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19, cover: [39.6664, -105.0542, 39.7957, -104.8849], res: 12,
    src: 'King aerial survey, georeferenced by the library', credit: 'Denver Public Library', area: 'central Denver',
    home: 'https://history.denverlibrary.org/maps/time-travelers/',
  };

  /* Web Mercator tile caches on ArcGIS Online. CDOT's account holds three
     one-town scans (Golden 1930, Boulder 1948, Englewood–Littleton 1953), 17
     levels deep (≈4 ft a pixel). South Metro Fire Rescue publishes one cache
     per decade over its district — Centennial, Cherry Hills, Highlands Ranch,
     Lone Tree, Parker, Castle Pines — 16 levels deep (≈8 ft). Neither says
     where the film came from. */
  const CDOT = 'https://tiles.arcgis.com/tiles/yzB9WM8W0BO3Ql7d/arcgis/rest/services/';
  const cdot = (name, cover, area) => ({
    kind: 'xyz', url: CDOT + name + '/MapServer/tile/{z}/{y}/{x}', maxZoom: 17, cover, res: 48,
    src: area + ' scan', credit: 'CDOT', area, home: CDOT + name + '/MapServer',
  });
  const SMFR = 'https://tiles.arcgis.com/tiles/sszu6VPfua0T2iye/arcgis/rest/services/HIstorical_Aerial_Imagery___';
  const SMFR_DISTRICT = [39.4625, -105.0345, 39.6966, -104.6561];
  const smfr = (name, src) => ({
    kind: 'xyz', url: SMFR + name + '_WTL1/MapServer/tile/{z}/{y}/{x}', maxZoom: 16, cover: SMFR_DISTRICT, res: 96,
    src, credit: 'South Metro Fire Rescue', area: 'the South Metro fire district (Centennial to Parker)', home: SMFR + name + '_WTL1/MapServer',
  });

  /* How the archive GeoTIFFs are laid out inside, for the cost estimate before
     a read starts (measured 2026-09-07, downtown tiles; js/tiffwindow.js reads
     the real directory and does not depend on this):
       strips  one uncompressed row per strip: a read is one range request per
               distinct source row touched, `spp` bytes a pixel across the
               columns spanned.
       tiles   128² tiles read through geotiff.js in 64 KB blocks, at the
               coarsest overview (`levels`, as multiples of `res`) still finer
               than the window. `bytesPerBlock` is what one 128² block costs
               for the three bands drawn. */
  const strips = (res, spp) => ({ kind: 'strips', res, spp });
  const LAYOUT_3IN = strips(0.25, 4);            // 10560² RGBN, 42 KB a row
  const LAYOUT_2012 = strips(0.5, 4);            // 10640² RGBN
  const LAYOUT_2006 = strips(1, 3);              // 5000² RGB
  const LAYOUT_2010 = { kind: 'tiles', res: 0.25, block: 128, bytesPerBlock: 12000, levels: [1, 2, 4, 8, 16, 32, 64, 128] };   // JPEG, one tile per band, full pyramid
  const LAYOUT_2004 = { kind: 'tiles', res: 1, block: 128, bytesPerBlock: 49152, levels: [1, 4.8828] };                       // uncompressed RGB, one overview

  /* `label` is what the menu shows when the key is a stand-in: the decade
     caches carry no single date. */
  const SOURCES = {
    2026: { stream: SANBORN + 'DRCOG_2026/DRCOG_Interim_2026_unsecured/ImageServer', archive: null, interim: true },
    2024: { stream: SANBORN + 'DRCOG_2024/DRCOG_Final_Ortho_2024/ImageServer', archive: null },
    2022: { stream: SANBORN + 'DRCOG_2022/Mosaics_2022/ImageServer', archive: 'tif', layout: LAYOUT_3IN },
    2020: { stream: SANBORN + 'DRCOG_2020/Orthos_3in_6in_12in/ImageServer', archive: 'tif', layout: LAYOUT_3IN },
    2018: { stream: SANBORN + 'DRCOG_2018/Orthos_3in_6in_12in/ImageServer', archive: 'tif', layout: LAYOUT_3IN },
    2016: { archive: 'tif', layout: LAYOUT_3IN, providers: [arapahoe(5, ARAPAHOE_COUNTY, 6)] },
    2014: { archive: 'tif', layout: LAYOUT_3IN, providers: [arapahoe(6, ARAPAHOE_COUNTY, 6)] },
    2012: { archive: 'tif', layout: LAYOUT_2012, providers: [arapahoe(7, ARAPAHOE_COUNTY, 6)] },
    2010: { archive: 'tif', layout: LAYOUT_2010, providers: [arapahoe(8, ARAPAHOE_COUNTY, 6)] },
    2008: { archive: 'sid', providers: [arapahoe(9, ARAPAHOE_COUNTY, 6)] },
    2006: { archive: 'tif', layout: LAYOUT_2006, providers: [arapahoe(10, ARAPAHOE_COUNTY, 6)] },
    2004: { archive: 'tif', layout: LAYOUT_2004, providers: [arapahoe(11, ARAPAHOE_COUNTY, 6)] },
    2002: { archive: 'jp2', providers: [arapahoe(12, [39.5444, -105.0731, 39.77, -104.2358], 6)] },
    2000: { providers: [
      arapahoe(13, [39.5381, -105.0729, 39.7668, -103.6836], 12),
      boulder('color2000', [39.7068, -105.6975, 40.2634, -105.0525], 12, 'county aerial'),
    ] },
    1998: { providers: [arapahoe(14, [39.563, -105.0548, 39.7432, -104.602], 12, '(black and white)')] },
    1990: { label: '1990s', providers: [smfr('1990_99', 'district aerial, 1990s')] },
    1980: { label: '1980s', providers: [smfr('1980_89', 'district aerial, 1980s')] },
    1977: { providers: [boulder('AERIAL1977_1FT', [39.9103, -105.6684, 40.2652, -105.0449], 12, 'county aerial, 1 ft, black and white')] },
    1970: { label: '1970s', providers: [smfr('1970_79', 'district aerial, 1970s')] },
    1960: { label: '1960s', providers: [smfr('1960_69', 'district aerial, 1960s')] },
    1953: { providers: [
      cdot('Englewood_and_Littleton_1953_Aerial', [39.5384, -105.1003, 39.6885, -104.912], 'Englewood and Littleton'),
      smfr('1953', 'district aerial, 1953'),
    ] },
    1948: { providers: [cdot('Boulder_1948_Aerial', [39.968, -105.313, 40.0542, -105.1974], 'Boulder')] },
    1933: { providers: [KING_1933] },
    1930: { providers: [cdot('Golden_1930_Aerial', [39.736, -105.2129, 39.747, -105.1975], 'downtown Golden')] },
  };
  const YEARS = Object.keys(SOURCES).map(Number).sort((a, b) => a - b);
  const isDrapp = (year) => 'archive' in SOURCES[year];
  const label = (year) => SOURCES[year].label || String(year);

  const STREAM_LABEL = 'DRCOG mosaic hosted by Sanborn';
  const ARCHIVE_LABEL = 'DRCOG archive tile on S3, read in the browser';

  window.DRAPP = Object.assign(window.DRAPP || {}, {
    sources: { SOURCES, YEARS, INDEX, STREAM_LABEL, ARCHIVE_LABEL, isDrapp, label },
  });
})();
