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
- **Bottom:** the timeline, one row: back, play, forward, the year on show in large type
  with where it comes from and how sharp it is, and what the visit has downloaded. The
  year is a button that opens a list of the years **that exist where the map is
  centred**, newest first, each with a small note of who serves it there (USGS, DRCOG,
  DRCOG archive, a county) and how much ground one pixel covers there, as the source
  records it (for a USGS year, the coarser of its middle frame's scan and its deepest tile). A year in dim type has to be read out of DRCOG's archive for
  this view. **Blurry years fold away.** A year whose pixel here covers more than a metre of
  ground (over 3 ft: the coarse USGS scans, the decade caches) is left out of the list,
  the arrows and play, behind one row at the foot of the list, "Show n blurry years".
  The choice is remembered in the browser. The year on show is never left out, so a
  link to a blurry year opens it, and *Save → Every year here* still saves them all. (Was a row of chips, one per year; a list is shorter on a phone and has
  room for the source.)
- **Compare** splits the map with a draggable divider: side by side with the older year
  on the left, or stacked with the older year on top. A screen taller than it is wide
  (a phone held upright) opens stacked, so each half keeps the full width; the round
  button by the divider's handle turns it the other way for the rest of the visit. The
  handle and that button sit at the end of the line, clear of the picture: at the top
  side by side, at the right edge stacked. The year tags stay away from the line too:
  side by side at the top corners, stacked at the far end of each half (the older at the
  top, the newer just above the timeline). The year tag
  on each half says which half the timeline is driving, and under the year whose picture
  it is; a tap on a tag drives that half and opens the year list for it at once.
- **Satellite** is in the year list while comparing, and only then: Esri World Imagery as one
  side, so DRAPP's detail can be set against a satellite base map. It is never a year on
  the timeline, never played, never saved (the imagery is Esri's). Its tag and the line
  under the year give the satellite, its own pixel and the day, read from Esri's records
  at the view's centre: the World Imagery MapServer `identify` on the "15cm Resolution
  Metadata" layer (what level 20 draws) or "30cm Resolution Metadata" (levels 12–19),
  fields `NICE_DESC`, `SRC_DESC`, `SRC_RES`, `SRC_DATE`, with `SRC_ACC` as a tooltip.
  Esri's credit line shows under the timeline while it is on. Its tiles stop at level 20;
  level 21 is Esri's "Map data not yet available" tile. In a link it is `esri`
  (`y=2024-esri`). Google's imagery cannot be a side: its terms allow it only in its own
  embedded map.
- Arrow keys step years, space plays, `c` compares, `v` turns the split, `/` goes to
  search.

## Two kinds of year

| | Years | How it arrives |
|---|---|---|
| **Tiles** | 2018–2026 region-wide (DRCOG's mosaics on Sanborn's server; 2026 is the interim mosaic). 1998–2026 inside Arapahoe County (the county's map service, one layer per flight). 1930–2000 where an agency has scans online. 1939–1991, 1993–94, 1999 and 2002 around central Denver from USGS (below). | An ordinary tile layer (`js/tiles.js`). Picking the year is instant. |
| **Reads** | 2004, 2006, 2010, 2012, 2014, 2016 everywhere outside Arapahoe County | No server renders these. The page reads the view out of DRCOG's raw GeoTIFFs with HTTP range requests (`js/tiffwindow.js`) and leaves it on the map as a patch. |

DRCOG's own 2002 (JPEG 2000) and 2008 (MrSID) files are in formats a browser cannot
open. 2002 draws across central Denver from the copy USGS holds (below); 2008 is on
the timeline only inside Arapahoe County.

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

## The USGS years

Nineteen years around central Denver come from the U.S. Geological Survey, downloaded
from [EarthExplorer](https://earthexplorer.usgs.gov/) and tiled for this page.

| Years | What USGS holds | What was done to it |
|---|---|---|
| 1939, 1953, 1963, 1964, 1969, 1970, 1971, 1972, 1975, 1978, 1979, 1980, 1983, 1984, 1988, 1991 | [Aerial photo single frames](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-aerial-photo-single-frames), NHAP and NAPP frames: scans of the film, with no map position of their own | Each frame placed by matching it against the USGS orthophotos of 1993 to 1999 and the years already placed, newest to oldest; a year's frames joined into one picture; cut into tiles |
| 1993–94, 1999 | [Digital orthophoto quarter quads](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-digital-orthophoto-quadrangle-doqs), 1 m, black and white, on coordinates as published. 1993–94 is one set, each quad dated by its newest photo | Cut into tiles, nothing else |
| 2002 | DRCOG's April 2002 orthoimagery, 0.3 m colour, which USGS holds as high resolution orthoimagery | Cut into tiles, nothing else |

**The label rule.** A placed year is measured inference, not a record: nothing USGS
publishes says where a frame's pixels fall on the ground. So wherever a placed year is
named it reads "aerial photos, placed by matching, *n* m held out", where *n* is that
year's error at its middle frame, in metres, measured at check points the fit was not
given (1.9 m for 1991 to 4.3 m for 1979; each year's number is in `js/sources.js`). A
frame over 8 m is left out. Nothing is filled in where no frame lies: the tile is
transparent. The three years USGS already publishes on coordinates carry no such note.

**Where the tiles are.** Each year's tiles (WebP, 256 px, zoom 10 to 17, 16 for the
coarse scans, 18 for 2002) are packed into one [PMTiles](https://github.com/protomaps/PMTiles)
file in our own Cloudflare R2 bucket, `drapp-tiles`, served at
`drapp-tiles.myjimmycloud.com`. The page reads a tile as a slice of its year's file
with an HTTP Range request (`pmBlob` in `js/tiles.js`, the vendored reader in
`js/vendor/pmtiles.js`), through the same store and meter as every other tile. A cache
rule on that address lets Cloudflare answer a slice it has served before. Cloudflare
caches no file over 512 MB on the Free plan
([default cache behaviour](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)),
so 1970, 1971 and 2002 are two files each: every zoom but the deepest, and the deepest
alone (`<name>-z17.pmtiles`, `-z18` for 2002). The bucket's CORS rule is
`ci/r2-cors.json`. The files are made from the scans on the build machine; they are
not in this repo.

**The page that explains it.** `placing.html`, linked from *About* by a row of its own under the opening paragraph (and again inside the USGS item): how one 1991 frame
went from scan to map, in six steps with pictures of that frame; why the years were placed
newest to oldest; every year's flight dates, photographs placed and held-out miss, from
the placing runs' records; where it is weak; what it does not do. The map itself stays
as it is: *About* is a short list of how each group of years arrives, and the detail
lives on this page. Its pictures are in `img/placing/`.

Where a USGS year and a neighbour's scan share a key (1953, 1970, 1980), USGS is tried
first: where the first source of a year has a picture, that is the picture, and a later
source is drawn only where the earlier ones have none (a later tile is not even asked for
where the earlier tiles at that spot are solid photograph). The tag and the line under the
year name the source drawn at the middle of the map. A decade key reads as its year ("1970", not "1970s") where the USGS year covers
the middle of the map.

## Where a year ends

Every year has a real edge, and it is drawn as a dashed line in the accent colour. The
edge is **where the year's sources actually have picture**, not the box a service
publishes: `scripts/bake_outlines.py` asks each source (our own tile files, the cached
tile services, the counties' map services, DRCOG's mosaics, and the archive's index)
where it has picture, lays the answers on one grid and joins them, so a year has one
edge whatever its sources are. The result is `data/outlines.json`, a few rings of
latitude and longitude a year, fetched once when a year is first shown.

**No blank fill.** A county's map service paints white where it has no picture, and the
1933 tiles paint black. The same file holds each outside service's own shape, shrunk by
a pixel or two, and its layer is cut along it (a CSS clip in map pixels, set again when
the zoom changes), so the fill never shows and today's picture, dimmed, shows instead.
A view that runs past a year's edge counts as not filled, which is what brings that
picture up underneath.

When the edge is on screen a note says what the line is and what lies past it (today's
picture, dimmed); while comparing, the note stays away and the line shows on its own
side. The line holds nothing in: the map moves freely across it.

The edge is as good as the grid it was read on: about 10 m for our own tiles, 15 to
30 m for the tile and map services, 60 to 100 m for the mosaics. A county's map service answers white
where it has no picture, so there the edge is where the white begins.

## Denver itself between 1933 and 2000

Apart from the USGS years above, central Denver has one year before DRAPP that a browser can draw: 1933, Jasper King's survey, [georeferenced by the City and County of Denver](https://history.denverlibrary.org/research-tool/1933-king-aerial-survey-denver) (the tile service credits the City of Denver Open Data Catalog). Every other pre-2000 layer on the timeline belongs to a neighbour, and
each one answers central Denver with a 404 or a blank tile (checked 2026-11-13 at Union
Station, City Park, Washington Park and Stapleton): South Metro Fire Rescue's decade
caches stop at the district, Arapahoe County's 1998 and 2000 layers draw only inside the
county, and Boulder's and CDOT's scans are one county or one town each.

The photographs exist. They are prints, film or files behind a login, not map tiles.

| Source | What it holds for Denver | Where it stands |
|---|---|---|
| [Denver Public Library, *Aerial Imagery of Denver and Colorado*](https://history.denverlibrary.org/research/aerial-imagery-denver-and-colorado) | 1937 (Denver's edges only), 1960, 1966, 1969 (Adams County), 1970, 1972, 1971–1973 (statewide), 1974, 1988, 1993, and Landiscor atlases 1984–2003 | Prints, negatives and bound atlases in Special Collections, browsed in person. Only 1933 is online as tiles |
| [The library's Time Traveler's Map](https://history.denverlibrary.org/maps/time-travelers/) (its layer list is [`Denver.json`](https://history.denverlibrary.org/maps/time-travelers/Denver.json)) | 1933 King, plus 1939, 1965, 1971, 1980 and 1994 USGS layers | The USGS layers are topographic maps, not photographs |
| [USGS EROS: Digital Orthophoto Quadrangles](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-digital-orthophoto-quadrangle-doqs) | Orthophoto quadrangles at 1 m, black and white, colour or colour-infrared; over Denver, 1993–94 and 1999 in black and white | On the timeline: fetched from [EarthExplorer](https://earthexplorer.usgs.gov/) with a USGS account, cut into tiles and hosted (*The USGS years*). USGS itself offers no tile service for them | for the page |
| [USGS EROS: National Aerial Photography Program](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-aerial-photography-program-napp) and single frames | Frames from 1939 to 1991 | On the timeline, placed by matching and labelled with each year's measured error (*The USGS years*) |
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

USGS is the one route found to Denver between 1934 and 2000, and it is taken. No
other georeferenced public copy turned up; the years it lacks are in library prints.

## How to know it is right

- `npm run smoke` passes.
- Downtown at zoom 17 on a desktop: first screen under 1 MB; dragging the map fetches
  nothing until release on a phone.
- Picking 2014 downtown shows 2014 within a few seconds without another tap.
- In Centennial every year from 1953 to 2026 is a solid chip.
- At the Capitol, 2002, 1999, 1993–94, 1991, 1971 and 1939 each draw, and each placed
  year's line reads "USGS · aerial photos, placed by matching, n m held out".
- A second request for the same slice of a year's file answers `cf-cache-status: HIT`.
- *Save → Every year here* downloads a zip that opens, one JPEG per year.
