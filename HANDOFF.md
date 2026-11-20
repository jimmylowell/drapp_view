# Handoff

**State.** drapp.myjimmycloud.com is a Cloudflare Pages direct upload (project `drapp`). The page was rebuilt on 2026-11-12: the photograph fills the screen, the year on show is the only layer, and a timeline along the bottom lists the years that exist where the map is. 2018–2026 are tiles everywhere (2026 is DRCOG's interim mosaic, new on Sanborn's server); inside Arapahoe County every year back to 1998 is tiles; 2004–2016 elsewhere are read out of DRCOG's archive for the view, sized to 8 MB. Compare, play, save a photo, save every year as a zip, link to a view. The design is [docs/design.md](docs/design.md).

**The USGS years (live 2026-11-20).** Nineteen years around central Denver come from USGS and are read from our own R2 bucket: 16 years of aerial photo frames, 1939 to 1991, placed by matching and labelled with each year's held-out error, and three already on coordinates, 1993–94, 1999 and 2002. Each is a PMTiles file in bucket `drapp-tiles`, served at `drapp-tiles.myjimmycloud.com` (23 files, 5.09 GB), read a tile at a time by Range request (`pmBlob` in `js/tiles.js`). The design, the label rule and the 512 MB split are in [docs/design.md](docs/design.md), *The USGS years*.

**Decided.**
- One layer, no base map inside the region: the base map plus the newest mosaic plus the year on show was three fetches of the same ground, which is what made panning expensive.
- Tiles first arrive at one image pixel per CSS pixel; full screen density (`HD`) only after the map rests at zoom 19 or closer, and it can be switched off. Reason: a tile at twice the pixels is 3–4 times the bytes.
- An archive read is as much of the middle of the view as 8 MB buys, because the files are uncompressed and a neighbourhood at screen detail is tens of megabytes. Picking a year okays one read; a pan never reads.
- The tile index is baked into `data/index/` (run `node scripts/bake_index.mjs` to refresh). DRCOG's live query hung for an hour on 2026-11-12 and would have stopped every older year.
- Streamed years are tiles, never a window (Jimmy, 2026-11-06). Code is MIT (Jimmy, 2026-11-06).
- Compare can set a DRAPP year against today's satellite picture, Esri World Imagery, offered as the last chip only while comparing (Jimmy, 2026-11-17: "a way to show off the high detail of Denver aerials versus a base map layer"). Esri only, never Google, whose terms keep its imagery inside its own map. Never played or saved, since the imagery is Esri's. The labels come from Esri's own source records at the view's centre, as [docs/design.md](docs/design.md) says.
- The USGS tiles are one file a year, not loose tiles: 842,629 tiles are far past what Pages holds, and a file can be handed to anyone whole. No Worker: the page needs none, and a Worker adds code to keep and a daily request allowance.
- A file over 512 MB is split by zoom, because Cloudflare's Free plan caches no file larger than that; a cache rule on the address (edge 30 days, browser 1 day) is what makes Cloudflare answer repeat reads.

**Next.** Jimmy's look at the rebuilt page. A merge goes live only by `wrangler pages deploy` of `index.html`, `favicon.svg`, `css/`, `js/` and `data/` to project `drapp`. Pages serves the scripts with a four-hour cache, so `index.html` links each one with `?v=` and a date: change that date in the same commit as any script or stylesheet change, or a returning browser runs the new page with old scripts.

**Open.**
- DRCOG's bucket now has a `2024/` folder of archive tiles; the page does not use it (2024 is tiles).
- 2004 tile `3075375_1695645` (Golden) is indexed but missing from DRCOG's bucket.
- The 2010 index file is 1.4 MB (187 KB compressed) because 2010 was cut into quarter-section tiles.
- Looked for 2004–2016 as a map service for Denver itself and found none that answers: MapMart's `DRCOG/Denver_CO_{year}` services (which Littleton's portal points at) no longer resolve, and denvergov.org's image services reset the connection.
- **Replacing a USGS file.** The files are made on the build machine, not in this repo. Wrangler's `r2 object put` stops at 300 MiB and six files are larger, so they are uploaded through R2's S3 interface (multipart). A file uploaded again under the same name has to be purged from Cloudflare's cache by its address, since the edge keeps it 30 days. The bucket's CORS rule is `ci/r2-cors.json` and allows only `https://drapp.myjimmycloud.com`, so a `*.pages.dev` preview draws no USGS year.
- Years USGS does not have over Denver (the 1940s but 1939, the late 1950s, 1966–68, the mid-1980s) are in library prints; see [docs/design.md](docs/design.md), *Denver itself between 1933 and 2000*.
- Jefferson County serves DRAPP 2006–2022 as image services (`gisportal.jeffco.us/image/rest/services/DRAPP/DRAPP{year}`), drawing inside that county only. Added like Arapahoe's, they would make 2006–2016 and the download-only 2008 plain tiles in Lakewood, Arvada and Golden.

**Over to you.** Nothing.
