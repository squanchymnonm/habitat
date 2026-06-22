import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize, sep, basename } from 'node:path';
import config from './config.js';
import { createStore, newSession } from './state.js';
import { readUsage } from './transcript.js';
import { applyEvent } from './hooks-logic.js';
import { attachWs } from './ws.js';
import { attachTerm } from './term.js';
import { capturePane, sendKeys, gitBranch, listSessions, newTmuxSession, killTmuxSession } from './tmux.js';
import { worktreeAdd, worktreeRemove, validBranch, findNestedRepos, containerWorktreeAdd } from './git.js';
import { worktreePaths, worktreeName } from './worktree.js';
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

export function createApp({ config, store, tmux = { listSessions, newTmuxSession, killTmuxSession }, git: gitOverrides = {} }) {
  const git = { worktreeAdd, worktreeRemove, findNestedRepos, containerWorktreeAdd, ...gitOverrides };
  function authorize(req, res) {
    if (config.TOKEN) {
      const hdr = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
      if (hdr !== config.TOKEN) { res.writeHead(401).end(); return false; }
    }
    if (!LOCAL.has(req.socket.remoteAddress)) { res.writeHead(403).end(); return false; }
    return true;
  }

  let hub;
  // Pod provisional: la sesión tmux ya existe pero claude todavía no disparó SessionStart
  // (típicamente esperando el prompt "do you trust this folder?" en un worktree nuevo).
  // Mostramos el pod ya, con su terminal apuntando al tmux, para que aceptes desde ahí.
  // SessionStart luego lo adopta (lo reemplaza por la sesión real).
  function announcePending(tmuxName, fields) {
    const s = newSession(`pending:${tmuxName}`, {
      tmux: tmuxName,
      status: 'waiting',
      action: 'aceptá la confianza en la terminal',
      ...fields,
    });
    store.upsert(s);
    store.persist();
    if (hub) hub.broadcast({ type: 'session', session: snapOf(s) });
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');

    if (req.method === 'POST' && url.pathname === '/hooks') {
      if (!authorize(req, res)) return;
      let payload;
      try { payload = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      try {
        const { session, fightResult, removed } = applyEvent(store, payload, {
          readUsage, gitBranch, maxContext: config.MAX_CONTEXT, now: () => Date.now(),
          worktreeName: config.WORKTREES_DIR ? (cwd) => worktreeName(config.WORKTREES_DIR, cwd) : () => null,
        });
        if (session) hub.broadcast({ type: 'session', session: snapOf(session) });
        if (fightResult) hub.broadcast({ type: 'fightResult', ...fightResult });
        if (removed) hub.broadcast({ type: 'remove', id: removed }); // pod provisional adoptado por la sesión real
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
      const branch = body && body.branch;
      if (branch != null && branch !== '') {
        if (typeof branch !== 'string' || !validBranch(branch)) {
          res.writeHead(400).end(); return;
        }
        const base = (typeof body.base === 'string' && body.base) ? body.base : 'main';
        const nested = await git.findNestedRepos(dir);
        const { path, tmux: tmuxName } = worktreePaths(config.WORKTREES_DIR, basename(dir), branch);
        const existing = await tmux.listSessions();
        if (existing.includes(tmuxName)) { res.writeHead(409).end(); return; }
        if (char) store.setPendingChar(tmuxName, char);
        const ok = nested.length
          ? await git.containerWorktreeAdd(dir, branch, path, nested) // base por repo (origin/HEAD); se ignora `base`
          : await git.worktreeAdd(dir, branch, base, path);
        if (!ok) { res.writeHead(500).end(); return; }
        if (!(await tmux.newTmuxSession(tmuxName, path))) { res.writeHead(500).end(); return; }
        announcePending(tmuxName, { name: basename(dir), project: basename(dir), branch, char });
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: tmuxName }));
        return;
      }
      const name = basename(dir);
      const existing = await tmux.listSessions();
      if (existing.includes(name)) { res.writeHead(409).end(); return; }
      if (char) store.setPendingChar(name, char);
      const ok = await tmux.newTmuxSession(name, dir);
      if (!ok) { res.writeHead(500).end(); return; }
      announcePending(name, { name, project: name, char });
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
      // Sesión por rama (worktree): el tmux es `<proyecto>-<rama>` y difiere del proyecto.
      // Limpiamos el worktree para no dejar la carpeta huérfana (que haría fallar un re-spawn
      // de la misma rama). Best-effort: si tiene cambios sin commitear git lo deja en disco.
      if (config.WORKTREES_DIR && s.project && s.branch && s.tmux && s.tmux !== s.project) {
        const projectDir = (config.PROJECTS || []).find((d) => basename(d) === s.project);
        if (projectDir) {
          const { path } = worktreePaths(config.WORKTREES_DIR, s.project, s.branch);
          const nested = await git.findNestedRepos(projectDir);
          // Contenedor: remover primero los hijos (sin force: si hay cambios sin commitear git
          // rechaza y se deja en disco), luego el padre. Si un hijo queda, el padre tampoco se
          // borra (su carpeta no queda vacía) -> el conjunto sobrevive y un re-spawn lo reutiliza.
          for (const name of nested) {
            await git.worktreeRemove(join(projectDir, name), join(path, name));
          }
          await git.worktreeRemove(projectDir, path);
        }
      }
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
