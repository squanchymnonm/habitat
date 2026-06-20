import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import config from './config.js';
import { createStore } from './state.js';
import { readUsage } from './transcript.js';
import { applyEvent } from './hooks-logic.js';
import { attachWs } from './ws.js';
import { capturePane } from './tmux.js';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function snapOf(session) {
  const out = {};
  for (const k of Object.keys(session)) if (!k.startsWith('_')) out[k] = session[k];
  return out;
}

function readBody(req) {
  return new Promise((res, rej) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => res(b));
    req.on('error', rej);
  });
}

export function createApp({ config, store }) {
  let hub;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');

    if (req.method === 'POST' && url.pathname === '/hooks') {
      if (config.TOKEN) {
        const hdr = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
        if (hdr !== config.TOKEN) { res.writeHead(401).end(); return; }
      }
      const ip = req.socket.remoteAddress;
      if (!LOCAL.has(ip)) { res.writeHead(403).end(); return; }
      let payload;
      try { payload = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      const { session, fightResult } = applyEvent(store, payload, {
        readUsage, maxContext: config.MAX_CONTEXT, now: () => Date.now(),
      });
      hub.broadcast({ type: 'session', session: snapOf(session) });
      if (fightResult) hub.broadcast({ type: 'fightResult', ...fightResult });
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/preview') {
      const s = store.get(url.searchParams.get('id'));
      const lines = s ? await capturePane(s.tmux || s.name, config.PREVIEW_LINES) : '';
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ lines }));
      return;
    }

    // estáticos
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = normalize(join(WEB, p));
    if (!file.startsWith(WEB)) { res.writeHead(403).end(); return; }
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }).end(data);
    } catch { res.writeHead(404).end(); }
  });

  hub = attachWs(server, store, { token: config.TOKEN });
  return { server, get hub() { return hub; } };
}

// arranque real
if (import.meta.url === `file://${process.argv[1]}`) {
  const store = createStore();
  const { server } = createApp({ config, store });
  server.listen(config.PORT, config.BIND, () => {
    console.log(`hábitat en http://${config.BIND}:${config.PORT}`);
  });
}
