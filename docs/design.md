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

- A read is at the screen's own density, never finer than the file.
- It is **as much of the middle of the view as 8 MB buys** (`readPlan` in `js/app.js`):
  the whole screen when zoomed in close, a block in the middle further out. Under 260
  screen pixels a side it is not worth it and the page says to zoom in.
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

## How to know it is right

- `npm run smoke` passes.
- Downtown at zoom 17 on a desktop: first screen under 1 MB; dragging the map fetches
  nothing until release on a phone.
- Picking 2014 downtown shows 2014 within a few seconds without another tap.
- In Centennial every year from 1953 to 2026 is a solid chip.
- *Save → Every year here* downloads a zip that opens, one JPEG per year.
