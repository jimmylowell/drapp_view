/* Base maps under the DRAPP squares.

   Three kinds, and two of them are worth the extra code:
     - Bing, addressed by quadkey rather than z/x/y, so it needs its own
       getTileUrl. Aerial is the default: the point of this page is imagery,
       and a road map under an aerial square tells you nothing.
     - DRAPP itself, region-wide. The same Sanborn ImageServers that stream
       2018–2024 into the square will render any Mercator box, so a whole DRAPP
       year can sit under the square and you can pan around inside one year.
       They have no tile cache, so every tile is a live exportImage call —
       clipped to the DRCOG footprint, with Bing aerial underneath outside it.
     - Esri's World Imagery Wayback, which keeps every version of Esri's
       basemap since 2014. That is the closest thing to "background map, but in
       year N" for anywhere outside the DRAPP footprint. The release list is
       ~100 KB of JSON, so it is fetched only when the menu is first opened.

   None of these are documented public APIs (see README). If one dies, the
   picker keeps working and the others still draw. */
(function () {
  const R = 20037508.342789244;              // Web Mercator half-circumference, metres
  const KEY = 'drapp.basemap';

  /* ---------- layer types ---------- */

  /* Bing names a tile by the path down the quadtree: one digit per zoom level,
     0–3 for the quadrant. */
  const QuadKeyLayer = L.TileLayer.extend({
    getTileUrl(coords) {
      const z = this._getZoomForUrl();
      let q = '';
      for (let i = z; i > 0; i--) {
        const m = 1 << (i - 1);
        q += (coords.x & m ? 1 : 0) + (coords.y & m ? 2 : 0);
      }
      return L.Util.template(this._url, { s: this._getSubdomain(coords), q });
    },
  });

  /* An ArcGIS ImageServer rendered one tile at a time. */
  const ImageServerLayer = L.TileLayer.extend({
    getTileUrl(coords) {
      const n = 2 ** coords.z, sz = 2 * R / n;
      const xmin = -R + coords.x * sz, ymax = R - coords.y * sz;
      const q = new URLSearchParams({
        bbox: [xmin, ymax - sz, xmin + sz, ymax].join(','),
        bboxSR: '3857', imageSR: '3857',
        size: '256,256', format: 'jpg', f: 'image',
      });
      return `${this._url}/exportImage?${q}`;
    },
  });

  /* ---------- sources ---------- */

  const BING = 'https://ecn.t{s}.tiles.virtualearth.net/tiles/';
  const BING_CREDIT = '&copy; <a href="https://www.bing.com/maps" rel="noopener">Microsoft</a>, Earthstar Geographics';
  const ESRI_CREDIT = 'Imagery &copy; <a href="https://www.esri.com" rel="noopener">Esri</a>, Maxar, Earthstar Geographics';

  const bing = (kind, ext, opts) => () => new QuadKeyLayer(BING + kind + '{q}.' + ext + '?g=1', Object.assign({
    subdomains: '0123', minZoom: 1, maxZoom: 22, maxNativeZoom: 19,
    referrerPolicy: 'strict-origin-when-cross-origin', attribution: BING_CREDIT,
  }, opts));

  /* The DRCOG footprint as Mercator-aligned bounds, so Leaflet never asks the
     ImageServer for a tile it would answer in black. */
  function regionBounds() {
    const r = DRAPP.proj.REGION;
    const corners = [[r.xmin, r.ymin], [r.xmax, r.ymin], [r.xmin, r.ymax], [r.xmax, r.ymax]]
      .map(([x, y]) => DRAPP.proj.toLonLat(x, y));
    const lats = corners.map((c) => c.lat), lons = corners.map((c) => c.lon);
    return L.latLngBounds(
      [Math.min(...lats), Math.min(...lons)],
      [Math.max(...lats), Math.max(...lons)]);
  }

  /* Bing aerial goes underneath so the world outside the DRCOG footprint is not
     a black void. The two are explicitly z-ordered: they share the tile pane,
     and leaving it to DOM order breaks the moment either one reloads. */
  const drappYear = (service) => () => L.layerGroup([
    bing('a', 'jpeg', { zIndex: 1, opacity: 0.5 })(),
    new ImageServerLayer(service, {
      bounds: regionBounds(), maxZoom: 22, minZoom: 9, zIndex: 2,
      attribution: 'DRAPP imagery <a href="https://data.drcog.org" rel="noopener">DRCOG</a> (CC BY 3.0)',
    }),
  ]);

  const CATALOG = [
    {
      group: 'Aerial',
      items: [
        { id: 'bing-aerial', name: 'Bing aerial', note: 'current, worldwide', make: bing('a', 'jpeg') },
        { id: 'bing-hybrid', name: 'Bing aerial + labels', make: bing('h', 'jpeg') },
        {
          id: 'esri', name: 'Esri world imagery', make: () => L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            { maxZoom: 22, maxNativeZoom: 19, attribution: ESRI_CREDIT }),
        },
      ],
    },
    {
      group: 'DRAPP, whole region',
      note: 'the same imagery as the square, so you can pan around inside one year',
      items: [],   // filled from sources.js below
    },
    {
      group: 'Esri imagery by year',
      note: 'Esri’s basemap as it stood on that date, worldwide',
      lazy: 'wayback',
      items: [],
    },
    {
      group: 'Map',
      items: [
        { id: 'bing-road', name: 'Bing road', flat: true, make: bing('r', 'png') },
        {
          id: 'osm', name: 'OpenStreetMap', flat: true, make: () => L.tileLayer(
            'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            {
              maxZoom: 22, maxNativeZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin',
              attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a> contributors',
            }),
        },
        { id: 'none', name: 'None', flat: true, make: () => L.layerGroup([]) },
      ],
    },
  ];

  for (const y of [...DRAPP.sources.YEARS].reverse()) {
    const s = DRAPP.sources.SOURCES[y].stream;
    if (s) CATALOG[1].items.push({ id: 'drapp-' + y, name: 'DRAPP ' + y, make: drappYear(s) });
  }

  /* Esri publishes every Wayback release; most differ from the last only where
     imagery was refreshed. One entry per year keeps the menu readable. */
  async function loadWayback(group) {
    const url = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';
    const cfg = await (await fetch(url)).json();
    const byYear = new Map();
    for (const [rel, v] of Object.entries(cfg)) {
      const d = (v.itemTitle.match(/(\d{4})-(\d{2})-(\d{2})/) || [])[0];
      if (!d) continue;
      const year = d.slice(0, 4);
      if (!byYear.has(year) || byYear.get(year).date < d) byYear.set(year, { date: d, rel });
    }
    group.items = [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([year, v]) => ({
      id: 'wb-' + v.rel,
      name: 'Esri ' + year,
      note: v.date,
      make: () => L.tileLayer(
        `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${v.rel}/{z}/{y}/{x}`,
        { maxZoom: 22, maxNativeZoom: 19, attribution: ESRI_CREDIT + ' — Wayback ' + v.date }),
    }));
  }

  /* ---------- picker ---------- */

  function init(map, els) {
    const { button, menu } = els;
    let layer = null, currentId = null, waybackState = 'idle';

    const find = (id) => CATALOG.flatMap((g) => g.items).find((it) => it.id === id);

    function select(id) {
      const item = find(id) || find('bing-aerial');
      if (item.id === currentId) return;
      const next = item.make();
      next.addTo(map);
      if (layer) map.removeLayer(layer);
      layer = next;
      currentId = item.id;
      button.textContent = item.name;
      /* Road maps are drawn to be read on their own; knock them back so the
         imagery square stays the thing you look at. Aerial bases are not
         touched — dimming an aerial just makes it look broken. */
      map.getContainer().classList.toggle('base-flat', !!item.flat);
      try { localStorage.setItem(KEY, item.id); } catch (e) { /* private mode */ }
      paint();
    }

    function paint() {
      menu.innerHTML = '';
      for (const g of CATALOG) {
        const sec = document.createElement('div');
        sec.className = 'bgroup';
        sec.innerHTML = `<h3>${g.group}</h3>` + (g.note ? `<p class="dim">${g.note}</p>` : '');
        if (g.lazy && waybackState !== 'ready') {
          const p = document.createElement('p');
          p.className = 'dim';
          p.textContent = waybackState === 'loading' ? 'loading the release list…'
            : waybackState === 'failed' ? 'release list unavailable' : '…';
          sec.appendChild(p);
        }
        for (const it of g.items) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'bpick';
          b.setAttribute('aria-pressed', String(it.id === currentId));
          b.innerHTML = `<span>${it.name}</span>` + (it.note ? `<em>${it.note}</em>` : '');
          b.addEventListener('click', () => { select(it.id); close(); });
          sec.appendChild(b);
        }
        menu.appendChild(sec);
      }
    }

    function close() {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    }
    function open() {
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      if (waybackState === 'idle') {
        waybackState = 'loading';
        const group = CATALOG.find((g) => g.lazy === 'wayback');
        loadWayback(group).then(() => { waybackState = 'ready'; }, () => { waybackState = 'failed'; })
          .then(paint);
      }
      paint();
    }

    button.addEventListener('click', () => (menu.hidden ? open() : close()));
    document.addEventListener('click', (ev) => {
      if (!menu.hidden && !ev.target.closest('.panel-base')) close();
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !menu.hidden) close();
    });

    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
    select(saved && find(saved) ? saved : 'bing-aerial');
    close();

    return { select, current: () => currentId };
  }

  window.DRAPP = Object.assign(window.DRAPP || {}, { basemaps: { init, CATALOG } });
})();
