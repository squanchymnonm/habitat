import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize, sep, basename } from 'node:path';
import config from './config.js';
import { createStore } from './state.js';
import { readUsage } from './transcript.js';
import { applyEvent } from './hooks-logic.js';
import { attachWs } from './ws.js';
import { attachTerm } from './term.js';
import { capturePane, sendKeys, gitBranch, listSessions, newTmuxSession, killTmuxSession } from './tmux.js';
import { CHARACTERS } from './characters.js';

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

export function createApp({ config, store, tmux = { listSessions, newTmuxSession, killTmuxSession } }) {
  function authorize(req, res) {
    if (config.TOKEN) {
      const hdr = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
      if (hdr !== config.TOKEN) { res.writeHead(401).end(); return false; }
    }
    if (!LOCAL.has(req.socket.remoteAddress)) { res.writeHead(403).end(); return false; }
    return true;
  }

  let hub;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');

    if (req.method === 'POST' && url.pathname === '/hooks') {
      if (!authorize(req, res)) return;
      let payload;
      try { payload = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      try {
        const { session, fightResult } = applyEvent(store, payload, {
          readUsage, gitBranch, maxContext: config.MAX_CONTEXT, now: () => Date.now(),
        });
        if (session) hub.broadcast({ type: 'session', session: snapOf(session) });
        if (fightResult) hub.broadcast({ type: 'fightResult', ...fightResult });
        store.persist(); // respaldo a disco: sobrevive reinicios del server
      } catch { res.writeHead(500).end(); return; }
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/preview') {
      if (!authorize(req, res)) return;
      const s = store.get(url.searchParams.get('id'));
      const lines = s ? await capturePane(s.tmux || s.name, config.PREVIEW_LINES) : '';
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ lines }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/projects') {
      if (!authorize(req, res)) return;
      const projects = (config.PROJECTS || []).map((dir) => ({ name: basename(dir), dir }));
      const canSpawn = !!(config.ALLOW_SPAWN && projects.length > 0);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ canSpawn, projects }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/spawn') {
      if (!authorize(req, res)) return;
      if (!config.ALLOW_SPAWN) { res.writeHead(403).end(); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      const dir = body && body.dir;
      if (typeof dir !== 'string' || !dir) { res.writeHead(400).end(); return; }
      if (!config.PROJECTS.includes(dir)) { res.writeHead(403).end(); return; }
      const char = body && body.char;
      if (char != null && !CHARACTERS.includes(char)) { res.writeHead(400).end(); return; }
      const name = basename(dir);
      const existing = await tmux.listSessions();
      if (existing.includes(name)) { res.writeHead(409).end(); return; }
      if (char) store.setPendingChar(name, char);
      const ok = await tmux.newTmuxSession(name, dir);
      if (!ok) { res.writeHead(500).end(); return; }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/kill') {
      if (!authorize(req, res)) return;
      if (!config.ALLOW_SPAWN) { res.writeHead(403).end(); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      const id = body && body.id;
      if (typeof id !== 'string' || !id) { res.writeHead(400).end(); return; }
      const s = store.get(id);
      if (!s) { res.writeHead(404).end(); return; }
      await tmux.killTmuxSession(s.tmux || s.name); // best-effort: ignoramos el resultado
      store.remove(id); // ya persiste a disco
      hub.broadcast({ type: 'remove', id });
      res.writeHead(200).end();
      return;
    }

    // estáticos
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = normalize(join(WEB, p));
    if (file !== WEB && !file.startsWith(WEB + sep)) { res.writeHead(403).end(); return; }
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }).end(data);
    } catch { res.writeHead(404).end(); }
  });

  hub = attachWs(server, store, {
    token: config.TOKEN,
    onChat: (id, text) => {
      const s = store.get(id);
      if (s) sendKeys(s.tmux || s.name, text);
    },
  });
  attachTerm(server, store, { token: config.TOKEN });
  return { server, get hub() { return hub; } };
}

// arranque real
if (import.meta.url === `file://${process.argv[1]}`) {
  const store = createStore({ persistPath: config.STATE_PATH });
  const { server } = createApp({ config, store });
  server.listen(config.PORT, config.BIND, () => {
    console.log(`hábitat en http://${config.BIND}:${config.PORT}`);
  });
}
