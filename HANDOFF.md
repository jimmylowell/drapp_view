# Handoff

**State.** A link with no address (`drapp.myjimmycloud.com/` with no `#ll=…`) opens on the Colorado State Capitol dome and loads the newest DRAPP year there at 3 inches a pixel: one ImageServer request. Zoom is picked so one device pixel is about one source pixel: 19.5 on a phone, 20.5 on a plain desktop screen (`openHome()` in `js/app.js`). Coordinates are Wikipedia's (39.7392321, -104.9848677, [Colorado State Capitol](https://en.wikipedia.org/wiki/Colorado_State_Capitol)). Links with an address or `?q=` behave as before. Smoke test passes; checked in headless Chrome at 390 px (device scale 2) and 1280 px.

**Decided.** Load one year, not every year: a first visit should not fire the whole archive at DRCOG's servers. The other years are a tick away in *Load this view*.

**Next.** Merge the PR; the site is GitHub Pages on `main`, so the merge is the deploy.

**Open.** None.
