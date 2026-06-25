import { createServer } from 'node:http';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize, sep, basename, resolve, relative } from 'node:path';
import { existsSync } from 'node:fs';
import config from './config.js';
import { createStore, newSession } from './state.js';
import { createSettings } from './settings.js';
import { createProjects } from './projects.js';
import { readUsage, readLastAssistantText } from './transcript.js';
import { applyEvent, staminaFromStatus, dismissAlert } from './hooks-logic.js';
import { attachWs } from './ws.js';
import { attachTerm } from './term.js';
import { capturePane, sendKeys, gitBranch, listSessions, newTmuxSession, killTmuxSession } from './tmux.js';
import { worktreeAdd, worktreeRemove, validBranch, findNestedRepos, containerWorktreeAdd, remoteDefaultBranch } from './git.js';
import { worktreePaths, worktreeName } from './worktree.js';
import { resolveWithinRoot } from './files.js';
import { CHARACTERS, autoName } from './characters.js';

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

export function createApp({ config, store, settingsStore = createSettings(), projectsStore, tmux = { listSessions, newTmuxSession, killTmuxSession }, git: gitOverrides = {} }) {
  const git = { worktreeAdd, worktreeRemove, findNestedRepos, containerWorktreeAdd, remoteDefaultBranch, ...gitOverrides };
  const projects = projectsStore || createProjects({ seed: config.PROJECTS });
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

  // Lista de proyectos en el shape que consume el cliente (name = label).
  function projectsForClient() {
    return projects.list().map((p) => ({ dir: p.dir, name: p.label, color: p.color, chars: p.chars }));
  }
  function broadcastProjects() {
    if (hub) hub.broadcast({ type: 'projects', projects: projectsForClient() });
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');

    if (req.method === 'POST' && url.pathname === '/hooks') {
      if (!authorize(req, res)) return;
      let payload;
      try { payload = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      try {
        const { session, fightResult, removed, rekey } = applyEvent(store, payload, {
          readUsage, readLastAssistantText, gitBranch, now: () => Date.now(),
          worktreeName: config.WORKTREES_DIR ? (cwd) => worktreeName(config.WORKTREES_DIR, cwd) : () => null,
        });
        if (rekey) {
          // /clear cambia el id del pod: lo mandamos como rekey atómico para que el front
          // lo reemplace en su lugar y conserve la selección (sin push al final ni perder foco).
          hub.broadcast({ type: 'rekey', from: rekey.from, to: rekey.to, session: snapOf(session) });
        } else {
          if (session) hub.broadcast({ type: 'session', session: snapOf(session) });
          if (removed) hub.broadcast({ type: 'remove', id: removed }); // pod provisional adoptado por la sesión real
        }
        if (fightResult) hub.broadcast({ type: 'fightResult', ...fightResult });
        store.persist(); // respaldo a disco: sobrevive reinicios del server
      } catch { res.writeHead(500).end(); return; }
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'POST' && url.pathname === '/status') {
      if (!authorize(req, res)) return;
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      const id = body && body.session_id;
      if (typeof id !== 'string' || !id) { res.writeHead(400).end(); return; }
      const s = store.get(id);
      if (s) {
        const stamina = staminaFromStatus(body);
        if (stamina != null) {
          s.stamina = stamina;
          hub.broadcast({ type: 'session', session: snapOf(s) });
          store.persist();
        }
      }
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

    if (req.method === 'GET' && url.pathname === '/questbook') {
      if (!authorize(req, res)) return;
      const s = store.get(url.searchParams.get('id'));
      if (!s) { res.writeHead(404).end(); return; }
      const book = s._questbook || { synopsis: '', quests: [], events: [] };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(book));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/projects') {
      if (!authorize(req, res)) return;
      const list = projectsForClient();
      const canSpawn = !!(config.ALLOW_SPAWN && list.length > 0);
      const canManage = !!(config.ALLOW_SPAWN && config.PROJECTS_ROOT);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ canSpawn, canManage, projects: list }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/projects/browse') {
      if (!authorize(req, res)) return;
      const root = config.PROJECTS_ROOT;
      if (!config.ALLOW_SPAWN || !root) { res.writeHead(403).end(); return; }
      const rel = (url.searchParams.get('path') || '').replace(/^\/+/, '');
      const target = resolve(root, rel);
      // Guard sintáctico: el target no puede salirse del root.
      if (target !== root && !target.startsWith(root + sep)) { res.writeHead(400).end(); return; }
      let realTarget, realRoot;
      try {
        realTarget = await realpath(target);
        realRoot = await realpath(root);
      } catch { res.writeHead(404).end(); return; }
      // Guard contra symlinks que escapen del root.
      if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) { res.writeHead(400).end(); return; }
      let dirents;
      try { dirents = await readdir(realTarget, { withFileTypes: true }); }
      catch { res.writeHead(404).end(); return; }
      const entries = dirents
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => {
          const childAbs = join(realTarget, d.name);
          const childRel = relative(realRoot, childAbs);
          return {
            name: d.name,
            rel: childRel,
            isRepo: existsSync(join(childAbs, '.git')),
            added: projects.has(childAbs),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      const relFromRoot = relative(realRoot, realTarget);
      const parts = relFromRoot ? relFromRoot.split(sep) : [];
      const breadcrumbs = parts.map((name, i) => ({ name, rel: parts.slice(0, i + 1).join(sep) }));
      res.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ root: basename(realRoot), rel: relFromRoot, breadcrumbs, entries }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/files') {
      if (!authorize(req, res)) return;
      const s = store.get(url.searchParams.get('id') || '');
      if (!s || !s.cwd) { res.writeHead(409).end(); return; }
      const root = s.cwd;
      const rel = (url.searchParams.get('path') || '').replace(/^\/+/, '');
      const target = resolveWithinRoot(root, rel);
      if (!target) { res.writeHead(400).end(); return; }
      let realTarget, realRoot;
      try { realTarget = await realpath(target); realRoot = await realpath(root); }
      catch { res.writeHead(404).end(); return; }
      // Guard anti-symlink: el target real no puede salir del root real.
      if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) { res.writeHead(400).end(); return; }
      let dirents;
      try { dirents = await readdir(realTarget, { withFileTypes: true }); }
      catch { res.writeHead(404).end(); return; }
      const entries = [];
      for (const d of dirents) {
        // Ocultar dotfiles, salvo la carpeta de uploads (para ver lo subido).
        if (d.name.startsWith('.') && d.name !== '.habitat-uploads') continue;
        const abs = join(realTarget, d.name);
        let size = 0;
        if (!d.isDirectory()) { try { size = (await stat(abs)).size; } catch { size = 0; } }
        entries.push({ name: d.name, rel: relative(realRoot, abs), isDir: d.isDirectory(), size });
      }
      // Carpetas primero, después archivos; alfabético dentro de cada grupo.
      entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
      const relFromRoot = relative(realRoot, realTarget);
      const parts = relFromRoot ? relFromRoot.split(sep) : [];
      const breadcrumbs = parts.map((name, i) => ({ name, rel: parts.slice(0, i + 1).join(sep) }));
      res.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ root: basename(realRoot), rel: relFromRoot, breadcrumbs, entries }));
      return;
    }

    // dir absoluto, existente y contenido en PROJECTS_ROOT (para alta).
    async function dirWithinRoot(dir) {
      const root = config.PROJECTS_ROOT;
      if (!root || typeof dir !== 'string' || !dir) return false;
      let real, realRoot;
      try { real = await realpath(dir); realRoot = await realpath(root); }
      catch { return false; }
      return real === realRoot || real.startsWith(realRoot + sep);
    }

    if (req.method === 'POST' && url.pathname === '/projects') {
      if (!authorize(req, res)) return;
      if (!config.ALLOW_SPAWN) { res.writeHead(403).end(); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      let dir = body && body.dir;
      if (typeof dir === 'string' && dir && !dir.startsWith(sep)) {
        dir = resolve(config.PROJECTS_ROOT || '', dir); // el cliente manda rel respecto del root
      }
      if (!(await dirWithinRoot(dir))) { res.writeHead(400).end(); return; }
      const r = projects.add({ dir, label: body.label, color: body.color, chars: body.chars });
      if (!r.ok) { res.writeHead(r.error === 'duplicado' ? 409 : 400).end(); return; }
      broadcastProjects();
      res.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ dir: r.record.dir, name: r.record.label, color: r.record.color, chars: r.record.chars }));
      return;
    }

    if (req.method === 'PATCH' && url.pathname === '/projects') {
      if (!authorize(req, res)) return;
      if (!config.ALLOW_SPAWN) { res.writeHead(403).end(); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      if (!body || typeof body.dir !== 'string') { res.writeHead(400).end(); return; }
      if (!projects.has(body.dir)) { res.writeHead(404).end(); return; }
      const r = projects.update({ dir: body.dir, label: body.label, color: body.color, chars: body.chars });
      if (!r.ok) { res.writeHead(400).end(); return; }
      broadcastProjects();
      res.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ dir: r.record.dir, name: r.record.label, color: r.record.color, chars: r.record.chars }));
      return;
    }

    if (req.method === 'DELETE' && url.pathname === '/projects') {
      if (!authorize(req, res)) return;
      if (!config.ALLOW_SPAWN) { res.writeHead(403).end(); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      if (!body || typeof body.dir !== 'string') { res.writeHead(400).end(); return; }
      if (!projects.remove(body.dir)) { res.writeHead(404).end(); return; }
      broadcastProjects();
      res.writeHead(200).end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/settings') {
      if (!authorize(req, res)) return;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(settingsStore.get()));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/settings') {
      if (!authorize(req, res)) return;
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      if (!settingsStore.set(body)) { res.writeHead(400).end(); return; }
      const settings = settingsStore.get();
      hub.broadcast({ type: 'settings', settings });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(settings));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/spawn') {
      if (!authorize(req, res)) return;
      if (!config.ALLOW_SPAWN) { res.writeHead(403).end(); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      const dir = body && body.dir;
      if (typeof dir !== 'string' || !dir) { res.writeHead(400).end(); return; }
      if (!projects.has(dir)) { res.writeHead(403).end(); return; }
      const char = body && body.char;
      if (char != null && !CHARACTERS.includes(char)) { res.writeHead(400).end(); return; }
      const allowed = (projects.list().find((p) => p.dir === dir) || {}).chars || [];
      if (char != null && allowed.length && !allowed.includes(char)) { res.writeHead(400).end(); return; }
      const { permissionMode } = settingsStore.get(); // setting global: aplica a toda sesión nueva

      const projectName = basename(dir);
      // Nombre de personaje: provisto o autogenerado (evitando los ya usados globalmente).
      let name = body && body.name;
      if (name == null || name === '') {
        const used = store.all().map((s) => s.name);
        name = autoName(used);
      } else if (typeof name !== 'string' || !validBranch(name)) {
        res.writeHead(400).end(); return;
      }

      const nested = await git.findNestedRepos(dir);
      const { path, tmux: tmuxName } = worktreePaths(config.WORKTREES_DIR, projectName, name);
      const existing = await tmux.listSessions();
      if (existing.includes(tmuxName)) { res.writeHead(409).end(); return; }
      if (char) store.setPendingChar(tmuxName, char);
      // base = rama default del repo (origin/HEAD), resuelta automáticamente.
      const base = await git.remoteDefaultBranch(dir);
      const ok = nested.length
        ? await git.containerWorktreeAdd(dir, name, path, nested) // base por repo (origin/HEAD)
        : await git.worktreeAdd(dir, name, base, path);
      if (!ok) { res.writeHead(500).end(); return; }
      if (!(await tmux.newTmuxSession(tmuxName, path, undefined, { permissionMode }))) { res.writeHead(500).end(); return; }
      announcePending(tmuxName, { name, project: projectName, branch: name, char });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: tmuxName }));
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
        const projectDir = (projects.list().find((p) => basename(p.dir) === s.project) || {}).dir;
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

    if (req.method === 'POST' && url.pathname === '/sessions/order') {
      if (!authorize(req, res)) return;
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      const order = body && body.order;
      if (!Array.isArray(order) || !order.every((x) => typeof x === 'string')) { res.writeHead(400).end(); return; }
      store.reorder(order);
      hub.broadcast({ type: 'reorder', order }); // sincroniza el orden a todos los clientes
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
    // Descarte manual de alerta desde la GUI (click en el globo): waiting/error -> idle.
    onDismiss: (id) => {
      const s = store.get(id);
      if (s && dismissAlert(s, () => Date.now())) {
        store.upsert(s);
        store.persist();
        hub.broadcast({ type: 'session', session: snapOf(s) });
      }
    },
  });
  attachTerm(server, store, { token: config.TOKEN });
  return { server, get hub() { return hub; } };
}

// arranque real
if (import.meta.url === `file://${process.argv[1]}`) {
  // Red de seguridad: una excepción no capturada (p.ej. un PTY que muere en pleno
  // write/resize -> EBADF) NO debe tumbar el proceso. Si cayera, systemd lo reinicia y
  // —por KillMode=control-group— ese restart se llevaría puesto el server tmux y TODAS
  // las sesiones. Preferimos loguear y seguir vivos: el panel es un monitor, no vale la
  // pena morir por una terminal rota.
  process.on('uncaughtException', (err) => {
    console.error('[habitat] uncaughtException (ignorada, el server sigue):', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[habitat] unhandledRejection (ignorada, el server sigue):', reason);
  });
  const store = createStore({ persistPath: config.STATE_PATH });
  const settingsStore = createSettings({ persistPath: config.SETTINGS_PATH });
  const projectsStore = createProjects({ persistPath: config.PROJECTS_STATE, seed: config.PROJECTS });
  const { server } = createApp({ config, store, settingsStore, projectsStore });
  server.listen(config.PORT, config.BIND, () => {
    console.log(`hábitat en http://${config.BIND}:${config.PORT}`);
  });
}
