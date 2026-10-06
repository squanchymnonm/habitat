#!/usr/bin/env node
// Capturas de la GUI en 3 temas x 3 tamaños x vistas, por CDP crudo (sin playwright).
// Requiere chrome-headless-shell (npx playwright install chromium) y, en este server,
// LD_LIBRARY_PATH apuntando a las libs bundleadas de JetBrains SÓLO para el proceso de chrome.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import wsPkg from '../node_modules/ws/index.js';
const { WebSocket } = wsPkg;

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const BASE = args.url; const OUT = args.out || 'shots';
if (!BASE) { console.error('uso: screenshots.mjs --url "http://127.0.0.1:8399/?token=XXX" [--out dir] [--zoom 1,1.25,0.8] [--themes forja,…] [--sizes 1440x900,…] [--views focus,settings]'); process.exit(1); }
const list = (v) => (v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : null);
// `prepare` corre después de navegar (con la 1ra sesión ya sola y seleccionada): clickea
// por CDP (Runtime.evaluate) para llegar a una pestaña de herramienta que no está en la URL.
const clickTab = (label) => `Array.from(document.querySelectorAll('[data-test="tool-tab"]')).find(b => b.textContent.includes(${JSON.stringify(label)}))?.click()`;
const clickSel = (sel) => `document.querySelector(${JSON.stringify(sel)})?.click()`;
const ALL_VIEWS = {
  focus: { hash: '#/' },
  settings: { hash: '#/settings/general' },
  'focus-git': { hash: '#/', prepare: [clickTab('Git')] },
  'focus-files': { hash: '#/', prepare: [clickTab('Archivos')] },
  'focus-quest': { hash: '#/', prepare: [clickTab('Quest')] },
  // Sólo tiene sentido en landscape >=900 (único tamaño donde existe "Fijar al costado").
  'focus-pinned': { hash: '#/', prepare: [clickTab('Git'), clickSel('[data-test="pin-tool"]')] },
};
const THEMES = list(args.themes) ?? ['forja', 'pizarra', 'taberna'];
const SIZES = (list(args.sizes) ?? ['1440x900', '820x1180', '400x860']).map((s) => s.split('x').map(Number));
const VIEWS = Object.fromEntries(Object.entries(ALL_VIEWS).filter(([k]) => !args.views || list(args.views).includes(k)));
// Zoom de UI (useZoom): se escribe en localStorage 'habitat.zoom' antes de cargar.
// Debe ser un paso de ZOOM_STEPS; si no, la app lo ignora y queda en 1.
const ZOOMS = (list(args.zoom) ?? ['1']).map(Number);

const msRoot = join(homedir(), '.cache/ms-playwright');
const shellDir = existsSync(msRoot) && readdirSync(msRoot).find((d) => d.startsWith('chromium_headless_shell'));
if (!shellDir) { console.error('falta chrome-headless-shell: npx playwright install chromium'); process.exit(1); }
const bin = join(msRoot, shellDir, 'chrome-headless-shell-linux64/chrome-headless-shell');
const jb = join(homedir(), '.cache/JetBrains/RemoteDev/dist');
const libDir = existsSync(jb) ? readdirSync(jb).map((d) => join(jb, d, 'plugins/remote-dev-server/selfcontained/lib')).find(existsSync) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// mkdir antes de spawnear chrome: si falla (p.ej. permisos), no deja el proceso huérfano.
mkdirSync(OUT, { recursive: true });
const chrome = spawn(bin, ['--no-sandbox', '--remote-debugging-port=9411', '--hide-scrollbars'], {
  env: { ...process.env, ...(libDir ? { LD_LIBRARY_PATH: libDir } : {}) }, stdio: 'ignore',
});
try {
  await sleep(1500);
  for (const zoom of ZOOMS) for (const theme of THEMES) for (const [w, h] of SIZES) for (const [view, cfg] of Object.entries(VIEWS)) {
    const tab = await (await fetch('http://127.0.0.1:9411/json/new?about:blank', { method: 'PUT' })).json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => ws.once('open', r));
    let id = 0; const pend = new Map();
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: Math.min(w, h) < 600 });
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('habitat.theme','${theme}');localStorage.setItem('habitat.zoom','${zoom}')}catch(e){}` });
    await send('Page.navigate', { url: BASE + cfg.hash }); await sleep(2500);
    for (const expression of cfg.prepare ?? []) { await send('Runtime.evaluate', { expression }); await sleep(400); }
    const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `${theme}-${w}x${h}-${view}${zoom !== 1 ? `-z${zoom}` : ''}.png`), Buffer.from(s.result.data, 'base64'));
    ws.close(); await fetch(`http://127.0.0.1:9411/json/close/${tab.id}`);
  }
} finally { chrome.kill(); }
console.log(`capturas en ${OUT}`);
