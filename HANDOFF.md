# Handoff

**State.** On branch `reckon/todo-234e959f` (PR #2). A link with no address opens on the Colorado State Capitol dome at 3 inches a pixel, 2024 only, one request (`openHome()` in `js/app.js`; coordinates from [Wikipedia](https://en.wikipedia.org/wiki/Colorado_State_Capitol)). 2024 is already the finest DRAPP year (the service reports 0.25 ft). Since the second commit: a label on the map says which year is on screen, how sharp, from where, and what is still loading; a streamed year shows a blurry 4×-coarser preview first and sharpens in place; the size buttons read "Every year, in a square … across" and work on the opening view (square at map centre); the picker reads "Year 2024". Findings and measurements in [docs/loading.md](docs/loading.md). Smoke test passes; checked in headless Chrome at 390 px (device scale 2) and 1280 px, no console errors.

**Decided.** Load one year on the opening view, not every year: a first visit should not fire the whole archive at DRCOG's servers. The preview is one extra small request per streamed year (51 KB against 490 KB on the phone); tiling the sharp image was rejected as more requests for the same pixels.

**Next.** Jimmy looks at the phone screenshots and merges the PR; the site is GitHub Pages on `main`, so the merge is the deploy.

**Open.** None.
