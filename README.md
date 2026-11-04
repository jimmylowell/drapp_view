# Denver Aerials — every DRAPP year at one address

Live: **https://drapp.myjimmycloud.com**

DRCOG's Denver Regional Aerial Photography Project (DRAPP) has flown the metro every
two years since 2002. The imagery is free, but the public path to it is a catalog of
multi‑hundred‑megabyte GeoTIFF tiles named by grid cell. This page takes an address,
finds the right tiles for every year, and reads only the pixels around that address —
in the browser, with no server of its own. Where a county, a fire district, CDOT or the
Denver Public Library has an older flight online it goes further back — 2000, 1998, the
1990s to 1950s by decade, 1977, 1953, 1948, 1933, 1930 — on the same ground square, so the
layers still sit exactly on top of each other. Nothing covers the whole region before
2002; each older year says which town or county it is for.

Build‑free static HTML/JS. Open `index.html` from any static host; there is nothing to
compile. `package.json` is dev tooling only (jsdom for the smoke test).

## How it works

1. **Geocode** — U.S. Census Bureau geocoder via JSONP (it has no CORS), falling back
   to Nominatim. Or type `lat, lon`.
2. **Project** to Colorado State Plane Central, US feet (EPSG:2232) with proj4js, and
   build a square window (150–1200 ft) centred on the point. Every year renders onto
   the same state-plane grid (sized per **Render size** below), so features line up
   year to year, then is warped
   with one canvas affine onto Web Mercator (`js/warp.js`) and dropped on a Leaflet map
   over the base map of your choice (`js/basemaps.js`, below). The newest year fades
   in first; the year menu shows each year's download progress and switches the overlay. Picking a year that is still
   queued moves it to the front of the queue. ← and → step through loaded years.
3. **Tile lookup** — DRCOG serves one tile‑index layer per year
   (`gis.drcog.org/server/rest/services/RDC/TIFF_{YEAR}_INDEX/MapServer/0`). An
   envelope query returns the 1–4 tiles touching the window plus their download links.
4. **Render**, per year:
   - **2018–2024** stream from DRCOG's mosaics hosted by Sanborn
     (`drcog-data.sanborn.com`, ArcGIS ImageServer `exportImage` with `bboxSR=imageSR=2232`).
     2018–2022 fall back to the archive if the service stops answering.
   - **2004–2016 (and the fallback)** are read straight out of the raw GeoTIFFs on
     DRCOG's public S3 bucket `drapparchive` with HTTP range requests
     (`js/tiffwindow.js`). geotiff.js opens the file and parses the directory; then
     - uncompressed, pixel‑interleaved, one‑row‑per‑strip files (2006, 2012–2022) are
       read by hand, one Range request per source row for only the columns needed
       (~2 KB instead of the 42 KB strip), painted progressively;
     - tiled files (2004 uncompressed, 2010 JPEG) go through geotiff.js, which fetches
       only the tiles under the window, using overviews when the window is coarser.
   - **2002** (JPEG 2000) and **2008** (MrSID) have no browser decoder here; the page
     offers the tile downloads instead — unless the point is in Arapahoe County, whose
     own service has both years (below).
5. **Other agencies' years** (`js/providers.js`) are one request each and run alongside
   the streamed years. Each provider carries its extent box, so a year that cannot
   cover the point says which county it is for without a request. Two kinds:
   - **ArcGIS MapServer export** (Arapahoe, Boulder): `export` with
     `bboxSR=imageSR=2232` and one layer shown; the server reprojects onto our
     state-plane grid, so alignment is its job. A point inside the extent box but
     outside the actual flight comes back as a flat white JPEG, which is rejected.
   - **Web Mercator z/x/y tiles** (the 1933 King survey and the ArcGIS Online caches,
     `js/xyz.js`): the tiles under
     the rotated window are mosaicked on a Mercator canvas and drawn onto the
     state-plane grid with the *inverse* of the affine every finished square is warped
     with (`warp.fromMercator`). Locally that affine is good to well under a pixel, so
     a tiled source lines up with the DRAPP years as well as they line up with each
     other. Zoom is the shallowest level at least as fine as the render, capped by the
     source's 19 (≈1 ft) and 64 tiles.

