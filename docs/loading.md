# How an image loads

**This file is history.** The page was rebuilt on 2026-11-12: one layer, a timeline, reads sized to a data budget, a baked tile index. What is true now is in [design.md](design.md). Everything below describes earlier versions (the square, "Load this view", the base map picker), kept for the measurements and the reasons.

Written 2026-11-05 after Jimmy's notes on the phone: "I'm confused on the feet buttons
what they do and I didn't really quite realize the date stuff was going on either. Need
a better way to tell what layer I'm looking at when they're loading. Can the default
test include the most granular detailed image?" and "We might have to look at how it's
downloading/streaming the hi-res photo".

## Years before 2006, and what the base map is (2026-11-11)

Jimmy (2026-11-11): "Loading dates prior to 2006 does not seem to be working", and "I'm
curious if the base map is using Drap itself these days".

**Why picked years did not load.** Picking an older year from the menu does not fetch
it; the "Load this view" prompt does. That prompt ticked a year only when nothing was
ticked yet, and kept the tick across picks. So after one older year had loaded (2016,
say), picking 2004 still offered "Load 2016", and tapping it fetched 2016 again and set
the year on show back to 2016. 2004 never came, whatever was tapped. Fixed in
`choose()` and `viewCheck()` (`js/app.js`): a pick ticks that year, and a ticked year
already tried for this view drops out (`doneHere()`), so a 1 ft year such as 1933 is not
offered again just because the screen could show finer.

**Smaller fixes in the same pass.**

- The label said "2004: idle" for a picked year not yet loaded; it now says "tap Load
  this view to read it", or "only Arapahoe County" (and so on) where the year has no
  source at all.
- Downtown, 2002 and 2008 said "Arapahoe County has nothing here": the county's 2002 and
  2008 layers have a rectangular extent that takes in downtown, but no pixels there. A
  blank answer from a county now falls through to DRCOG's own tile, which is there and
  is download-only: "JPEG 2000 — download only (≈8 MB)" for 2002, "MrSID — download only"
  for 2008.
- 2004 and 2006 said "3 in a pixel". DRCOG's archive files for both are 1 ft a pixel
  (the world files for tile `3140375_1695645` read `1.0` and `-1.0`, state-plane feet);
  the page drew them on a 3 in window. The label now says the file's own pixel, 1 ft.
  DRCOG's 2006 tile index says "6 Inch" for the same tile; the file is 1 ft, so the year
  menu's "6 in · 4/12/2006" (from the index) still disagrees with the label. Left as the
  index has it.

**What there is before 2006, by place** (from `js/sources.js`, checked 2026-11-11 at the
Capitol in headless Chrome, 390 px, device scale 2):

| Year | Downtown Denver | Where it does load |
|---|---|---|
| 2004 | yes, DRCOG archive, 1 ft, 11 requests, ~0.7 MB | most of the region; tile `3075375_1695645` (Golden) is indexed but the file is missing from DRCOG's bucket (HTTP 404) |
| 2002 | download only (JPEG 2000, ≈8 MB) | in the browser only inside Arapahoe County (county flight) |
| 2000, 1998 | no | Arapahoe County; 2000 also Boulder County |
| 1990s to 1953 | no | the South Metro fire district (Centennial to Parker); 1953 also Englewood and Littleton |
| 1977, 1948 | no | Boulder County; Boulder |
| 1933 | yes, 1 ft, Denver Public Library | central Denver |
| 1930 | no | downtown Golden |

So outside Arapahoe County, the south suburbs and Boulder, a person in Denver gets 2004,
then nothing until 1933. That is the sources, not the page.

**The base map is DRAPP.** The default, *Newest available*, is DRCOG's 2024 mosaic as
tiles (Arapahoe's 2026 flight on top inside that county, Bing aerial at half opacity
outside the region): `newestAvailable()` in `js/basemaps.js`. Under 2024 it is the same
pictures as the year on show, which is why the two look alike. To see the extra detail
of the aerials against an ordinary base map, the base map to pick is *Bing aerial* or
*Esri world imagery*, both about 9 in a pixel at their zoom 19 in Denver and stretched
past it, against DRAPP's 3 in. Whether to make one of those the default, or add a
side-by-side, is a look change and waits for Jimmy.

## Now: tiles at the map's own zoom (2026-11-06, third round)

Jimmy, on the phone, with a screenshot of the 1200 ft square zoomed in at the
Capitol (2026-11-05 23:58): "I can't tell the difference in quality here... The ft
buttons still don't make sense to me. I still don't understand why download a lower
res version at all? The notes saying to zoom in did make it better." And (00:13):
"So the feet button was a way to select the detail. I never really figured that out".

So the square and its sizes are gone, and the streamed years work like any web map.

