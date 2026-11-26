# Handoff

**State.** drapp.myjimmycloud.com is a Cloudflare Pages direct upload (project `drapp`). The page was rebuilt on 2026-11-12: the photograph fills the screen, the year on show is the only layer, and a timeline along the bottom lists the years that exist where the map is. 2018–2026 are tiles everywhere (2026 is DRCOG's interim mosaic, new on Sanborn's server); inside Arapahoe County every year back to 1998 is tiles; inside Jefferson County (Lakewood, Arvada, Golden) 2006–2016 are tiles from the county's own copies of DRAPP, 2008 included; 2004–2016 elsewhere are read out of DRCOG's archive for the view, sized to 8 MB. Compare, play, save a photo, save every year as a zip, link to a view. The design is [docs/design.md](docs/design.md).

**The USGS years (live 2026-11-20).** Nineteen years around central Denver come from USGS and are read from our own R2 bucket: 16 years of aerial photo frames, 1939 to 1991, placed by matching and labelled with each year's held-out error, and three already on coordinates, 1993–94, 1999 and 2002. Each is a PMTiles file in bucket `drapp-tiles`, served at `drapp-tiles.myjimmycloud.com` (23 files, 5.09 GB), read a tile at a time by Range request (`pmBlob` in `js/tiles.js`). The design, the label rule and the 512 MB split are in [docs/design.md](docs/design.md), *The USGS years*.

**Decided.**
- One layer, no base map inside the region: the base map plus the newest mosaic plus the year on show was three fetches of the same ground, which is what made panning expensive.
- Tiles first arrive at one image pixel per CSS pixel; full screen density (`HD`) only after the map rests at zoom 19 or closer, and it can be switched off. Reason: a tile at twice the pixels is 3–4 times the bytes.
- An archive read is as much of the middle of the view as 8 MB buys, because the files are uncompressed and a neighbourhood at screen detail is tens of megabytes. Picking a year okays one read; a pan never reads.
- The tile index is baked into `data/index/` (run `node scripts/bake_index.mjs` to refresh). DRCOG's live query hung for an hour on 2026-11-12 and would have stopped every older year.
- Jefferson County's image services are drawn like Arapahoe's map service: inside the county only, asked by a 16 px check, cut along their own picture, credited by name. Its GIS data is CC BY 4.0 and the services carry no copyright text; the reading is in [docs/design.md](docs/design.md), *Jefferson County*. A change to either county's years needs `python3 scripts/bake_outlines.py --only <years>` so the cut matches.
- Streamed years are tiles, never a window (Jimmy, 2026-11-06). Code is MIT (Jimmy, 2026-11-06).
- Compare can set a DRAPP year against today's satellite picture, Esri World Imagery, offered as the last chip only while comparing (Jimmy, 2026-11-17: "a way to show off the high detail of Denver aerials versus a base map layer"). Esri only, never Google, whose terms keep its imagery inside its own map. Never played or saved, since the imagery is Esri's. The labels come from Esri's own source records at the view's centre, as [docs/design.md](docs/design.md) says.
- The USGS tiles are one file a year, not loose tiles: 842,629 tiles are far past what Pages holds, and a file can be handed to anyone whole. No Worker: the page needs none, and a Worker adds code to keep and a daily request allowance.
- A file over 512 MB is split by zoom, because Cloudflare's Free plan caches no file larger than that; a cache rule on the address (edge 30 days, browser 1 day) is what makes Cloudflare answer repeat reads.

**Next.** Jimmy's look at the rebuilt page. A merge goes live only by `wrangler pages deploy` of `index.html`, `placing.html`, `favicon.svg`, `css/`, `js/`, `data/` and `img/` to project `drapp`. Pages serves the scripts with a four-hour cache, so `index.html` links each one with `?v=` and a stamp: give a file a stamp it has never had in the same commit as any change to it, or a returning browser runs the new page with the old file. The date alone is not enough when a file changes twice in a day (add a letter: `20261120b`).

**Open.**
- DRCOG's bucket now has a `2024/` folder of archive tiles; the page does not use it (2024 is tiles).
- 2004 tile `3075375_1695645` (Golden) is indexed but missing from DRCOG's bucket.
- The 2010 index file is 1.4 MB (187 KB compressed) because 2010 was cut into quarter-section tiles.
- Looked for 2004–2016 as a map service for Denver itself and found none that answers: MapMart's `DRCOG/Denver_CO_{year}` services (which Littleton's portal points at) no longer resolve, and denvergov.org's image services reset the connection.
- **Sharper photograph first.** 1969, 1970, 1971, 1972, 1975, 1978, 1980, 1983 and 1984 are joined so that where two photographs cover the same ground, the one from the sharper scan is drawn. `data/usgs-zones.json` follows the same rule, so the pixel note and the blurry fold match what is drawn.
- **Replacing a USGS file.** The files are made on the build machine, not in this repo. Wrangler's `r2 object put` stops at 300 MiB and six files are larger, so they are uploaded through R2's S3 interface (multipart). The edge keeps a file 30 days under its address, so a replaced file gets a new `?v=` in `FILE_VERSION` in `js/sources.js` (the nine years above carry `20261121`), or its address is purged. The bucket's CORS rule is `ci/r2-cors.json` and allows only `https://drapp.myjimmycloud.com`, so a `*.pages.dev` preview draws no USGS year.
- Years USGS does not have over Denver (the 1940s but 1939, the late 1950s, 1966–68, the mid-1980s) are in library prints; see [docs/design.md](docs/design.md), *Denver itself between 1933 and 2000*.

**Over to you.** Nothing.
