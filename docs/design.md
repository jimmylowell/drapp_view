# Denver Aerials: design

What the page is and how it behaves. How it came to be this way is in
[loading.md](loading.md), which is history.

## What it is for

Jimmy, 2026-11-12: "a clean way to view and show off the high res drapp stuff for
denver residents. the timeline was a secondary feature, but really a big one …
user should be able to browse around without downloading/killing bandwidth, find an
area they want to explore through the years, and be able to save photos downloaded.
panning/zooming should not kill bandwidth immediately."

- **The first screen** is the photograph, edge to edge: Union Station in 2024. The one
  action on it is moving the map.
- **Who it is for:** someone who lives in the Denver region and wants to see their
  block, now and before.
- **The three things it does:** browse the newest photographs down to 3 in a pixel;
  step, play or compare the same ground through the years; save what is on screen.
- **What it will not do:** no account, no server of its own, no measuring or drawing
  tools, no fetching while the map is moving, no year loaded that was not asked for.

## The screen

- **Top left:** one search box (address, place, or `lat, lon`), a locate button, and a
  short list of places to start when the box is empty.
- **Top right:** Compare, Save, Link, About.
- **Bottom:** the timeline. The year on show in large type, where it comes from and how
  sharp it is, what the visit has downloaded, and one chip per year **that exists where
  the map is centred**. A solid chip is instant. A dashed chip is a year that has to be
  read out of DRCOG's archive for this view.
- **Compare** splits the map with a draggable divider, older year on the left. The year
  tag on each half says which half the timeline is driving.
- Arrow keys step years, space plays, `c` compares, `/` goes to search.

## Two kinds of year

