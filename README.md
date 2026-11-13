# Denver Aerials: every DRAPP year at one address

Live: **https://drapp.myjimmycloud.com**

DRCOG's Denver Regional Aerial Photography Project (DRAPP) photographs the Denver
region down to 3 inches a pixel. The imagery is free, but the public path to most of
it is a catalog of multi-hundred-megabyte GeoTIFF tiles named by grid cell. This page
shows it as one map: the photograph fills the screen, a timeline along the bottom lists
the years that exist where the map is, and you can step through them, compare two side
by side, and save what is on screen. There is no server of its own and no account.

What the page is for and how it behaves, in full: [docs/design.md](docs/design.md).

## The screen

- **Top left:** a search box (address, place, or `lat, lon`), a locate button, and a
  short list of places to start.
- **Top right:** Compare, Save, Link, About.
- **Bottom:** the timeline. The year on show, where it comes from and how sharp it is,
  what the visit has downloaded, and one chip per year that exists where the map is
  centred. A solid chip is instant; a dashed chip is a year read out of DRCOG's archive
  for this view.
- **Compare** splits the map with a draggable divider, older year on the left.
- Arrow keys step years, space plays, `c` compares, `/` goes to search.

## Two kinds of year

| | Years | How it arrives |
|---|---|---|
| **Tiles** | 2018–2026 region-wide (DRCOG's mosaics on Sanborn's server; 2026 is the interim mosaic). 1998–2026 inside Arapahoe County (the county's map service, one layer per flight). 1930–2000 where an agency has scans online. | An ordinary tile layer (`js/tiles.js`). Picking the year is instant. |
| **Reads** | 2004, 2006, 2010, 2012, 2014, 2016 outside Arapahoe County | Read out of DRCOG's raw GeoTIFFs with HTTP range requests (`js/tiffwindow.js`), as much of the middle of the view as 8 MB buys. |

2002 (JPEG 2000) and 2008 (MrSID) exist only as files a browser cannot open, so outside
Arapahoe County they are not on the timeline. Which archive file is under the view comes
from DRCOG's tile index, baked into `data/index/{year}.json` by `scripts/bake_index.mjs`.

## Bandwidth

One layer (the year on show is the map), tiles at one image pixel per CSS pixel first,
nothing fetched mid-gesture, full screen density only after the map rests zoomed in (the
`HD` switch on the timeline), and everything fetched kept in the browser. The meter on
the timeline shows what the visit has cost. Details: [docs/design.md](docs/design.md),
*What keeps it cheap*.

## Saving

**Save** gives the view as a JPEG, or every year that can be shown here as a zip with a
`CREDITS.txt`. **Link** copies the address of the exact view:
`#ll=lat,lon&z=zoom&y=year` (`y=2014-2024` opens compare).

## Development

Build-free static HTML/JS: there is nothing to compile. `package.json` is dev tooling
only (jsdom for the smoke test); never import `node_modules` from `js/`.

```
npm install            # jsdom, once, dev only
npm run serve          # python http.server on :8765 (file:// won't do for fetch)
npm run probe          # hit every upstream source
npm run smoke          # jsdom smoke test of the page, network stubbed
node scripts/bake_index.mjs   # refresh the baked tile index in data/index/
```

## Deploy

Cloudflare Pages, project `drapp`, by direct upload; a merge does not deploy by itself.
Upload `index.html`, `favicon.svg`, `css/`, `js/` and `data/`. `index.html` links each
script and stylesheet with `?v=` and a date: change that date in the same commit as any
script or stylesheet change, or a returning browser runs the new page with old scripts.

## Sources, credits and license

Every source, its extent and its licence note are in `js/sources.js` and under *About* on
the page. None is a documented public API; `npm run probe` is how you notice one change.

Aerial photographs and tile index: [DRCOG Regional Data Catalog](https://data.drcog.org),
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/); 2018–2026 mosaics hosted by
Sanborn for DRCOG. Other years: [Arapahoe County](https://gis.arapahoegov.com/arcgis/rest/services/Aerials/MapServer),
[Boulder County](https://maps.bouldercounty.org/arcgis/rest/services/RASTER), South Metro
Fire Rescue, the Colorado Department of Transportation, and the
[Denver Public Library](https://history.denverlibrary.org/maps/time-travelers/) (the 1933
aerial survey). Ground outside the region: Esri World Imagery (Esri, Maxar, Earthstar
Geographics). Addresses: U.S. Census Bureau geocoder and [Nominatim](https://nominatim.org),
© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).
Libraries: [Leaflet](https://leafletjs.com), [proj4js](https://github.com/proj4js/proj4js),
[geotiff.js](https://github.com/geotiffjs/geotiff.js). Site code: MIT.
