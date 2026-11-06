# How an image loads

Written 2026-11-05 after Jimmy's notes on the phone: "I'm confused on the feet buttons
what they do and I didn't really quite realize the date stuff was going on either. Need
a better way to tell what layer I'm looking at when they're loading. Can the default
test include the most granular detailed image?" and "We might have to look at how it's
downloading/streaming the hi-res photo".

## What the page fetches, in order

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

## The finest year

Every DRAPP year from 2010 on is 3 inches (0.25 ft) a pixel where it matters; that is
the finest the programme flies. 2024's mosaic service reports `pixelSizeX` 0.25 ft
(checked 2026-11-05 at `DRCOG_2024/DRCOG_Final_Ortho_2024/ImageServer?f=json`), so the
opening view, which loads 2024 at 3 inches, is already the most detailed image there
is. Arapahoe County's 2026 flight is also 3 inches but covers only that county, not the
Capitol.

## What changed

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

## Not done, and why

- **Tiling the sharp image** so it fills in piece by piece: more requests to DRCOG's
  server for the same pixels, and the preview already covers the wait.
- **A progressive JPEG** would also sharpen as it streams, but the ArcGIS service decides
  the encoding; the request has no option for it.