Every finished window is stored in the browser's IndexedDB keyed by year and exact
window (grid origin, pixel size), so a refresh at the same address paints from cache
without touching the network (handy for UI work, too). Add `&fresh=1` to the hash to bypass the cache, or
use the "Clear the cache" link in the footer. "Save all years" downloads one PNG
contact sheet of the current address.

## Render size and sharpness

DRAPP's resolution is the point of the page, so three things keep the source pixels
intact from the archive to the screen (all measured 2026‑09‑07 on the 2022 mosaic
downtown, Laplacian variance of the luminance as the sharpness number):

1. **Every window sits on DRAPP's 0.25 ft grid** (`js/proj.js`). The archive tiles and
   the Sanborn mosaics have whole‑foot origins, so a window whose origin and pixel size
   are multiples of 3 inches lands exactly on source pixels: the ImageServer copies
   instead of resampling (an aligned request and the same request shifted by 0.1 ft
   score 262 against 156 — 40 % of the detail was going at the server), and the row
   reader takes whole pixels. Aligned, the archive read and the mosaic export of the
   same ground agree to 0.9 grey levels on average.
2. **Exports ask for JPEG quality 95** (`js/imageserver.js`). The service defaults to
   75. 95 is 2.3× the bytes (560 KB for 1200²) and is what makes point 1 worth having.
3. **The map overlay is a canvas, re‑warped from the lossless state‑plane master at the
   screen's own density whenever the zoom changes** (`warp.CanvasOverlay`,
   `fitDensity` in `js/app.js`): device pixels across the window in steps of 256, up
   to 4096 for the year on show (years not on show are kept at 1024). So zooming in
   is one bicubic resample from the source pixels, not a browser‑bilinear blow‑up of a
   JPEG of a 1:1 warp — at 2× the old chain scored 10.6 and the new one 31. Nothing
   is encoded on the way to the screen; the IndexedDB copy is JPEG 0.95.

A window's pixel size is the coarsest of the source (0.25 ft), the screen, and a
per‑path ceiling, snapped up to the grid. The two paths cost differently:

- The ImageServer is one request whatever the size (512 → 0.37 s, 2048 → 1.3 s; it
  refuses past 4096 tall). Ceiling 2048 px a side for the automatic square.
- The archive is one HTTP range request per *distinct source row* touched, so a 6‑inch
  window of a 3‑inch tile costs half the rows. Ceiling 1280 px for the square.

150 and 300 ft squares are always rendered at 3 inches whatever the screen — that is
the window where the resolution is the thing you came to see — so the screen ceiling
never drops a square below 1200 px. A 300 ft archive year is ~1200 requests and 5–6 MB,
~25 s; all the archive years for one address together are about 20 MB. They load one
at a time, newest first; changing the address aborts everything in flight.

## Load this view (`#view-load`)

