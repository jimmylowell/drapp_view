# Denver Aerials (drapp_view): design

**Written after the fact (2026-11-04), from the code and `README.md` as they stand on `main`, for Jimmy's pushback.** drapp_view was built before the design-first method, so this note describes what exists rather than what was planned. Where the code and this note disagree, the code is right and this note is wrong; say so and it gets fixed. From here on, a feature goes into this file before it goes into code. `README.md` stays the technical reference (how each year is read, sharpness, the source inventory); this note is the product.

## The first screen

A Leaflet map of the Denver region (`js/app.js`, centred at 39.74, −105.0, zoom 10) under one box: **an address field and Go**, a locate button, and the square's width (150 / 300 / 600 / 1200 ft, 300 by default). Below the map, *Where this comes from* credits every source.

**The one action:** type an address (or `lat, lon`) and press Go. The newest year fades in on that square first, the rest load one at a time behind it, and ‹ › step through the years. A link with `#q=` or `#ll=` in the hash opens straight onto an address.

## Who it is for

Anyone in the Denver region curious how their block, house or neighbourhood looked in past years. In the first five seconds they see a map and a box asking for an address.

## The three things it does

1. **Every DRAPP year at one address:** looks up the right tiles in DRCOG's per-year tile index and reads only the pixels around the address out of the public archive, in the browser, with no server of its own.
2. **Further back where someone flew it:** older flights from Arapahoe and Boulder counties, South Metro Fire Rescue, CDOT and the Denver Public Library (back to 1930), each saying which town or county it covers when the address is outside it.
3. **Every year on the same ground square:** all years render onto one Colorado State Plane Central grid before they are warped onto the map, so features line up year to year; *Save all years* downloads one PNG contact sheet.

## What it does not do

- No server, no account, no stored copy of the imagery: every pixel is read from the agencies' own services, and rendered squares are cached only in the visitor's browser (IndexedDB).
- Does not decode 2002 (JPEG 2000) or 2008 (MrSID); outside Arapahoe County those years offer the tile downloads instead.
- Does not stream more than the square on its own: anything bigger is offered by *Load this view* with its cost (requests, bytes, a time guess) and fetched only when ticked, and not past 2 miles wide.
- Does not draw maps that are not photographs (the library's old street maps, USGS topos); `README.md` *Source inventory* says why.
- Covers the Denver region only.

## What it looks like

Map full width with floating panels (address top, years, base-map picker bottom-left), `css/site.css`. Build-free static HTML/JS with vendored libraries, like colorado_water. No reference site was named when it was built.

## Roadmap

Nothing was written at build time. The repo's `TODO.md` lists ideas: more dates, the Denver Public Library's Time Traveler's Map, library or book material about neighbourhoods, more sources and plugins, state-level sources. The finish lines agreed 2026-11-04 treat those as **the next version, not part of final**. Final is: resolves at drapp.myjimmycloud.com (no DNS record yet; fixed by the zone move), this note, and a link from the front page.

## What one record looks like

The unit is one rendered square for one year: a window on the state-plane grid and the picture of it, as stored in the browser cache (`js/cache.js`, keyed by `year|res|px×py|xmin|ymin`).

```yaml
year: 2022
res: 0.25            # feet per pixel, on DRAPP's 0.25 ft grid (js/proj.js)
px: 1200             # pixels across
py: 1200
xmin: 3140000.00     # window origin, EPSG:2232 (Colorado Central, US feet)
ymin: 1695000.00
blob: <JPEG, quality 0.95>
at: 1762300000000    # when it was cached (ms)
```

The numbers above are illustrative, not a real window.

## Data sources

Every source is fetched live by the browser; nothing is baked into the repo. Endpoints are in `js/sources.js` and `js/basemaps.js`, verified 2026-09-07 per `README.md`. None is a documented public API, and `npm run probe` is how a change is noticed.

| Source (author, link, licence) | What we use | How fetched | Known limits |
|---|---|---|---|
| DRCOG, [Regional Data Catalog](https://data.drcog.org), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/); the [Denver Regional Aerial Photography Project](https://drcog.org/data-maps-modeling/data-acquisition-projects) | Per-year tile index; raw GeoTIFF tiles 2004–2022 | Index: `gis.drcog.org/server/rest/services/RDC/TIFF_{Y}_INDEX/MapServer/0`; tiles from DRCOG's public S3 bucket `drapparchive` by HTTP range request | 2002 and 2008 are formats the browser cannot decode; 2024 not on the archive yet |
| Sanborn Geospatial, hosting DRCOG's mosaics, same licence | 2018–2024 mosaics | `drcog-data.sanborn.com` ArcGIS ImageServer `exportImage` | DRCOG has not published that these are meant for public use (`README.md`) |
| [Arapahoe County Aerials MapServer](https://gis.arapahoegov.com/arcgis/rest/services/Aerials/MapServer) | 1998–2026 county flights, incl. 2002 and 2008 | MapServer `export` | County only; 1998 western county only |
| [Boulder County RASTER services](https://maps.bouldercounty.org/arcgis/rest/services/RASTER) | 1977 and 2000 | MapServer `export` | County only |
| South Metro Fire Rescue, public ArcGIS Online tiles | 1950s–1990s by decade | Web Mercator tiles | Its district only; no description of the film's origin |
| CDOT, public ArcGIS Online tiles | Golden 1930, Boulder 1948, Englewood–Littleton 1953 | Web Mercator tiles | A few towns only; no description of the film's origin |
| Denver Public Library, [Time Traveler's Map](https://history.denverlibrary.org/maps/time-travelers/) | The georeferenced 1933 King aerial survey | Web Mercator tiles on ArcGIS Online | Central Denver only |
| U.S. Census Bureau geocoder; [Nominatim](https://nominatim.org), © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) | Address to point | JSONP; Nominatim as fallback | — |
| Bing (© Microsoft, Earthstar Geographics); Esri World Imagery and [Wayback](https://livingatlas.arcgis.com/wayback/); OpenStreetMap | Base maps under the square | Tile layers | Undocumented endpoints; the picker survives one dying |

The sentence-level claims (what each flight covers, its resolution) are the README's *Source inventory*, each read from the service itself on 2026-09-07; this note adds none.

## How Jimmy will know it is right

He types an address he knows and steps through every year, and the house, the trees and the street line up from one year to the next.
