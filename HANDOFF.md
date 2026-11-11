# Handoff

**State.** PR #2 is merged into main; drapp.myjimmycloud.com is a direct upload. Since 2026-11-06 the streamed years (2018, 2020, 2022, 2024) are tiles at the map's own zoom, asked at the screen's density, 3 in at the finest (`streamLayer()` in `js/basemaps.js`, `showTiles()` in `js/app.js`). "Every year here" and an address load the older years for the view on screen. Opening view: the Capitol at zoom 19.5 with 2024. Measurements and the base-map table in [docs/loading.md](docs/loading.md). The footer's about paragraph links the source on GitHub, and since 2026-11-10 the repo has the MIT `LICENSE` file the README already named; vendored proj4js and geotiff.js keep their own (MIT) licences.

**Decided.** Streamed years are tiles, never a window: detail follows the zoom alone (Jimmy, 2026-11-06: the ft buttons "was a way to select the detail. I never really figured that out"). Archive years stay windows for the view, because each image row is a request; "Load this view" stays their way in after a pan. A streamed year's picture for Save PNG is one request for the view on screen. Code is MIT so anyone can take it (Jimmy, 2026-11-06: "I want people to be able to take this in the free and open source software ideology").

**Next.** PR #1 (an after-the-fact design note) is still open. A merge goes live only by `wrangler pages deploy` to Cloudflare Pages project `drapp`; a change to `LICENSE` or docs alone needs no deploy.

**Open.** `README.md` still describes the 150–1200 ft square (lines 23 and 100–112); it is Jimmy's to reword. The base map under a streamed year is the same year's tiles again (492 KB of 1.7 MB at the opening view); hiding it under a streamed year would save that, at the cost of a bare edge outside the region.