- **2018, 2020, 2022 and 2024 are tiles** (`streamLayer()` in `js/basemaps.js`, shown by
  `showTiles()` in `js/app.js`): DRCOG's mosaic is asked for each 512 px map tile at the
  map's own zoom, at the screen's density, at JPEG quality 95. Zoom in and the pixels
  follow, down to the source's own 3 inches; past that zoom (20 on a phone, 21 on a
  plain screen) Leaflet stretches the finest tiles instead of asking again for the same
  pixels. No square, no coarse copy, no blurry stand-in, nothing to tap.
- **Each tile asks for the device pixels it lands on** (`tilePx()`): a 512 px tile on a
  phone is drawn on 1024 device pixels, so it asks for up to 1024, but never finer on the
  ground than 3 in (772 px at zoom 20 in Denver). Before this, every tile asked for its
  CSS size, so on a phone the tiles came in at half the screen's density.
- **Picking another streamed year** puts its tiles on top and takes the old year's off
  once the new ones have landed, so the screen never drops to the base map in between.
- **The label** says the pixel the tiles on screen carry ("2024 3 in a pixel · DRCOG
  mosaic"), "loading tiles…" while they come, and "zoom in for 3 in" when zoomed out.
- **The size buttons are gone.** "Square at map centre" is now **Every year here**: it
  loads every other year for the view on screen. An address does the same after moving
  the map there at the 3-inch zoom.
- **Older years** (2004–2016 from the archive, and the county and library flights) are
  still read as one window for the view, because the archive costs one range request
  per image row. They load at 3 in when the view is near the 3-inch zoom: the screen's
  3.2-inch device pixel at the phone's opening zoom used to round up to the next grid
  step, 6 in; anything under 1.5 times the source's pixel now takes 3 in. After a pan,
  **Load this view** is still their way in, and its note says 2018–2024 are not listed
  because they are on the map already.
- **Save PNG** for a streamed year asks DRCOG once for the view on screen at the screen's
  density (at most 4096 px a side); **Save all years** does the same per streamed year
  at up to 1536 px.

### Checked (2026-11-06, headless Chrome, 390 × 844 px at device scale 2, no cache)

| Step | Requests to DRCOG's mosaic | Bytes | What the label said |
|---|---|---|---|
| Opening view, Capitol, zoom 19.5 | 6 year tiles at 772 px, plus 6 base-map tiles at 772 px | 1,179 KB year, 492 KB base | 2024 3 in a pixel · DRCOG mosaic |
| Zoomed all the way in (22), 2024 | 0 (the zoom-20 tiles, stretched) | 0 | 2024 3 in a pixel |
| Then 2022 | 1 tile, 772 px | 166 KB | 2022 3 in a pixel |
| Then 2020 | 1 tile, 772 px | 191 KB | 2020 3 in a pixel |
| Then 2018 | 1 tile, 772 px | 237 KB | 2018 3 in a pixel |
| Every year here, opening view | 4,740 requests in all (archive rows, index, county services) | 21.8 MB, 86 s | 2016, 2014, 2010 at 3 in; 2012 and 2006 at their own 6 in |

Every 2018–2024 year showed 3 in at the Capitol with no tap. No console errors; the
page is 390 px wide. At zoom 22 a hairline showed where stretched tiles meet; half a
pixel of overlap in `css/site.css` closed it. Before the row fix, Every year here read
the archive at 6 in: 3,038 requests, 13.6 MB, 62 s.

### Which base maps stretch past their own detail

The base map is under the year on show, and what you see when a year is not there.

| Base map | Finest it serves | Past that |
|---|---|---|
| Newest available, and *This region, by year* 2018–2024 | 3 in (the same tiles as above, at the default JPEG quality) | stretched past zoom 20 on a phone, 21 on a plain screen |
| *This region, by year*, county years | each flight's own pixel (`res` in `js/sources.js`) | stretched |
| Bing aerial, Bing road, Esri world imagery, Esri by year, OpenStreetMap | their zoom 19: about 9 in a tile pixel in Denver | stretched from zoom 19 to 22 (`maxNativeZoom: 19`) |

On Jimmy's question (2026-11-06 01:44): "Is it possible the base layer was using the
same trap? It was so similar." Partly yes, and the reply that night said no. The DRCOG
base map never loaded a coarse copy, but its tiles asked for their CSS size, so on a
phone they came at half the screen's density: 6 in at the opening zoom, 3 in only past
zoom 20.6. The same density fix now applies to it. Bing and Esri do stop at their zoom
19 and stretch past it.

## Before: the square, the preview and the sharpening (2026-11-05)

Kept for the record; all of it is gone since the third round.

### What the page fetches, in order

Measured in headless Chrome at 390 px (device scale 2) and 1280 px from the XPS on
2026-11-05, opening view, no cache.

1. **The base map.** The default base map is the newest DRAPP mosaic drawn region-wide
   (`js/basemaps.js`), as 512 px `exportImage` tiles of 20–60 KB each, at whatever zoom
   the map is on. Arrives in under a second. It is the coarse picture under everything.
2. **The year on show, as one image.** A streamed year (2018–2024) is a single
   `exportImage` request for the whole window: 843 × 1697 px and 490 KB on the phone's
   opening view, 1371 × 797 px and 369 KB on the laptop. A JPEG drawn through an `<img>`
   shows nothing until the last byte, so before this change the screen sat on the base
   map, then switched to the sharp image all at once. On a fast line that is about a
   second; on a phone signal it is several, with nothing saying what was going on.
3. **Older years** (2004–2016) are read row by row from DRCOG's raw GeoTIFFs on S3,
   one range request per image row: 1,201 requests, 5.8 MB and 19 s for a 300 ft square
   of 2014 at the Capitol. They have a progress bar in the year menu, but nothing on
   the map said which year was on screen while they read.

### The finest year

Every DRAPP year from 2010 on is 3 inches (0.25 ft) a pixel where it matters; that is
the finest the programme flies. 2024's mosaic service reports `pixelSizeX` 0.25 ft
(checked 2026-11-05 at `DRCOG_2024/DRCOG_Final_Ortho_2024/ImageServer?f=json`), so the
opening view, which loads 2024 at 3 inches, is already the most detailed image there
is. Arapahoe County's 2026 flight is also 3 inches but covers only that county, not the
Capitol.

### What changed

- **A label on the map** (`#ov-badge`, `paintBadge()` in `js/app.js`) under the address
  panel says which year is on screen, at what pixel size, from which source, and while a
  year is still coming: "2024 streaming the 3 in image… — the base map shows meanwhile",
  then "2024 blurry preview, 3 in on its way", then "2024 3 in a pixel · DRCOG mosaic".
  Picking a year that is still reading says so after the one on screen ("2014: next up").
- **A blurry stand-in first.** A streamed window bigger than 600² px asks for the same
  window 4× coarser alongside the sharp one: a sixteenth of the pixels, 51 KB against
  490 KB on the phone's opening view. It lands first, is drawn scaled up, and the sharp
  one replaces it in place. If the sharp one lands first the preview is dropped. One
  extra small request per streamed year.
- **The size buttons** sit under "Every year, in a square" with "across" after them, and
  each has a title. On the opening view (no address yet) a tap used to do nothing; it
  now loads that square at the map centre (the Capitol, if the map has not moved), and
  no size looks pressed until a square is on the map.
- **The year picker** reads "Year 2024", not "2024" or "Years".

### Zooming into a coarse year (2026-11-05, second round)

Jimmy, on the phone: "I'm having a hard time understanding what layer I'm looking at.
Can you explain to me if drap is downloading lower resolutions at all? That would not
be ideal as the entire point is to show the crazy detail of these aerial images".

**Yes, it was.** The 150 and 300 ft squares and the opening view load 3 inches a pixel.
Everything wider loads coarser, on purpose, to keep one request a sensible size: a 600 ft
square on a phone loads at 6 in, a 1200 ft square at 1 ft (`squareRes()`: the screen's
pixels, at least 1200, at most 2048 for a streamed year), and a loaded map view is at
most 4096 px a side (`CAP_VIEW`), so anything wider than about 1,000 ft of 3-inch pixels
comes in coarser. Zooming into it only enlarged those coarse pixels: the "Load this
view" prompt came back only once the screen wanted pixels 1.5× finer, and it needed a
tap.

**Now** a streamed year (2018–2024) that is coarser than the screen wants is asked again
for just the spot on screen, at the screen's density, 3 in once you are zoomed all the
way in, and that patch is laid over the coarse image (`sharpen()` in `js/app.js`). One
`exportImage` request, the same as the first; it runs 250 ms after the map stops moving.
The patch is kept per year, so flipping between years does not fetch it again; a new
square or view drops it. Archive years (2004–2016) still need the "Load this view" tap,
because they cost one request per source row (1,200 requests and ~6 MB for 300 ft at
3 in).

Checked in headless Chrome at 390 px (device scale 2), 2024 at the Capitol: the 1200 ft
square loads at 1 ft; zoom 20 fetches the dome's spot at 3 in in under a second; zooming
back out returns the label to 1 ft. No console errors.

**The label** now says, under the year:

- "1 ft a pixel · DRCOG mosaic — coarser than the source, zoom in for 3 in" when what is
  on screen is coarser than the year's source (archive years: "zoom in and load this view
  for 3 in"); the source's pixel is the year's layout (`js/sources.js`), 3 in for 2010 on
  and 1 ft for 2004;
- "fetching this spot at 3 in…" while the patch is coming;
- "3 in a pixel · DRCOG mosaic, sharpened for this spot" once it is in;
- and a second line naming the base map under it in plain words, for example "Base map
  under it: newest DRCOG photos, as tiles" (the default, which is coarse map tiles, not
  the year's own pixels).

### Not done then, and why

- **Tiling the sharp image** so it fills in piece by piece: more requests to DRCOG's
  server for the same pixels, and the preview already covers the wait.
- **A progressive JPEG** would also sharpen as it streams, but the ArcGIS service decides
  the encoding; the request has no option for it.
