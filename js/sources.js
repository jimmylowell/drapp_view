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
    kind: 'map', service: ARAPAHOE, layer, cover, res, gate: ARAPAHOE_GATE,
    src: 'county aerial' + (note ? ' ' + note : ''), credit: 'Arapahoe County', area: 'Arapahoe County', home: ARAPAHOE_HOME,
  });
  const ARAPAHOE_COUNTY = [39.55, -105.0624, 39.7585, -103.6998];
  /* `gate` is how the page asks whether a spot is inside the county: one
     16 px export of `url` (with `layer` shown), flat where the county has no
     picture (js/app.js, inCounty). */
  const ARAPAHOE_GATE = { url: ARAPAHOE + '/export', layer: 1 };

  /* Jefferson County serves its own copies of the DRAPP flights 2006 to 2022,
     one ImageServer a year (checked 2026-11-26: Web Mercator, 1 ft pixels in
     2006 and 2010, 6 in in 2008, 2012, 2014 and 2016; they answer exportImage
     cross-origin, and paint flat white or black outside the county). Inside
     the county they make the years that are otherwise a read of DRCOG's
     archive (2006-2016), or download-only (2008), plain tiles. The county's
     GIS data is under CC BY 4.0 (https://www.jeffco.us/3165/Maps-Data-Download);
     the services carry no copyright text of their own. */
  const JEFFCO = 'https://gisportal.jeffco.us/image/rest/services/DRAPP/';
  const JEFFCO_COUNTY = [39.1037, -105.5522, 39.9447, -105.0145];      // the six services' extents together
  const JEFFCO_GATE = { url: JEFFCO + 'DRAPP2014/ImageServer/exportImage', layer: null };
  const jeffco = (year, res) => ({
    kind: 'image', service: JEFFCO + 'DRAPP' + year + '/ImageServer', layer: null, cover: JEFFCO_COUNTY, gate: JEFFCO_GATE, res,
    src: 'county copy of DRAPP', credit: 'Jefferson County', area: 'Jefferson County', home: 'https://gisportal.jeffco.us/image/rest/services/DRAPP',
  });

  /* Boulder County: a 1977 black-and-white flight at 1 ft and a 2000 colour
     one, both cached map services in Colorado North state plane; the server
     reprojects on export. */
  const BOULDER = 'https://maps.bouldercounty.org/arcgis/rest/services/RASTER/';
  const boulder = (name, cover, res, src) => ({
    kind: 'map', service: BOULDER + name + '/MapServer', layer: null, cover, res,
    src, credit: 'Boulder County', area: 'Boulder County', home: BOULDER + name + '/MapServer',
  });

  /* Jasper King's 1933 aerial survey of Denver, georeferenced by the City and
     County of Denver (the Denver Public Library's page for it says so:
     https://history.denverlibrary.org/research-tool/1933-king-aerial-survey-denver).
     The tile service's own credits read "City of Denver Open Data Catalog".
     The library shows it on its Time Traveler's Map. Web Mercator tiles on
     ArcGIS Online, 20 levels deep (about 1 ft a pixel at the bottom). Covers
     central Denver only. */
  const KING_1933 = {
    kind: 'xyz',
    url: 'https://tiles.arcgis.com/tiles/44C95LOqZjbh8Row/arcgis/rest/services/Denver_1933_Aerial/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19, cover: [39.6664, -105.0542, 39.7957, -104.8849], res: 12,
    src: 'King aerial survey, georeferenced by the city', credit: 'City and County of Denver', area: 'central Denver',
    home: 'https://history.denverlibrary.org/research-tool/1933-king-aerial-survey-denver',
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

  /* USGS aerial photo single frames (EarthExplorer), 1939 to 1991. The scans
     carry no map position of their own: each frame was placed here by
     matching it against the USGS orthophotos of 1993 to 1999 and the years
     already placed, newest to oldest, then the frames of a year were joined
     into one picture and cut into Web Mercator tiles. `err` is the year's
     held-out error at its middle frame: how far, in metres, the fit put
     check points it was not fitted to from where they are. `res`, in inches,
     is the ground one pixel covers: the middle frame's scan or the tile pixel
     at the year's deepest zoom (about 36 in at 17, 72 at 16), the coarser. `cover` is the box round the
     year's frames; inside it the tiles are transparent where no frame is.
     Each year's tiles (WebP, zoom 10 to `maxZoom`) are packed into one PMTiles
     file in our own R2 bucket and read from it a tile at a time by Range
     request (js/tiles.js). `deep` names a year too big for Cloudflare to cache
     as one file (over 512 MB): its deepest zoom is a second file, <name>-z<zoom>. */
  const USGS_FILES = 'https://drapp-tiles.myjimmycloud.com/usgs/';
  const pmFiles = (name, deep) => ({
    url: USGS_FILES + name + '.pmtiles',
    deep: deep ? { zoom: deep, url: `${USGS_FILES}${name}-z${deep}.pmtiles` } : null,
  });
  const USGS_HOME = 'https://earthexplorer.usgs.gov/';
  const usgs = (year, cover, maxZoom, res, err, deep) => ({
    kind: 'xyz', pm: pmFiles(String(year), deep), minZoom: 10, maxZoom, cover, res, usgs: true,
    src: `aerial photos, placed by matching, ${err} m held out`, credit: 'USGS', area: 'the USGS frames around Denver', home: USGS_HOME,
  });
  const U = {
    1939: usgs(1939, [39.5863, -104.9430, 39.7028, -104.8007], 17, 36, 2.7),
    1953: usgs(1953, [39.4837, -105.2041, 39.9183, -104.6761], 17, 60, 3.6),
    1963: usgs(1963, [39.5644, -105.1714, 39.8353, -104.8038], 17, 36, 2.3),
    1964: usgs(1964, [39.5636, -105.1806, 39.8385, -104.8035], 17, 36, 2.3),
    1969: usgs(1969, [39.4635, -105.3318, 40.0397, -104.5143], 17, 112, 3.3),
    1970: usgs(1970, [39.3695, -105.3953, 40.0654, -104.5578], 17, 94, 3.6, 17),
    1971: usgs(1971, [39.4493, -105.2801, 39.9472, -104.6615], 17, 36, 2.6, 17),
    1972: usgs(1972, [39.4128, -105.3671, 40.0470, -104.5492], 17, 96, 3.4),
    1975: usgs(1975, [39.4712, -105.3123, 39.9709, -104.7001], 16, 78, 4.0),
    1978: usgs(1978, [39.4802, -105.3918, 39.9584, -104.7713], 17, 36, 2.8),
    1979: usgs(1979, [39.5141, -105.3094, 39.7095, -105.0913], 16, 84, 4.3),
    1980: usgs(1980, [39.4693, -105.1660, 40.0044, -104.6069], 17, 36, 3.3),
    1983: usgs(1983, [39.4828, -105.3073, 39.9523, -104.9415], 17, 184, 4.2),
    1984: usgs(1984, [39.4859, -105.0515, 39.9618, -104.7041], 17, 56, 3.2),
    1988: usgs(1988, [39.5525, -105.2170, 39.8620, -104.8044], 16, 147, 2.7),
    1991: usgs(1991, [39.5702, -105.0650, 39.8490, -104.7993], 17, 36, 1.9),
  };

  /* USGS orthophotos, on coordinates as published (from EarthExplorer): the
     1999 and 1993-94 digital orthophoto quarter quads (DOQ), 1 m, black and
     white, made from NAPP photos; 1993-94 is one set produced in 1998, 17
     quarter quads from NAPP of June 1993 and three dated 23 September 1994
     (Fort Logan NE and SE, Commerce City SW), so it is one year here. And
     DRCOG's own April 2002 orthoimagery at 0.3 m in colour, which USGS holds
     as High Resolution Orthoimagery: with it 2002 draws across central
     Denver, not only in Arapahoe County. Packed and read like the years above
     (ortho-<year>.pmtiles). */
  const ortho = (folder, cover, maxZoom, res, credit, src, deep) => ({
    kind: 'xyz', pm: pmFiles('ortho-' + folder, deep), minZoom: 10, maxZoom, cover, res,
    src, credit, area: 'central Denver', home: USGS_HOME,
  });
  const O = {
    1993: ortho(1993, [39.5591, -105.1309, 39.8170, -104.8068], 17, 39, 'USGS', 'orthophoto quarter quads, 1 m, black and white'),
    1994: ortho(1994, [39.6205, -105.0677, 39.8170, -104.9332], 17, 39, 'USGS', 'orthophoto quarter quads, 1 m, black and white'),
    1999: ortho(1999, [39.5591, -105.1309, 39.8170, -104.8068], 17, 39, 'USGS', 'orthophoto quarter quads, 1 m, black and white'),
    2002: ortho(2002, [39.6099, -105.1117, 39.8138, -104.8480], 18, 12, 'DRCOG', 'orthoimagery, April 2002, 0.3 m colour, via USGS', 18),
  };

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
    2016: { archive: 'tif', layout: LAYOUT_3IN, providers: [arapahoe(5, ARAPAHOE_COUNTY, 6), jeffco(2016, 6)] },
    2014: { archive: 'tif', layout: LAYOUT_3IN, providers: [arapahoe(6, ARAPAHOE_COUNTY, 6), jeffco(2014, 6)] },
    2012: { archive: 'tif', layout: LAYOUT_2012, providers: [arapahoe(7, ARAPAHOE_COUNTY, 6), jeffco(2012, 6)] },
    2010: { archive: 'tif', layout: LAYOUT_2010, providers: [arapahoe(8, ARAPAHOE_COUNTY, 6), jeffco(2010, 12)] },
    2008: { archive: 'sid', providers: [arapahoe(9, ARAPAHOE_COUNTY, 6), jeffco(2008, 6)] },
    2006: { archive: 'tif', layout: LAYOUT_2006, providers: [arapahoe(10, ARAPAHOE_COUNTY, 6), jeffco(2006, 12)] },
    2004: { archive: 'tif', layout: LAYOUT_2004, providers: [arapahoe(11, ARAPAHOE_COUNTY, 6)] },
    2002: { archive: 'jp2', providers: [O[2002], arapahoe(12, [39.5444, -105.0731, 39.77, -104.2358], 6)] },
    2000: { providers: [
      arapahoe(13, [39.5381, -105.0729, 39.7668, -103.6836], 12),
      boulder('color2000', [39.7068, -105.6975, 40.2634, -105.0525], 12, 'county aerial'),
    ] },
    1999: { providers: [O[1999]] },
    1993: { label: '1993–94', providers: [O[1993], O[1994]] },
    1998: { providers: [arapahoe(14, [39.563, -105.0548, 39.7432, -104.602], 12, '(black and white)')] },
    1991: { providers: [U[1991]] },
    1988: { providers: [U[1988]] },
    1984: { providers: [U[1984]] },
    1983: { providers: [U[1983]] },
    1990: { label: '1990s', providers: [smfr('1990_99', 'district aerial, 1990s')] },
    1980: { label: '1980s', providers: [U[1980], smfr('1980_89', 'district aerial, 1980s')] },
    1979: { providers: [U[1979]] },
    1978: { providers: [U[1978]] },
    1977: { providers: [boulder('AERIAL1977_1FT', [39.9103, -105.6684, 40.2652, -105.0449], 12, 'county aerial, 1 ft, black and white')] },
    1975: { providers: [U[1975]] },
    1972: { providers: [U[1972]] },
    1971: { providers: [U[1971]] },
    1970: { label: '1970s', providers: [U[1970], smfr('1970_79', 'district aerial, 1970s')] },
    1969: { providers: [U[1969]] },
    1964: { providers: [U[1964]] },
    1963: { providers: [U[1963]] },
    1960: { label: '1960s', providers: [smfr('1960_69', 'district aerial, 1960s')] },
    1953: { providers: [
      U[1953],
      cdot('Englewood_and_Littleton_1953_Aerial', [39.5384, -105.1003, 39.6885, -104.912], 'Englewood and Littleton'),
      smfr('1953', 'district aerial, 1953'),
    ] },
    1948: { providers: [cdot('Boulder_1948_Aerial', [39.968, -105.313, 40.0542, -105.1974], 'Boulder')] },
    1939: { providers: [U[1939]] },
    1933: { providers: [KING_1933] },
    1930: { providers: [cdot('Golden_1930_Aerial', [39.736, -105.2129, 39.747, -105.1975], 'downtown Golden')] },
  };
  const YEARS = Object.keys(SOURCES).map(Number).sort((a, b) => a - b);

  /* Today's satellite picture, Esri World Imagery, as one side of Compare
     only: never a year on the timeline, never played, never saved. Over the
     Denver region its tiles go to level 20 (15 cm samples of a 31-50 cm
     satellite picture); level 21 is Esri's "Map data not yet available" tile
     (checked 2026-11-17 at the Capitol, Aurora, Boulder, Littleton, Golden and
     DIA with the service's tilemap). Its key sorts after every year; the link
     calls it `esri`. What it is at a spot is read from Esri's own records
     (js/app.js, satMeta). */
  const SAT = 9000;
  const ESRI_IMAGERY = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
  const ESRI_CREDIT = 'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community';   // the service's own copyrightText
  SOURCES[SAT] = {
    label: 'Satellite', sat: true,
    providers: [{
      kind: 'xyz', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      maxZoom: 20, cover: [-85, -180, 85, 180], res: 12,
      src: 'satellite', credit: 'Esri World Imagery', area: 'everywhere', home: ESRI_IMAGERY,
    }],
  };

  const isDrapp = (year) => 'archive' in SOURCES[year];
  /* A decade cache's key reads as its decade ("1970s") only where no USGS
     year covers the spot: there it is that year. `where` is set by the page
     to read the middle of the map. */
  const inside = (p, ll) => ll && ll[0] >= p.cover[0] && ll[0] <= p.cover[2] && ll[1] >= p.cover[1] && ll[1] <= p.cover[3];
  const label = (year) => {
    const s = SOURCES[year];
    if (!s.label) return String(year);
    const ll = api.where && api.where();
    return (s.providers || []).some((p) => p.usgs && inside(p, ll)) ? String(year) : s.label;
  };

  const STREAM_LABEL = 'DRCOG mosaic hosted by Sanborn';
  const ARCHIVE_LABEL = 'DRCOG archive tile on S3, read in the browser';

  const api = { SOURCES, YEARS, SAT, ESRI_IMAGERY, ESRI_CREDIT, INDEX, STREAM_LABEL, ARCHIVE_LABEL, isDrapp, label, where: null };
  window.DRAPP = Object.assign(window.DRAPP || {}, { sources: api });
})();
