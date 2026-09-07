/* Address → lon/lat, entirely from the browser.
   1. "lat, lon" typed directly.
   2. Census Bureau geocoder: no key, no CORS, but it supports JSONP.
   3. Nominatim (OpenStreetMap) as the fallback; CORS is open, usage is light. */
(function () {
  let seq = 0;

  function withState(q) {
    if (/\bCO\b|colorado|\b8\d{4}\b/i.test(q)) return q;
    return q + ', Colorado';
  }

  function census(q, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const cb = '__drappCensus' + (seq++);
      const s = document.createElement('script');
      const timer = setTimeout(() => { cleanup(); reject(new Error('Census geocoder timed out')); }, timeoutMs);
      function cleanup() { clearTimeout(timer); delete window[cb]; s.remove(); }
      window[cb] = (d) => {
        cleanup();
        const m = d && d.result && d.result.addressMatches;
        if (m && m.length) {
          resolve({ lon: m[0].coordinates.x, lat: m[0].coordinates.y, label: m[0].matchedAddress, source: 'U.S. Census Bureau geocoder' });
        } else reject(new Error('no Census match'));
      };
      s.onerror = () => { cleanup(); reject(new Error('Census geocoder unreachable')); };
      s.src = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?' + new URLSearchParams({
        address: withState(q), benchmark: 'Public_AR_Current', format: 'jsonp', callback: cb,
      });
      document.head.appendChild(s);
    });
  }

  async function nominatim(q) {
    const r = await fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
      q: withState(q), format: 'jsonv2', limit: '1', countrycodes: 'us',
      viewbox: '-105.75,40.4,-103.9,39.0',
    }), { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('Nominatim HTTP ' + r.status);
    const d = await r.json();
    if (!d.length) throw new Error('no OpenStreetMap match');
    return { lon: +d[0].lon, lat: +d[0].lat, label: d[0].display_name, source: 'OpenStreetMap Nominatim' };
  }

  function parseLatLon(q) {
    const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    let a = +m[1], b = +m[2];
    if (Math.abs(a) > 90) [a, b] = [b, a];        // lon, lat typed the other way round
    return { lat: a, lon: b, label: `${a.toFixed(5)}, ${b.toFixed(5)}`, source: 'coordinates' };
  }

  async function geocode(q) {
    const ll = parseLatLon(q);
    if (ll) return ll;
    let first;
    try { return await census(q); } catch (e) { first = e; }
    try { return await nominatim(q); } catch (e) {
      throw new Error(`Couldn't place that address (${first.message}; ${e.message}). Try adding the city or ZIP.`);
    }
  }

  DRAPP.geocode = { geocode, parseLatLon };
})();