| | Years | How it arrives |
|---|---|---|
| **Tiles** | 2018–2026 region-wide (DRCOG's mosaics on Sanborn's server; 2026 is the interim mosaic). 1998–2026 inside Arapahoe County (the county's map service, one layer per flight). 1930–2000 where an agency has scans online. | An ordinary tile layer (`js/tiles.js`). Picking the year is instant. |
| **Reads** | 2004, 2006, 2010, 2012, 2014, 2016 everywhere outside Arapahoe County | No server renders these. The page reads the view out of DRCOG's raw GeoTIFFs with HTTP range requests (`js/tiffwindow.js`) and leaves it on the map as a patch. |

2002 (JPEG 2000) and 2008 (MrSID) exist only as files a browser cannot open, so
outside Arapahoe County they are not on the timeline.

Whether a spot is inside Arapahoe County is asked of the county's own service: one
16 px export, remembered per half-mile cell (`inArapahoe` in `js/app.js`). Its extent
box takes in half of Denver, where it answers blank.

## What keeps it cheap

Measured 2026-11-12 on the 2024 mosaic downtown: a 512 px tile is about 75 KB at JPEG
quality 75 and 170 KB at 95; at twice the pixels, 230–360 KB.

1. **One layer.** The year on show is the map. There is no base map under it inside
   the region. (Before: a base map, the newest mosaic and the year on show were all
   fetched for the same ground.)
2. **A tile first arrives at one image pixel per CSS pixel, quality 78.** A desktop
   screen is about 0.6–0.9 MB.
3. **Nothing during a gesture.** Tiles are fetched when the map stops (on a phone) or
   at most every 350 ms (desktop), never mid-zoom, and each waits 120 ms before it is
   asked for, so zooming through five levels fetches the last one. A tile that leaves
   the view before it lands is aborted.
4. **HD is a second step, and a switch.** On a high-density screen, once the map has
   rested 1.5 s at zoom 19 or closer, the tiles on screen are asked again at the
   screen's own density, never finer than the source's 3 in. About three times the
   data. The `HD` button on the timeline turns it off; it starts off when the browser
   reports data-saver.
5. **Everything fetched is kept.** Tiles go into Cache Storage (`drapp-tiles-v1`, 6,000
   tiles, oldest fifth dropped past that); archive reads into IndexedDB. The county
   service sends `no-cache` and the mosaics keep twelve hours, so without this the same
   block costs the same every visit.
6. **The meter** on the timeline shows what the visit has downloaded.

## Reading an older year

The archive files are uncompressed, one image row to a request, four bytes a pixel for
the 3 in years. A read costs the ground covered times the detail, and skipping rows
does not skip the bytes across a row. So:

- A read is at the screen's own density if 8 MB covers the view that way, otherwise at
  one image pixel per CSS pixel; never finer than the file.
- It is **as much of the middle of the view as 8 MB buys** (`readPlan` in `js/app.js`):
  the whole screen when zoomed in close, a block in the middle further out.
- Under 200 screen pixels a side a block is not worth it. A year that was just picked
  then moves the map in a level at a time until it fits, and loads; after a pan the
  button reads *Zoom in to load*.
- **Picking a year is the okay for one read.** After a pan or zoom nothing is read
  until *Load here* is tapped, and the button says the size first.
- With a block loaded, *Load the whole view* offers the rest, up to 40 MB, with its size.
- The read paints as it arrives. Around it, the last mosaic looked at is drawn dimmed
  and grey, so there is ground to steer by.

**Which file is under the view** comes from DRCOG's tile index, baked into
`data/index/{year}.json` by `scripts/bake_index.mjs`: tile name, box, flight date,
resolution, link — the index's own fields, nothing derived. The page loads one year's
file (60–190 KB compressed) the first time that year is picked. The live query is the
fallback for a year with no baked file. On 2026-11-12 DRCOG's query endpoint hung for
an hour while the archive was fine; with the index baked, that no longer stops a read.

## Saving

- **This year, as a photo:** a mosaic year is asked for once, straight from DRCOG's
  server, for the view on screen at the screen's density (never finer than 3 in),
  JPEG quality 95. Any other year is what is on the map, redrawn on a canvas. On a
  phone it goes through the share sheet, which is how a picture reaches the photo
  library.
- **Every year here:** one photo per year that can be shown here without a read, in a
  zip (`js/zip.js`, stored not compressed) with a `CREDITS.txt`. Years that would need
  a read and have not had one are named as left out.
- **Link** copies the address of the exact view: `#ll=lat,lon&z=zoom&y=year` (two
  years, `y=2014-2024`, opens compare).

## Sources

Every source, its extent and its licence note are in `js/sources.js` and listed under
*About* on the page. `npm run probe` checks the upstreams. None of them is a documented
public API; if one dies its years drop off the timeline and the rest still draw.

## Denver itself between 1933 and 2000

Central Denver has one year before DRAPP that a browser can draw: 1933, the King survey. Every pre-2000 layer on the timeline belongs to a neighbour, and
each one answers central Denver with a 404 or a blank tile (checked 2026-11-13 at Union
Station, City Park, Washington Park and Stapleton): South Metro Fire Rescue's decade
caches stop at the district, Arapahoe County's 1998 and 2000 layers draw only inside the
county, and Boulder's and CDOT's scans are one county or one town each.

The photographs exist. They are prints, film or files behind a login, not map tiles.

| Source | What it holds for Denver | Why it is not on the timeline |
|---|---|---|
| [Denver Public Library, *Aerial Imagery of Denver and Colorado*](https://history.denverlibrary.org/research/aerial-imagery-denver-and-colorado) | 1937 (Denver's edges only), 1960, 1966, 1969 (Adams County), 1970, 1972, 1971–1973 (statewide), 1974, 1988, 1993, and Landiscor atlases 1984–2003 | Prints, negatives and bound atlases in Special Collections, browsed in person. Only 1933 is online as tiles |
| [The library's Time Traveler's Map](https://history.denverlibrary.org/maps/time-travelers/) (its layer list is [`Denver.json`](https://history.denverlibrary.org/maps/time-travelers/Denver.json)) | 1933 King, plus 1939, 1965, 1971, 1980 and 1994 USGS layers | The USGS layers are topographic maps, not photographs |
| [USGS EROS: Digital Orthophoto Quadrangles](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-digital-orthophoto-quadrangle-doqs) | Orthophoto quadrangles at 1 m, black and white, colour or colour-infrared; which years cover Denver is unknown until searched with an account | Downloaded from [EarthExplorer](https://earthexplorer.usgs.gov/) as files; the download API ([`m2m.cr.usgs.gov`](https://m2m.cr.usgs.gov/)) refuses a request without a USGS account. No tile service. To be on the timeline they would have to be fetched with an account, cut into tiles and hosted for the page |
| [USGS EROS: National Aerial Photography Program](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-aerial-photography-program-napp) and single frames | Frames | Unrectified single frames: placing them on the map would be our guess, not the record's |
| [The National Map download API](https://tnmaccess.nationalmap.gov/api/v1/datasets) | No orthoimagery over Denver before 2001; NAIP starts later | Nothing to show |
| [USGS imagery map services](https://imagery.nationalmap.gov/arcgis/rest/services) | NAIP only | Nothing before 2000 |
| [DRCOG data catalogue](https://data.drcog.org/data) | DRAPP, which starts in 2002 (the library's guide says so) | Nothing before 2002 |
| City and County of Denver: [its ArcGIS Online tiles](https://tiles.arcgis.com/tiles/zdB7qR0BtYrg0Xpl/arcgis/rest/services) and `denvergov.org` | 2016 and 2018 aerials; `denvergov.org/16p26p/…/AerialImagery` answers 404 and `denvergov.org/arcgis` closes the connection | Nothing before 2016 |
| [CDOT's ArcGIS Online scans](https://tiles.arcgis.com/tiles/yzB9WM8W0BO3Ql7d/arcgis/rest/services) | 1944–1960 town scans: Golden, Boulder, Englewood–Littleton, Fort Collins, Greeley, Pueblo and others | None covers Denver |
| [Arapahoe County aerials](https://gis.arapahoegov.com/arcgis/rest/services/Aerials/MapServer) | 1998–2026, one layer per flight | Draws only inside the county; blank over central Denver |
| [Boulder County rasters](https://maps.bouldercounty.org/arcgis/rest/services/RASTER) | 1977 and 2000 | Boulder County only |
| [Jefferson County image services](https://gisportal.jeffco.us/image/rest/services) | DRAPP 2006–2022 | Jefferson County only, and nothing before 2006 |
| [Lakewood](https://egis.lakewood.org/server/rest/services) | 2018 and 2020 | Nothing before 2000 |
| [State of Colorado public imagery on AWS](https://registry.opendata.aws/colorado-imagery/) | NAIP 2005 on, DRAPP 2010 on; its historic folders are the Arkansas basin | Nothing for Denver before 2005 |
| ArcGIS Online catalogue, searched by text and by a box over central Denver | Only the layers above | — |
| [historicaerials.com](https://historicaerials.com/terms) | A commercial viewer | Its terms forbid displaying or redistributing the imagery |

The one route found to more Denver years on the timeline is the USGS orthophoto
quadrangles: a USGS account to fetch them, then tiles baked and hosted for the page.
No other georeferenced public copy of Denver between 1934 and 2000 turned up.

## How to know it is right

- `npm run smoke` passes.
- Downtown at zoom 17 on a desktop: first screen under 1 MB; dragging the map fetches
  nothing until release on a phone.
- Picking 2014 downtown shows 2014 within a few seconds without another tap.
- In Centennial every year from 1953 to 2026 is a solid chip.
- *Save → Every year here* downloads a zip that opens, one JPEG per year.
