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
if (!BASE) { console.error('uso: screenshots.mjs --url "http://127.0.0.1:8399/?token=XXX" [--out dir]'); process.exit(1); }
const THEMES = ['forja', 'pizarra', 'taberna'];
const SIZES = [[1440, 900], [820, 1180], [400, 860]];
const VIEWS = { focus: '#/', settings: '#/settings/general' };

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
  for (const theme of THEMES) for (const [w, h] of SIZES) for (const [view, hash] of Object.entries(VIEWS)) {
    const tab = await (await fetch('http://127.0.0.1:9411/json/new?about:blank', { method: 'PUT' })).json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => ws.once('open', r));
    let id = 0; const pend = new Map();
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: Math.min(w, h) < 600 });
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('habitat.theme','${theme}')}catch(e){}` });
    await send('Page.navigate', { url: BASE + hash }); await sleep(2500);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `${theme}-${w}x${h}-${view}.png`), Buffer.from(s.result.data, 'base64'));
    ws.close(); await fetch(`http://127.0.0.1:9411/json/close/${tab.id}`);
  }
} finally { chrome.kill(); }
console.log(`capturas en ${OUT}`);
