/* ArcGIS ImageServer exportImage on our state-plane window, so streamed years
   land on exactly the same pixel grid as the tiles we read ourselves. */
(function () {
  function exportUrl(service, win) {
    const q = new URLSearchParams({
      bbox: [win.xmin, win.ymin, win.xmax, win.ymax].join(','),
      bboxSR: '2232', imageSR: '2232',
      size: `${win.px},${win.px}`, format: 'jpg', f: 'image',
    });
    return `${service}/exportImage?${q}`;
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
  function isBlank(ctx, px) {
    const d = ctx.getImageData(0, 0, px, px).data;
    let flat = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 97) {
      n++;
      const dark = d[i] < 10 && d[i + 1] < 10 && d[i + 2] < 10;
      const light = d[i] > 250 && d[i + 1] > 250 && d[i + 2] > 250;
      if (dark || light) flat++;
    }
    return flat / n > 0.97;
  }

  async function render(service, win, canvas, signal) {
    const url = exportUrl(service, win);
    const im = await loadImage(url, signal);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(im, 0, 0, win.px, win.px);
    if (isBlank(ctx, win.px)) {
      ctx.clearRect(0, 0, win.px, win.px);
      throw new Error('no imagery at this spot on the streaming service');
    }
    return { url };
  }

  DRAPP.imageserver = { render, exportUrl };
})();
