# Handoff

**State.** drapp.myjimmycloud.com is a Cloudflare Pages direct upload (project `drapp`). The page was rebuilt on 2026-11-12: the photograph fills the screen, the year on show is the only layer, and a timeline along the bottom lists the years that exist where the map is. 2018–2026 are tiles everywhere (2026 is DRCOG's interim mosaic, new on Sanborn's server); inside Arapahoe County every year back to 1998 is tiles; 2004–2016 elsewhere are read out of DRCOG's archive for the view, sized to 8 MB. Compare, play, save a photo, save every year as a zip, link to a view. The design is [docs/design.md](docs/design.md).

**Decided.**
- One layer, no base map inside the region: the base map plus the newest mosaic plus the year on show was three fetches of the same ground, which is what made panning expensive.
- Tiles first arrive at one image pixel per CSS pixel; full screen density (`HD`) only after the map rests at zoom 19 or closer, and it can be switched off. Reason: a tile at twice the pixels is 3–4 times the bytes.
- An archive read is as much of the middle of the view as 8 MB buys, because the files are uncompressed and a neighbourhood at screen detail is tens of megabytes. Picking a year okays one read; a pan never reads.
- The tile index is baked into `data/index/` (run `node scripts/bake_index.mjs` to refresh). DRCOG's live query hung for an hour on 2026-11-12 and would have stopped every older year.
- Streamed years are tiles, never a window (Jimmy, 2026-11-06). Code is MIT (Jimmy, 2026-11-06).

**Next.** Jimmy's look at the rebuilt page. A merge goes live only by `wrangler pages deploy` of `index.html`, `favicon.svg`, `css/`, `js/` and `data/` to project `drapp`. Pages serves the scripts with a four-hour cache, so `index.html` links each one with `?v=` and a date: change that date in the same commit as any script or stylesheet change, or a returning browser runs the new page with old scripts.

**Open.**
- DRCOG's bucket now has a `2024/` folder of archive tiles; the page does not use it (2024 is tiles).
- 2004 tile `3075375_1695645` (Golden) is indexed but missing from DRCOG's bucket.
- The 2010 index file is 1.4 MB (187 KB compressed) because 2010 was cut into quarter-section tiles.
- Looked for 2004–2016 as a map service for Denver itself and found none that answers: MapMart's `DRCOG/Denver_CO_{year}` services (which Littleton's portal points at) no longer resolve, and denvergov.org's image services reset the connection.

**Over to you.** Nothing.
