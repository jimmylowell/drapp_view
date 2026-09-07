#!/usr/bin/env node
/* Drive the real page in headless Chrome over the DevTools protocol: open a
   location, wait for every card to settle, print each card's state and any
   console errors, and save a screenshot. Needs Google Chrome and a local server
   (`npm run serve`). No npm dependencies — uses Node's built-in WebSocket.
   Run: node scripts/browser_check.mjs [url] [maxSeconds] [shot.png] */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const url = process.argv[2] || 'http://localhost:8765/#ll=39.748200,-104.993500&s=300&q=1001%2017th%20St%20Denver';
const maxSeconds = +(process.argv[3] || 150);
const shot = process.argv[4] || 'browser_check.png';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9222 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(path.join(tmpdir(), 'drapp-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1300,2300',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch {}
  await sleep(200);
}
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const consoleErrors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) consoleErrors.push(m.params.type + ': ' + m.params.args.map((a) => a.value || a.description).join(' '));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErrors.push('log: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.result.value;

await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
if (process.env.MOBILE) await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url });
const settle = async () => {
  const t0 = Date.now();
  let states;
  while (Date.now() - t0 < maxSeconds * 1000) {
    await sleep(500);
    states = await evalJs(`(() => { const c = document.querySelectorAll('.yrow'); if (!c.length) return null;
      const recs = window.DRAPP.app.recs;
      return [...c].map(el => { const r = recs.get(+el.dataset.year); return { year: el.dataset.year,
        done: r.status === 'ready' && !!r.overlay, failed: r.status === 'failed' || r.status === 'download',
        msg: el.querySelector('.st').textContent, src: r.src, meta: r.meta, opacity: r.overlay ? r.overlay.options.opacity : null }; }); })()`);
    if (states && states.every((s) => s.done || s.failed)) break;
  }
  return [states, Date.now() - t0];
};
let [states, elapsed] = await settle();
if (process.env.RELOAD) {   // second pass in the same profile: everything should come from the IndexedDB cache
  console.log(`first pass ${(elapsed / 1000).toFixed(0)}s; reloading…`);
  await sleep(1500);        // let the last cache.put land
  await send('Page.reload');
  [states, elapsed] = await settle();
  const sheet = await evalJs(`(() => { const c = window.DRAPP.app.contactSheet(); return c ? c.width + 'x' + c.height + ' ' + c.toDataURL('image/png').length + ' bytes' : 'none'; })()`);
  console.log('contact sheet:', sheet);
}
const t0 = Date.now() - elapsed;
const status = await evalJs(`document.querySelector('#status').textContent`);
const widths = await evalJs(`document.documentElement.scrollWidth + ' of ' + document.documentElement.clientWidth`);
console.log(`page width ${widths}px${widths.split(' of ')[0] > widths.split(' of ')[1] ? '  ← HORIZONTAL OVERFLOW' : ''}`);
console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s — ${status}`);
for (const s of states || []) console.log(`  ${s.year}  ${s.done ? 'done  ' : s.failed ? 'failed' : 'pending'}  ${s.done && s.opacity > 0 ? '● ' : ''}${s.meta ? '[' + s.meta + '] ' : ''}${s.done ? s.src : s.msg}`);
console.log('showing:', await evalJs(`window.DRAPP.app.currentYear() + ' | button: ' + document.querySelector('#year-btn').textContent`));
if (consoleErrors.length) { console.log('console:'); for (const e of consoleErrors) console.log('  ' + e.slice(0, 300)); }
if (process.env.MENU) {   // open the year menu before the screenshot
  await evalJs(`document.querySelector('#year-btn').click()`);
  await sleep(400);
}
const png = (await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).result.data;
writeFileSync(shot, Buffer.from(png, 'base64'));
console.log('screenshot →', shot);
ws.close(); cleanup();
const stuck = (states || []).filter((s) => !s.done && !s.failed).length;
process.exit(stuck ? 1 : 0);