The square is the reasonable first download. Anything past it is asked for. Pan or
zoom so the year on show no longer serves the view (centre outside it, under half the
view covered, or the view's pixels 1.5× finer than what is loaded) and a chip appears
under the year button — *Load this view · 2022 ≈1.0 MB · ~1 s*. Open it and every year
that can render here is listed with what it would cost (`js/estimate.js`): requests,
bytes and a time guess that follows the rate this browser actually achieved. Tick
years, load. Nothing is fetched until then. The window is the map view at the screen's
own density, no finer than 3 inches, no bigger than 4096 px a side (coarser past that),
and not offered past 2 miles wide.

The estimate is a model, not a measurement: the archive layouts in `js/sources.js`
(strips: rows × columns × bands; 128² tiles: blocks at the chosen overview) against the
index's tile footprints. A 490 × 320 ft view at 3 inches is 1,278 requests and 10 MB
for a 3‑inch year, 640 and 2.5 MB for 2012, 34 requests for 2010's JPEG tiles. The index
is asked four queries at a time; sixteen at once had DRCOG's server answer some with
errors.

## Base maps (`js/basemaps.js`)

What sits under the square is a picker in the bottom-left corner, remembered in
`localStorage`. The default is **Newest available** — the sharpest, most recent imagery
that actually reaches wherever you are. This is also the answer to panning around:
the square itself is a one-shot render, but the base map is an ordinary tile layer, so
exploring costs tile requests rather than another read of the archive.

- **This region, by year** — every year that has a region‑wide service can be the ground
  you pan over, 1930 to 2026. The list is not kept here: `basemaps.js` reads it off
  `sources.js`, so a service added there turns up in the picker with no edit. A year can
  contribute more than one layer (2000 is Arapahoe *and* Boulder, two counties that do
  not touch) and they simply stack. None of these have a tile cache, so a tile is a live
  `export` (0.2–0.5 s measured), clipped by `bounds` to the service's own extent with
  Bing aerial at half opacity underneath.
- **Newest available** walks back from the newest year and stops as soon as a
  region‑wide service is stacked — county imagery over DRCOG over Bing, three layers.
  Stacking every served year instead would fetch eighteen tiles per screen cell.
- **A county's extent is a rectangle; the county is not.** Ask one of these services for
  a tile inside the box but outside the boundary and it answers a flat white JPEG rather
  than a 404, which paints over whatever is beneath it. So every ArcGIS tile is sampled
  8×8 on load and hidden if it is flat — downtown, an out‑of‑county Arapahoe tile is a
  uniform 253 while an in‑county one runs 68–238, so it is not a close call. Reading the
  pixels needs the tile CORS‑clean; if the canvas taints we leave it visible.
- **Bing** (aerial, aerial + labels, road) addresses tiles by quadkey rather than
  z/x/y — one digit per zoom level naming the quadrant — so it gets its own
  `getTileUrl` (`ecn.t{0-3}.tiles.virtualearth.net`, no key).
- **Esri imagery by year** — Esri's [World Imagery Wayback](https://livingatlas.arcgis.com/wayback/)
  keeps every version of its basemap since 2014. The release list is ~100 KB of JSON,
  so it is fetched the first time the menu is opened, reduced to the last release of
  each year, and the group shows a note rather than failing if that request dies.
- **Map** — Bing road, OpenStreetMap, or none. These are the only ones dimmed
  (`.base-flat`); knocking back an aerial just makes it look broken.

Like the imagery sources, none of these are documented public APIs. If one dies the
picker keeps working and the rest still draw.

## Source inventory (verified 2026‑09‑07)

| Year | Streaming | Archive on S3 | Layout |
|---|---|---|---|
| 2026 | Arapahoe County `Aerials/MapServer` layer 0 (county only, March 2026) | — | — |
| 2024 | Sanborn `DRCOG_2024/DRCOG_Final_Ortho_2024` | not yet published | — |
| 2022 | Sanborn `DRCOG_2022/Mosaics_2022` | 10560² RGBN 0.25 ft, 446 MB | strips, uncompressed |
| 2020 | Sanborn `DRCOG_2020/Orthos_3in_6in_12in` | same | strips, uncompressed |
| 2018 | Sanborn `DRCOG_2018/Orthos_3in_6in_12in` | same | strips, uncompressed |
| 2016, 2014 | — | same | strips, uncompressed |
| 2012 | — | 10640² RGBN 0.5 ft, 453 MB | strips, uncompressed |
| 2010 | — | 5440² RGBN 0.25 ft, ~50 MB | tiled 128², JPEG, band‑interleaved, overviews |
| 2008 | Arapahoe layer 9 (county only) | MrSID (`.sid` + `.sdw`), ~7 MB | download only elsewhere |
| 2006 | — | 5000² RGB 0.5 ft, 75 MB | strips, uncompressed |
| 2004 | — | 5000² RGB, 82 MB | tiled 128², uncompressed, 1 overview |
| 2002 | Arapahoe layer 12 (county only) | JPEG 2000 (`.jp2` + `.j2w`), ~8 MB | download only elsewhere |
| 2000 | Arapahoe layer 13; Boulder `RASTER/color2000` | — | 1 ft colour |
| 1998 | Arapahoe layer 14 (western county only) | — | ~1 ft black and white |
| 1990s, 1980s, 1970s, 1960s, 1953 | South Metro Fire Rescue `HIstorical_Aerial_Imagery___{decade}_WTL1` tiles (its district: Centennial to Parker) | — | zoom ≤ 16, ≈8 ft |
| 1977 | Boulder `RASTER/AERIAL1977_1FT` | — | 1 ft black and white |
| 1953 | CDOT `Englewood_and_Littleton_1953_Aerial` tiles (tried before the fire district's) | — | zoom ≤ 17, ≈4 ft |
| 1948 | CDOT `Boulder_1948_Aerial` tiles (city of Boulder) | — | zoom ≤ 17 |
| 1933 | Denver Public Library `Denver_1933_Aerial` tiles on ArcGIS Online (central Denver) | — | 256 px PNG, zoom ≤ 19 |
| 1930 | CDOT `Golden_1930_Aerial` tiles (a few blocks of downtown Golden) | — | zoom ≤ 17 |

Arapahoe County's `Aerials/MapServer` (`gis.arapahoegov.com`) has one dynamic layer per
flight, 1998–2026; Boulder County's are cached map services in Colorado North state
plane (EPSG:2876), which the server reprojects on export. The 1933 King aerial survey
is what the Denver Public Library georeferenced for its
[Time Traveler's Map](https://history.denverlibrary.org/maps/time-travelers/); the
library's other layers there (1868–1929 maps, 1939 and 1942 street maps, 1958 plat,
1965–1994 USGS topos) are maps rather than photographs and their tiles are served
without CORS, so they cannot be drawn on a canvas here. The CDOT and South Metro Fire
Rescue caches are public items in those agencies' ArcGIS Online accounts
(`tiles.arcgis.com/tiles/yzB9WM8W0BO3Ql7d` and `.../sszu6VPfua0T2iye`) with no
description of where the film came from. Every one of these sends
`Access-Control-Allow-Origin`; none is a documented public API.

Looked at and not used (2026-09-07): USGS's NAIP Plus service holds one NAIP year per
place (2019 at Denver), not a history; Esri's NAIP and AWS's NAIP bucket need a token or
a paying requester; Microsoft Planetary Computer has NAIP COGs for 2011–2023 with open
CORS but would need the COG reader and a SAS token dance, and mostly duplicates DRAPP
years; Esri's USGS Historical Topo Maps ImageServer reaches 1890 without a token but
they are maps, not photographs; Jefferson County only has DRAPP 2006–2024 on its portal;
Denver, Douglas, Adams, Aurora, Lakewood and Englewood publish nothing older than 2014.
The "Douglas County" 1938–1993 caches on ArcGIS Online are Douglas County, Nebraska.

DRCOG has not published anything saying the Sanborn services are meant for public
use; the folder also holds a service literally named `_unsecured`, which suggests it
is deliberate. `npm run probe` checks every upstream and is how you notice a change.

## Development

```
npm install            # jsdom, once, dev only
npm run serve          # python http.server on :8765 — file:// won't do for fetch
npm run probe          # hit every upstream for three test points
npm run smoke          # jsdom smoke test of the page, network stubbed
RES=0.25 node scripts/render_node.mjs 2014 39.7482 -104.9935 300 out/   # archive read outside a browser
```

## Deploy

GitHub Pages from `main`, root. `CNAME` is `drapp.myjimmycloud.com`; the DNS record is a
CNAME to `jimmylowell.github.io` in the myjimmycloud.com zone.

## Credits and license

Imagery and tile index: [DRCOG Regional Data Catalog](https://data.drcog.org),
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). 2018–2024 mosaics hosted by
Sanborn Geospatial for DRCOG. Geocoding: U.S. Census Bureau; Nominatim ©
[OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Base maps:
© Microsoft and Earthstar Geographics (Bing); © Esri, Maxar, Earthstar Geographics
(World Imagery and Wayback); © OpenStreetMap contributors.
Libraries: [proj4js](https://github.com/proj4js/proj4js) (MIT),
[geotiff.js](https://github.com/geotiffjs/geotiff.js) (MIT). Site code: MIT.
