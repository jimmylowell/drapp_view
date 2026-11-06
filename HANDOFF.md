# Handoff

**State.** On branch `reckon/todo-234e959f` (PR #2). Opening view: the Colorado State Capitol at 3 in, 2024 only. A label on the map says which year is on screen, how sharp, from where, what is loading, and which base map is under it. Since the third commit: zooming into a streamed year (2018–2024) that loaded coarser than the screen wants fetches just the spot on screen again at the screen's density (3 in fully zoomed) and lays it over the coarse image (`sharpen()` in `js/app.js`); the label says "coarser than the source, zoom in for 3 in" when it is. Findings and measurements in [docs/loading.md](docs/loading.md). Smoke test passes; checked in headless Chrome at 390 px, no console errors.

**Decided.** Load one year on the opening view, not every year. Archive years (2004–2016) are not sharpened automatically: a request per source row; the "Load this view" tap stays their way in. The sharpened patch is kept per year and dropped by a new square or view.

**Next.** Jimmy tries it on the phone and merges the PR; the site is GitHub Pages on `main`, so the merge is the deploy.

**Open.** None.
