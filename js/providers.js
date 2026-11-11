/* Try a year's extra providers in order: skip any whose extent box misses the
   point, render the first that answers with pixels. Every kind is one round
   trip (or one burst of tile requests) drawn straight onto the state-plane
   grid, so these run alongside the streamed DRAPP years rather than in the
   archive queue. */
(function () {
  const { imageserver, xyz } = DRAPP;

  function covers(p, lat, lon) {
    const [s, w, n, e] = p.cover;
    return lat >= s && lat <= n && lon >= w && lon <= e;
  }

  /* Resolves {provider, note}; rejects with the last reason if none worked. */
  async function render(list, lat, lon, win, canvas, signal) {
    const here = list.filter((p) => covers(p, lat, lon));
    if (!here.length) throw new Error('outside every source for this year');
    let last = null;
    for (const p of here) {
      if (signal && signal.aborted) throw new DOMException('aborted', 'AbortError');
      try {
        let note = '';
        if (p.kind === 'map') await imageserver.renderMap(p.service, p.layer, win, canvas, signal);
        else if (p.kind === 'xyz') { const r = await xyz.render(p, win, canvas, signal); note = `(zoom ${r.zoom}, ${r.tiles} tiles)`; }
        else throw new Error('unknown provider kind ' + p.kind);
        return { provider: p, note };
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        if (/^no (imagery|tiles)/.test(e.message)) {
          last = new Error(`${p.credit} has nothing here`);
          last.nothingHere = true;      // answered, but blank: not a failure of the service
        } else last = e;
      }
    }
    throw last;
  }

  DRAPP.providers = { render, covers };
})();
