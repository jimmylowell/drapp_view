/* ArcGIS exports on our state-plane window, so served years land on exactly
   the same pixel grid as the tiles we read ourselves. ImageServer
   (exportImage) for the DRCOG mosaics; MapServer (export, one layer shown) for
   the county services, whose server reprojects from whatever the raster is
   stored in.

   The mosaics default to JPEG quality 75, which costs visible detail on a
   3-inch pixel. 95 is 2.3× the bytes (560 KB against 240 KB for 1200²) and
   within 0.9 grey levels of the raw archive tile on average, so the window
   asks for that; the base-map tiles keep the default. Windows are snapped to
   the source grid (js/proj.js), so the server copies pixels rather than
   resampling them. */
(function () {
  const QUALITY = 95;

  function exportUrl(service, win) {
    const q = new URLSearchParams({
      bbox: [win.xmin, win.ymin, win.xmax, win.ymax].join(','),
      bboxSR: '2232', imageSR: '2232',
      size: `${win.px},${win.py}`, format: 'jpg', compressionQuality: String(QUALITY), f: 'image',
    });
    return `${service}/exportImage?${q}`;
  }

  function mapExportUrl(service, layer, win) {
    const q = new URLSearchParams({
      bbox: [win.xmin, win.ymin, win.xmax, win.ymax].join(','),
      bboxSR: '2232', imageSR: '2232',
      size: `${win.px},${win.py}`, format: 'jpg', f: 'image',
    });
    if (layer != null) q.set('layers', 'show:' + layer);
    return `${service}/export?${q}`;
  }

  function loadImage(url, signal, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true; im.src = '';
        reject(new Error('image service timed out'));
      }, timeoutMs);
      const abort = () => {
        if (settled) return;
        settled = true; im.src = ''; clearTimeout(timer);
        reject(new DOMException('aborted', 'AbortError'));
      };
      if (signal) {
        if (signal.aborted) return abort();
        signal.addEventListener('abort', abort, { once: true });
      }
      im.onload = () => { if (settled) return; settled = true; clearTimeout(timer); resolve(im); };
      im.onerror = () => { if (settled) return; settled = true; clearTimeout(timer); reject(new Error('image service did not answer')); };
      im.src = url;
    });
  }

  /* A service that has no coverage here returns a flat black (or white) JPEG
     rather than an error. Sample every 97th pixel. */
  function isBlank(ctx, px, py = px) {
    const d = ctx.getImageData(0, 0, px, py).data;
    let flat = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 97) {
      n++;
      const dark = d[i] < 10 && d[i + 1] < 10 && d[i + 2] < 10;
      const light = d[i] > 250 && d[i + 1] > 250 && d[i + 2] > 250;
      if (dark || light) flat++;
    }
    return flat / n > 0.97;
  }

  async function renderUrl(url, win, canvas, signal) {
    const im = await loadImage(url, signal);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(im, 0, 0, win.px, win.py);
    if (isBlank(ctx, win.px, win.py)) {
      ctx.clearRect(0, 0, win.px, win.py);
      throw new Error('no imagery at this spot on the service');
    }
    return { url };
  }

  const render = (service, win, canvas, signal) => renderUrl(exportUrl(service, win), win, canvas, signal);
  const renderMap = (service, layer, win, canvas, signal) => renderUrl(mapExportUrl(service, layer, win), win, canvas, signal);

  DRAPP.imageserver = { render, renderMap, exportUrl, mapExportUrl, loadImage, isBlank, QUALITY };
})();
