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

  /* A county's extent is a rectangle; the county is not. Ask one of these
     services for a tile inside the box but outside the boundary and it answers
     a flat white JPEG, not a 404 — which would paint over whatever is beneath
     it. So every tile is sampled once on load and hidden if it is flat, the
     same test imageserver.isBlank does for the squares. Measured downtown:
     an out-of-county Arapahoe tile is a uniform 253, an in-county one runs
     68-238, so this is not a close call. Reading the pixels needs the tile to
     be CORS-clean; if it is not, the canvas taints and we leave it visible. */
  const probe = document.createElement('canvas');
  probe.width = probe.height = 8;
  function hideIfFlat(img) {
    try {
      const c = probe.getContext('2d', { willReadFrequently: true });
      c.clearRect(0, 0, 8, 8);
      c.drawImage(img, 0, 0, 8, 8);
      const d = c.getImageData(0, 0, 8, 8).data;
      for (let i = 0; i < d.length; i += 4) {
        const flat = (d[i] > 248 && d[i + 1] > 248 && d[i + 2] > 248)
          || (d[i] < 12 && d[i + 1] < 12 && d[i + 2] < 12);
        if (!flat) return;
      }
      img.style.display = 'none';
    } catch (e) { /* tainted canvas — better a white tile than a broken layer */ }
  }

  const dpr = () => Math.min(3, window.devicePixelRatio || 1);
  const FT = 0.3048;
  const DENVER_COS = Math.cos(39.74 * Math.PI / 180);
  /* Image pixels for one tile `sz` Mercator metres wide whose middle sits at
     Mercator y `my`: the device pixels it lands on, but never finer on the
     ground than `nativeFt`. */
  function tilePx(ts, sz, my, nativeFt) {
    let px = Math.round(ts * dpr());
    if (nativeFt) {
      const cos = Math.cos(2 * Math.atan(Math.exp(my / 6378137)) - Math.PI / 2);
      px = Math.min(px, Math.ceil(sz * cos / (nativeFt * FT)));
    }
    return Math.max(64, Math.min(4096, px));
  }
  /* The tile zoom where a device pixel first reaches `nativeFt` on the ground
     at Denver's latitude; past it Leaflet stretches tiles it already has. */
  const nativeZoom = (nativeFt) =>
    Math.ceil(Math.log2(2 * R * DENVER_COS / (256 * nativeFt * FT * dpr())) - 1e-9);

  /* An ArcGIS service rendered one tile at a time. ImageServer takes
     exportImage; the county MapServers take export plus the layer to show —
     one dynamic layer per flight, so the year IS the layer. Neither has a tile
     cache here, so a tile is a live render (0.2-0.5s measured), and the
     tiles are 512 px: the same pixels in a quarter of the requests, which is
     the cheaper shape for a server that pays per export. */
  /* Each tile is asked at the screen's own density: a 512 px tile on a phone
     (device scale 2) is drawn on 1024 device pixels, so it asks for 1024 —
     until that would be finer than the source (`nativeFt`, 3 in for DRAPP),
     where the size stops growing and `maxNativeZoom` has Leaflet stretch the
     finest tiles instead of asking again for the same pixels. Before
     2026-11-06 a tile asked for its CSS size, so on a phone every streamed
     tile came in at half the screen's density: 6 in at the Capitol opening
     zoom, 3 in only past zoom 20.6. */
  const ArcGISLayer = L.TileLayer.extend({
    getTileUrl(coords) {
      const ts = this.getTileSize().x;
      const n = 2 ** coords.z * 256 / ts, sz = 2 * R / n;
      const xmin = -R + coords.x * sz, ymax = R - coords.y * sz;
      const px = tilePx(ts, sz, ymax - sz / 2, this.options.nativeFt);
      const q = new URLSearchParams({
        bbox: [xmin, ymax - sz, xmin + sz, ymax].join(','),
        bboxSR: '3857', imageSR: '3857',
        size: `${px},${px}`, format: 'jpg', f: 'image',
      });
      if (this.options.quality) q.set('compressionQuality', String(this.options.quality));
      const op = this.options.layer === undefined ? 'exportImage' : 'export';
      if (this.options.layer != null) q.set('layers', 'show:' + this.options.layer);
      return `${this._url}/${op}?${q}`;
    },
    createTile(coords, done) {
      const tile = L.TileLayer.prototype.createTile.call(this, coords, done);
      tile.addEventListener('load', () => hideIfFlat(tile), { once: true });
      return tile;
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

  const DRCOG_CREDIT = 'DRAPP imagery <a href="https://data.drcog.org" rel="noopener">DRCOG</a> (CC BY 3.0)';

  /* Every service in sources.js that renders a whole region rather than one
     tile of a GeoTIFF can be the ground you pan over. The list is not ours to
     keep: it is read off sources.js, so a year added there turns up here.
     A year can have more than one — 2000 is Arapahoe and Boulder, two counties
     that do not touch — and they simply stack. */
  /* A streamed DRAPP year (2018–2024) as tiles, region-wide, 3 in at the
     finest. The base map and the year on show (js/app.js) both use it; the
     year on show passes its own pane and JPEG quality 95 (js/imageserver.js
     says why). */
  function streamLayer(year, opts) {
    const src = DRAPP.sources.SOURCES[year];
    return new ArcGISLayer(src.stream, Object.assign({
      bounds: regionBounds(), attribution: DRCOG_CREDIT, regionWide: true,
      maxZoom: 22, minZoom: 9, crossOrigin: 'anonymous', tileSize: 512,
      nativeFt: DRAPP.proj.GRID, maxNativeZoom: nativeZoom(DRAPP.proj.GRID),
    }, opts));
  }

  function serviceLayers(year) {
    const src = DRAPP.sources.SOURCES[year], out = [];
    const common = { maxZoom: 22, minZoom: 9, crossOrigin: 'anonymous' };
    const live = { tileSize: 512 };
    if (src.stream) out.push(streamLayer(year));
    for (const p of src.providers || []) {
      const o = Object.assign({
        bounds: L.latLngBounds([p.cover[0], p.cover[1]], [p.cover[2], p.cover[3]]),
        attribution: `<a href="${p.home}" rel="noopener">${p.credit}</a>`,
      }, common);
      const ft = p.res / 12;
      if (p.kind === 'map') out.push(new ArcGISLayer(p.service, Object.assign({ layer: p.layer, nativeFt: ft, maxNativeZoom: nativeZoom(ft) }, o, live)));
      else if (p.kind === 'xyz') out.push(L.tileLayer(p.url, Object.assign({ maxNativeZoom: p.maxZoom }, o)));
    }
    return out;
  }

  /* Tile layers share the tile pane, so stacking order has to be said out loud;
     leaving it to DOM order breaks the moment one of them reloads. */
  function stack(layers) {
    layers.forEach((l, i) => { l.options.zIndex = i + 1; });
    return L.layerGroup(layers);
  }

  /* Which years can be panned over at all. No floor of our own — whatever
     sources.js has a region-wide service for, newest first. */
  const SERVED_YEARS = [...DRAPP.sources.YEARS].reverse()
    .filter((y) => serviceLayers(y).length);

  /* Bing aerial goes underneath so the world outside a service's coverage is
     not a black void, at half opacity so the edge of coverage reads as an edge.
     Everything is explicitly z-ordered: these share the tile pane, and leaving
     it to DOM order breaks the moment one of them reloads. */
  const under = () => bing('a', 'jpeg', { opacity: 0.5 })();
  const servedYear = (year) => () => stack([under(), ...serviceLayers(year)]);

  /* The default: the newest imagery that actually reaches wherever you are.
     Walking back from the newest year, a year earns a place only while some
     spot is still uncovered — so this is county imagery over DRCOG over Bing,
     three layers, and it stops the moment a region-wide one is added rather
     than stacking every year and fetching eleven tiles per screen cell. */
  const newestAvailable = () => {
    const layers = [];
    for (const y of SERVED_YEARS) {
      const ls = serviceLayers(y);
      layers.unshift(...ls);
      if (ls.some((l) => l.options.regionWide)) break;
    }
    return stack([under(), ...layers]);
  };

  const yearName = (year) => {
    const src = DRAPP.sources.SOURCES[year];
    const who = src.stream ? 'DRCOG' : [...new Set((src.providers || []).map((p) => p.credit))].join(', ');
    return { id: 'y' + year, name: String(year), note: who, plain: `${year} photos from ${who}, as tiles`, make: servedYear(year) };
  };

  const CATALOG = [
    {
      group: 'Aerial',
      items: [
        {
          id: 'newest', name: 'Newest available', note: 'sharpest here',
          plain: 'newest DRCOG photos, as tiles',
          make: newestAvailable,
        },
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
      group: 'This region, by year',
      note: 'the same services the squares come from — pan and zoom around inside one year',
      items: SERVED_YEARS.map(yearName),
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
      if (els.onChange) els.onChange(item);
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
    select(saved && find(saved) ? saved : 'newest');
    close();

    return { select, current: () => currentId, item: () => find(currentId) };
  }

  window.DRAPP = Object.assign(window.DRAPP || {}, { basemaps: { init, CATALOG, streamLayer, tilePx, nativeZoom } });
})();
