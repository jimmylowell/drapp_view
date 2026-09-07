# Denver Aerials — every DRAPP year at one address

Live: **https://drapp.myjimmycloud.com**

DRCOG's Denver Regional Aerial Photography Project (DRAPP) has flown the metro every
two years since 2002. The imagery is free, but the public path to it is a catalog of
multi‑hundred‑megabyte GeoTIFF tiles named by grid cell. This page takes an address,
finds the right tiles for every year, and reads only the pixels around that address —
in the browser, with no server of its own.

Build‑free static HTML/JS. Open `index.html` from any static host; there is nothing to
compile. `package.json` is dev tooling only (jsdom for the smoke test).

## How it works

1. **Geocode** — U.S. Census Bureau geocoder via JSONP (it has no CORS), falling back
   to Nominatim. Or type `lat, lon`.
2. **Project** to Colorado State Plane Central, US feet (EPSG:2232) with proj4js, and
   build a square window (150–1200 ft) centred on the point. Every year renders onto
   the same 512×512 state-plane grid, so features line up year to year, then is warped
   with one canvas affine onto Web Mercator (`js/warp.js`) and dropped on a Leaflet map
   over OpenStreetMap tiles. The newest year fades in first; the year menu shows each
   year's download progress and switches the overlay. Picking a year that is still
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
     offers the tile downloads instead.

Every finished square is stored in the browser's IndexedDB keyed by year and exact
window, so a refresh at the same address paints from cache without touching the
network (handy for UI work, too). Add `&fresh=1` to the hash to bypass the cache, or
use the "Clear the cache" link in the footer. "Save all years" downloads one PNG
contact sheet of the current address.

A 300 ft window at 3‑inch resolution costs roughly 500 small requests and about 1 MB
per archive year, 5–12 s each. Archive years load one at a time so the request stream
stays polite; changing the address aborts everything in flight.

## Source inventory (verified 2026‑09‑07)

| Year | Streaming | Archive on S3 | Layout |
|---|---|---|---|
| 2024 | Sanborn `DRCOG_2024/DRCOG_Final_Ortho_2024` | not yet published | — |
| 2022 | Sanborn `DRCOG_2022/Mosaics_2022` | 10560² RGBN 0.25 ft, 446 MB | strips, uncompressed |
| 2020 | Sanborn `DRCOG_2020/Orthos_3in_6in_12in` | same | strips, uncompressed |
| 2018 | Sanborn `DRCOG_2018/Orthos_3in_6in_12in` | same | strips, uncompressed |
| 2016, 2014 | — | same | strips, uncompressed |
| 2012 | — | 10640² RGBN 0.5 ft, 453 MB | strips, uncompressed |
| 2010 | — | 5440² RGBN 0.25 ft, ~50 MB | tiled 128², JPEG, band‑interleaved, overviews |
| 2008 | — | MrSID (`.sid` + `.sdw`), ~7 MB | download only |
| 2006 | — | 5000² RGB 0.5 ft, 75 MB | strips, uncompressed |
| 2004 | — | 5000² RGB, 82 MB | tiled 128², uncompressed, 1 overview |
| 2002 | — | JPEG 2000 (`.jp2` + `.j2w`), ~8 MB | download only |

County image services (Jefferson 2006–2022, Douglas 2022/2024, Arapahoe 2024, Boulder
2014) exist but only cover their own jurisdictions; they are not used here.

DRCOG has not published anything saying the Sanborn services are meant for public
use; the folder also holds a service literally named `_unsecured`, which suggests it
is deliberate. `npm run probe` checks every upstream and is how you notice a change.

## Development

```
npm install            # jsdom, once, dev only
npm run serve          # python http.server on :8765 — file:// won't do for fetch
npm run probe          # hit every upstream for three test points
npm run smoke          # jsdom smoke test of the page, network stubbed
node scripts/render_node.mjs 2014 39.7482 -104.9935 300 out/   # archive read outside a browser
```

## Deploy

GitHub Pages from `main`, root. `CNAME` is `drapp.myjimmycloud.com`; the DNS record is a
CNAME to `jimmylowell.github.io` in the myjimmycloud.com zone.

## Credits and license

Imagery and tile index: [DRCOG Regional Data Catalog](https://data.drcog.org),
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). 2018–2024 mosaics hosted by
Sanborn Geospatial for DRCOG. Geocoding: U.S. Census Bureau; Nominatim ©
[OpenStreetMap contributors](https://www.openstreetmap.org/copyright).
Libraries: [proj4js](https://github.com/proj4js/proj4js) (MIT),
[geotiff.js](https://github.com/geotiffjs/geotiff.js) (MIT). Site code: MIT.
