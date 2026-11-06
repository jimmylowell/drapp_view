# Handoff

**State.** On branch `reckon/todo-234e959f` (PR #2). Since 2026-11-06 the streamed years (2018, 2020, 2022, 2024) are tiles at the map's own zoom, asked at the screen's density, 3 in at the finest (`streamLayer()` in `js/basemaps.js`, `showTiles()` in `js/app.js`); the square sizes, the blurry preview and the spot sharpening are gone. "Every year here" (was "Square at map centre") and an address load the older years for the view on screen, at 3 in near the 3-inch zoom. Opening view: the Capitol at zoom 19.5 with 2024. Measurements and the base-map table in [docs/loading.md](docs/loading.md). Smoke test passes; checked in headless Chrome at 390 px: every 2018–2024 year at 3 in zoomed all the way in, no console errors.

**Decided.** Streamed years are tiles, never a window: detail follows the zoom alone (Jimmy, 2026-11-06: the ft buttons "was a way to select the detail. I never really figured that out"). Archive years stay windows for the view, because each image row is a request; "Load this view" stays their way in after a pan. A streamed year's picture for Save PNG is one request for the view on screen.

**Next.** Merge, then `wrangler pages deploy` to Cloudflare Pages project `drapp` (drapp.myjimmycloud.com is a direct upload since 2026-11-06; GitHub Pages no longer serves it).

**Open.** `README.md` still describes the 150–1200 ft square (lines 23 and 100–112); it is Jimmy's to reword. The base map under a streamed year is the same year's tiles again (492 KB of 1.7 MB at the opening view); hiding it under a streamed year would save that, at the cost of a bare edge outside the region.
