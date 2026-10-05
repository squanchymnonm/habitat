import { createServer } from 'node:http';
import { readFile, readdir, realpath, stat, mkdir, writeFile, rename, unlink, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize, sep, basename, resolve, relative } from 'node:path';
import { existsSync, readdirSync, createWriteStream } from 'node:fs';
import config from './config.js';
import { createStore, newSession } from './state.js';
import { createSettings } from './settings.js';
import { readUsage, readLastAssistantText } from './transcript.js';
import { applyEvent, staminaFromStatus, usageFromStatus, dismissAlert } from './hooks-logic.js';
import { attachWs } from './ws.js';
import { attachTerm } from './term.js';
import { capturePane, sendKeys, gitBranch, listSessions, newTmuxSession, killTmuxSession } from './tmux.js';
import { worktreeAdd, worktreeRemove, validBranch, findNestedRepos, containerWorktreeAdd, remoteDefaultBranch, resolveRepo, defaultExec } from './git.js';
import { workingStatus, branchOverview, commits as gitCommits, filePatch, fullLog } from './git-read.js';
import * as gitWrite from './git-write.js';
import * as gitBranches from './git-branches.js';
import * as gitStash from './git-stash.js';
import { prCreate, parseRepo, repoList, repoClone } from './gh.js';
import { createLocks } from './locks.js';
import { worktreePaths, worktreeName } from './worktree.js';
import { downForDir, downOrphans } from './docker.js';
import { resolveWithinRoot, sanitizeFilename, uniqueName, maxUploadBytes } from './files.js';
import { openInEditor } from './editor.js';
import { CHARACTERS, autoName } from './characters.js';
import { createSessionStore } from './sessions.js';
import { verifyPassword } from './password.js';
import { isAuthenticated, parseCookies, COOKIE_NAME } from './auth.js';
import { createProjects, hasConfig } from './projects.js';
import { createEnvStore } from './env-store.js';
import { scan } from './env-template.js';
import { allocatePorts, usedPorts, probePort as defaultProbePort } from './ports.js';
import { prepareSession, teardownRelated, RELATED_DIR } from './session-setup.js';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
// Contador de parciales de upload, para que dos subidas simultáneas no pisen el mismo .part.
let uploadSeq = 0;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

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

// Vuelca el body en `path` a medida que llega, sin bufferearlo en memoria (un dump
// de 1GB no entra en RAM). Corta si supera `maxBytes` -> rechaza con 'too large'.
// Ante el corte NO destruye el request: sólo lo pausa, para que el caller pueda
// responder 413 sobre un socket todavía vivo (ver responderDemasiadoGrande).
// El archivo parcial queda en disco; borrarlo es responsabilidad del caller.
function streamBodyToFile(req, path, maxBytes) {
  return new Promise((resolveP, reject) => {
    const out = createWriteStream(path);
    let size = 0;
    let settled = false;
    const settle = (err) => {
      if (settled) return;
      settled = true;
      req.off('data', onData);
      if (err) { out.destroy(); reject(err); }
      else out.end(() => resolveP(size));
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { req.pause(); settle(new Error('too large')); return; }
      // Backpressure: si el disco no da abasto, frenamos la lectura del socket.
      if (!out.write(chunk)) { req.pause(); out.once('drain', () => req.resume()); }
    };
    req.on('data', onData);
    req.on('end', () => settle(null));
    req.on('aborted', () => settle(new Error('body error')));
    req.on('error', () => settle(new Error('body error')));
    out.on('error', () => settle(new Error('write error')));
  });
}

// Responde 413 mientras el cliente todavía está subiendo. Dos detalles no negociables:
// cerrar con FIN (socket.end) y no con destroy -> un RST le borra al cliente la respuesta
// ya recibida, y el proxy de Tailscale delante lo traduce a un 502 que no dice nada.
function responderDemasiadoGrande(req, res, { max, needsPassword }) {
  const body = JSON.stringify({ error: 'too large', max, needsPassword });
  res.writeHead(413, { 'content-type': 'application/json', connection: 'close' })
    .end(body, () => req.socket.end());
}

export function createApp({ config, store, settingsStore = createSettings(), projectsStore, sessionStore = createSessionStore({ persistPath: config.SESSIONS_PATH, ttlMs: config.SESSION_TTL_MS }), tmux = { listSessions, newTmuxSession, killTmuxSession }, git: gitOverrides = {}, editor = { openInEditor }, docker = { downForDir, downOrphans }, gh: ghOverrides = {}, envStore = createEnvStore({ dir: config.ENVS_DIR }), probePort = defaultProbePort }) {
  const git = { worktreeAdd, worktreeRemove, findNestedRepos, containerWorktreeAdd, remoteDefaultBranch, exec: defaultExec, ...gitOverrides };
  const gh = { repoList, repoClone, ...ghOverrides };
  const projects = projectsStore || createProjects({ seed: config.PROJECTS });
  // Puertos asignados por un spawn en vuelo que todavía no está en el store: sin esto dos
  // spawns simultáneos podrían recibir el mismo puerto.
  const reservedPorts = new Set();
  // Las asignaciones van en fila: `used` se toma antes de los probes (que son async) y la
  // reserva recién al final, así que dos asignaciones solapadas podían elegir el mismo puerto.
  let allocChain = Promise.resolve();
  function allocateForSpawn(names) {
    const p = allocChain.then(async () => {
      const used = new Set([...usedPorts(store.all()), ...reservedPorts]);
      const r = await allocatePorts(names, { range: config.PORT_RANGE || [20000, 29999], used, probe: probePort });
      if (r.ok) for (const port of Object.values(r.ports)) reservedPorts.add(port);
      return r;
    });
    allocChain = p.catch(() => {});
    return p;
  }
  // Whitelist de owners para clonar, normalizada: GitHub no distingue mayúsculas.
  const cloneOwners = (config.CLONE_OWNERS || []).map((o) => o.toLowerCase());
  const locks = createLocks();
  // Autoriza endpoints sensibles (hooks, spawn, gestión, upload). Antes exigía loopback
  // (LOCAL); detrás de Tailscale Serve toda conexión llega como loopback, así que ese gate
  // dejó de aislar. La barrera real es la auth: cookie de sesión o token (Bearer/?token=).
  function authorize(req, res) {
    if (!isAuthenticated(req, { sessionStore, token: config.TOKEN })) { res.writeHead(401).end(); return false; }
    return true;
  }

  // Resuelve el repo scopeado por ?path=. Escribe la respuesta de error y devuelve
  // null si no se puede. 400 = el path escapa del worktree (input inválido);
  // 409 = no hay sesión/cwd, o ahí no hay repo git usable (estado, no input).
  // El 409 lleva cuerpo { reason } para que el cliente pueda decir POR QUÉ: antes
  // mostraba "sin repo git acá" incluso cuando SÍ había repo y el motivo real era
  // que su raíz cae fuera del alcance de la sesión (ver resolveRepo en git.js).
  function conflict(res, reason) {
    res.writeHead(409, { 'content-type': 'application/json' }).end(JSON.stringify({ reason }));
    return null;
  }
  async function resolveRepoOr(res, s, url) {
    if (!s || !s.cwd) return conflict(res, 'sin-sesion');
    const rel = (url.searchParams.get('path') || '').replace(/^\/+/, '');
    if (resolveWithinRoot(s.cwd, rel) === null) { res.writeHead(400).end(); return null; }
    const repo = await resolveRepo(s.cwd, rel);
    if (!repo) return conflict(res, 'sin-repo');
    if (repo.error) return conflict(res, repo.error);
    return repo;
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

  // Path del worktree de la sesión, o null si es una sesión "plana" (abierta sobre el
  // repo principal). La distinción importa para docker: en un worktree los containers los
  // levantó esta sesión; en el repo principal son el entorno de desarrollo del usuario.
  // La rama de creación (infra.branch) manda sobre s.branch, que un checkout pisa.
  function sessionWorktree(s) {
    const branch = s && ((s.infra && s.infra.branch) || s.branch);
    if (!config.WORKTREES_DIR || !s || !s.project || !branch || !s.tmux || s.tmux === s.project) return null;
    return worktreePaths(config.WORKTREES_DIR, s.project, branch).path;
  }

  // ¿Quedó algo dentro de <worktree>/.habitat-related/? (los relacionados removidos dejan
  // la carpeta vacía).
  function hasLeftoverRelated(wtPath) {
    try { return readdirSync(join(wtPath, RELATED_DIR)).length > 0; } catch { return false; }
  }

  // Baja (o lista, con dryRun) los stacks de compose de un worktree. Best-effort: si el
  // daemon no está o docker no existe, devolvemos [] y seguimos — cerrar una sesión nunca
  // puede fallar por docker.
  async function dockerDown(dir, { dryRun = false } = {}) {
    try {
      return await docker.downForDir(dir, { root: config.WORKTREES_DIR, dryRun });
    } catch (err) {
      console.error('[habitat] docker down falló (ignorado):', err && err.message);
      return [];
    }
  }

  // Lista de proyectos en el shape que consume el cliente (name = label).
  function projectsForClient() {
    return projects.list().map((p) => ({
      dir: p.dir, name: p.label, color: p.color, chars: p.chars,
      related: p.related.map((r) => ({ ...r, exists: existsSync(r.dir) })),
      infra: p.infra, envFiles: p.envFiles,
    }));
  }
  function broadcastProjects() {
    if (hub) hub.broadcast({ type: 'projects', projects: projectsForClient() });
  }

  const loginEnabled = !!(config.USER && config.PASSWORD_HASH);
  const fails = new Map(); // user -> { count, lockedUntil }
  const LOCK_AFTER = 5;
  const LOCK_MS = 60_000;

  function setSessionCookie(res, id) {
    const attrs = [`${COOKIE_NAME}=${id}`, 'HttpOnly', 'Path=/', 'SameSite=Strict', `Max-Age=${Math.floor(config.SESSION_TTL_MS / 1000)}`];
    if (config.COOKIE_SECURE) attrs.push('Secure');
    res.setHeader('Set-Cookie', attrs.join('; '));
  }
  function clearSessionCookie(res) {
    const attrs = [`${COOKIE_NAME}=`, 'HttpOnly', 'Path=/', 'SameSite=Strict', 'Max-Age=0'];
    if (config.COOKIE_SECURE) attrs.push('Secure');
    res.setHeader('Set-Cookie', attrs.join('; '));
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
        const usage = usageFromStatus(body);
        if (usage) {
          store.setUsage(usage);
          hub.broadcast({ type: 'usage', usage });
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
      const canClone = canManage && cloneOwners.length > 0;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ canSpawn, canManage, canClone, projects: list }));
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

    // Repos clonables: los de cada owner de la whitelist, más nuevos primero. Un owner
    // que falla (sin acceso, gh caído) se reporta aparte sin tapar a los demás.
    if (req.method === 'GET' && url.pathname === '/projects/repos') {
      if (!authorize(req, res)) return;
      if (!config.ALLOW_SPAWN || !config.PROJECTS_ROOT || cloneOwners.length === 0) { res.writeHead(403).end(); return; }
      const results = await Promise.all(config.CLONE_OWNERS.map(async (owner) => ({ owner, r: await gh.repoList(owner) })));
      const repos = [];
      const errors = [];
      for (const { owner, r } of results) {
        if (!r.ok) { errors.push({ owner, message: r.message }); continue; }
        for (const repo of r.repos) repos.push({ ...repo, cloned: existsSync(join(config.PROJECTS_ROOT, repo.name)) });
      }
      repos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ repos, errors }));
      return;
    }

    // Clona owner/name en PROJECTS_ROOT/name. No registra el proyecto: el cliente sigue
    // con el alta normal (POST /projects) para elegir color y personajes.
    if (req.method === 'POST' && url.pathname === '/projects/clone') {
      if (!authorize(req, res)) return;
      if (!config.ALLOW_SPAWN || !config.PROJECTS_ROOT || cloneOwners.length === 0) { res.writeHead(403).end(); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      const parsed = parseRepo(body && body.repo);
      if (!parsed) { res.writeHead(400).end(); return; }
      if (!cloneOwners.includes(parsed.owner.toLowerCase())) { res.writeHead(403).end(); return; }
      let realRoot;
      try { realRoot = await realpath(config.PROJECTS_ROOT); } catch { res.writeHead(500).end(); return; }
      const dest = join(realRoot, parsed.name);
      let r;
      try {
        r = await locks.run(`clone:${dest}`, async () => {
          if (existsSync(dest)) return null;
          const out = await gh.repoClone(`${parsed.owner}/${parsed.name}`, dest);
          // Un clone cortado (timeout, red) deja la carpeta a medio crear y bloquearía
          // el reintento con 409. La borramos: antes de clonar no existía, es nuestra.
          if (!out.ok) await rm(dest, { recursive: true, force: true }).catch(() => {});
          return out;
        });
      } catch (e) {
        res.writeHead(e && e.message === 'busy' ? 409 : 500).end();
        return;
      }
      if (r === null) { res.writeHead(409).end(); return; }
      const payload = r.ok ? { ok: true, rel: parsed.name, dir: dest } : r;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
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

    if (req.method === 'GET' && url.pathname === '/tree') {
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
      if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) { res.writeHead(400).end(); return; }
      let dirents;
      try { dirents = await readdir(realTarget, { withFileTypes: true }); }
      catch { res.writeHead(404).end(); return; }
      const entries = [];
      for (const d of dirents) {
        // Sin filtro: mostramos TODO (incluidos dotfiles y .git/).
        const abs = join(realTarget, d.name);
        let size = 0;
        if (!d.isDirectory()) { try { size = (await stat(abs)).size; } catch { size = 0; } }
        // isRepo: subcarpeta que es repo git. El propio '.git' no cuenta.
        let isRepo = false;
        if (d.isDirectory() && d.name !== '.git') {
          try { await stat(join(abs, '.git')); isRepo = true; } catch { /* no es repo */ }
        }
        entries.push({ name: d.name, rel: relative(realRoot, abs), isDir: d.isDirectory(), size, isRepo });
      }
      entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
      const relFromRoot = relative(realRoot, realTarget);
      const parts = relFromRoot ? relFromRoot.split(sep) : [];
      const breadcrumbs = parts.map((name, i) => ({ name, rel: parts.slice(0, i + 1).join(sep) }));
      res.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ root: basename(realRoot), rel: relFromRoot, breadcrumbs, entries }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/file') {
      if (!authorize(req, res)) return;
      const s = store.get(url.searchParams.get('id') || '');
      if (!s || !s.cwd) { res.writeHead(409).end(); return; }
      const root = s.cwd;
      const rel = (url.searchParams.get('path') || '').replace(/^\/+/, '');
      const target = resolveWithinRoot(root, rel);
      if (!target) { res.writeHead(400).end(); return; }
      let realTarget, realRoot, st;
      try { realTarget = await realpath(target); realRoot = await realpath(root); st = await stat(realTarget); }
      catch { res.writeHead(404).end(); return; }
      if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) { res.writeHead(400).end(); return; }
      if (!st.isFile()) { res.writeHead(400).end(); return; }
      const send = (obj) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
      if (st.size > config.FILE_MAX_BYTES) { send({ tooLarge: true, size: st.size }); return; }
      let buf;
      try { buf = await readFile(realTarget); } catch { res.writeHead(404).end(); return; }
      if (buf.includes(0)) { send({ binary: true, size: st.size }); return; }
      send({ text: buf.toString('utf8'), size: st.size });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/git/status') {
      if (!authorize(req, res)) return;
      const s = store.get(url.searchParams.get('id') || '');
      const repo = await resolveRepoOr(res, s, url);
      if (!repo) return;
      try {
        const [working, overview, log] = await Promise.all([
          workingStatus(repo.dir), branchOverview(repo.dir), gitCommits(repo.dir),
        ]);
        res.writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ working, overview, commits: log, repo: { rel: repo.rel, name: repo.name } }));
      } catch { res.writeHead(500).end(); }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/git/branches') {
      if (!authorize(req, res)) return;
      const s = store.get(url.searchParams.get('id') || '');
      const repo = await resolveRepoOr(res, s, url);
      if (!repo) return;
      try {
        const out = await gitBranches.listBranches(repo.dir);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
      } catch { res.writeHead(500).end(); }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/git/stash') {
      if (!authorize(req, res)) return;
      const s = store.get(url.searchParams.get('id') || '');
      const repo = await resolveRepoOr(res, s, url);
      if (!repo) return;
      try {
        const out = await gitStash.stashList(repo.dir);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
      } catch { res.writeHead(500).end(); }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/git/log') {
      if (!authorize(req, res)) return;
      const s = store.get(url.searchParams.get('id') || '');
      const repo = await resolveRepoOr(res, s, url);
      if (!repo) return;
      try {
        const out = await fullLog(repo.dir, {
          limit: url.searchParams.get('limit'),
          skip: url.searchParams.get('skip'),
        });
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
      } catch { res.writeHead(500).end(); }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/git/diff') {
      if (!authorize(req, res)) return;
      const s = store.get(url.searchParams.get('id') || '');
      const repo = await resolveRepoOr(res, s, url);
      if (!repo) return;
      const file = url.searchParams.get('file') || '';
      const base = url.searchParams.get('base') || 'working';
      if (!file || resolveWithinRoot(repo.dir, file) === null) { res.writeHead(400).end(); return; }
      try {
        const out = await filePatch(repo.dir, file, base);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
      } catch { res.writeHead(500).end(); }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/git/action') {
      if (!authorize(req, res)) return;
      const s = store.get(url.searchParams.get('id') || '');
      const repo = await resolveRepoOr(res, s, url);
      if (!repo) return;
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      const { action, paths, message, branch, from, index } = body || {};
      if (paths !== undefined) {
        if (!Array.isArray(paths)) { res.writeHead(400).end(); return; }
        for (const p of paths) {
          if (typeof p !== 'string' || resolveWithinRoot(repo.dir, p) === null) { res.writeHead(400).end(); return; }
        }
      }
      if (branch !== undefined && typeof branch !== 'string') { res.writeHead(400).end(); return; }
      let r;
      try {
        r = await locks.run(repo.dir, async () => {
          switch (action) {
            case 'stage': return gitWrite.stage(repo.dir, paths);
            case 'unstage': return gitWrite.unstage(repo.dir, paths);
            case 'discard': return gitWrite.discard(repo.dir, paths);
            case 'commit': return gitWrite.commit(repo.dir, message);
            case 'push': return gitWrite.push(repo.dir);
            case 'pull': return gitWrite.pull(repo.dir);
            case 'merge-default': return gitWrite.mergeDefault(repo.dir);
            case 'abort': return gitWrite.abort(repo.dir);
            case 'checkout': return gitBranches.checkout(repo.dir, branch);
            case 'branch-create': return gitBranches.createBranch(repo.dir, branch, from);
            case 'stash-push': return gitStash.stashPush(repo.dir, message);
            case 'stash-apply': return gitStash.stashApply(repo.dir, index);
            case 'stash-drop': return gitStash.stashDrop(repo.dir, index);
            case 'fetch': return gitWrite.fetchRemote(repo.dir);
            case 'amend': return gitWrite.amend(repo.dir, message);
            case 'pr-create': return prCreate(repo.dir);
            default: return null; // acción desconocida
          }
        });
      } catch (e) {
        res.writeHead(e && e.message === 'busy' ? 409 : 500).end();
        return;
      }
      if (r === null) { res.writeHead(400).end(); return; }
      // Tras un checkout el branch de la sesión quedó stale: refrescarlo ya, sin
      // esperar al próximo hook. hooks-logic lo reconfirma después. persist() para
      // que sobreviva un reinicio, y broadcast para que la card (SessionPod, que
      // pinta session.branch del snapshot de WS) lo muestre ya, no en el próximo hook.
      // Se muta la MISMA referencia en vez de upsertear una copia ({ ...s, branch }):
      // la copia reemplaza el objeto sesión entero por un snapshot potencialmente
      // viejo y pierde cualquier campo que otro handler (hooks) haya escrito
      // mientras la acción git estaba en vuelo.
      if (r.ok && r.branch && s.cwd === repo.dir) {
        s.branch = r.branch;
        store.upsert(s);
        store.persist();
        hub.broadcast({ type: 'session', session: snapOf(s) });
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(r));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/files/upload') {
      if (!authorize(req, res)) return;
      const s = store.get(url.searchParams.get('id') || '');
      if (!s || !s.cwd) { res.writeHead(409).end(); return; }
      const root = s.cwd;
      let rawName = req.headers['x-filename'] || '';
      try { rawName = decodeURIComponent(rawName); } catch { /* dejar tal cual */ }
      const name = sanitizeFilename(rawName);
      const max = maxUploadBytes({
        cap: config.UPLOAD_MAX_BYTES,
        configuredPassword: config.UPLOAD_PASSWORD,
        providedPassword: req.headers['x-upload-password'] || '',
      });
      // El destino se resuelve ANTES de leer el body: como el body se escribe en disco
      // a medida que llega, necesitamos el path de destino de entrada.
      const dir = resolveWithinRoot(root, '.habitat-uploads');
      if (!dir) { res.writeHead(400).end(); return; }
      await mkdir(dir, { recursive: true });
      // Guard anti-symlink en el destino: si .habitat-uploads es un symlink que
      // escapa del cwd del pod, no escribimos fuera del root (mismo check que GET /files).
      let realDir, realRoot;
      try { realDir = await realpath(dir); realRoot = await realpath(root); }
      catch { res.writeHead(400).end(); return; }
      if (realDir !== realRoot && !realDir.startsWith(realRoot + sep)) { res.writeHead(400).end(); return; }
      // readdir->uniqueName->rename no es atómico (TOCTOU); aceptable para uso single-user.
      let taken;
      try { taken = new Set(await readdir(realDir)); } catch { taken = new Set(); }
      const finalName = uniqueName(name, taken);
      // Se escribe primero en un parcial oculto y recién al final se renombra: así una
      // subida cortada nunca aparece en el browser como un archivo entero.
      const partPath = join(realDir, `.subiendo-${uploadSeq++}.part`);
      try { await streamBodyToFile(req, partPath, max); }
      catch (e) {
        await unlink(partPath).catch(() => {});
        if (e.message === 'too large') {
          responderDemasiadoGrande(req, res, { max, needsPassword: !!config.UPLOAD_PASSWORD });
        } else res.writeHead(400).end();
        return;
      }
      await rename(partPath, join(realDir, finalName));
      res.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ rel: join('.habitat-uploads', finalName) }));
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

    const MAX_ENV_BYTES = 256 * 1024;
    const projectJson = (r) => ({
      dir: r.dir, name: r.label, color: r.color, chars: r.chars,
      related: r.related.map((x) => ({ ...x, exists: existsSync(x.dir) })), infra: r.infra, envFiles: r.envFiles,
    });
    const sendJson = (status, obj) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
    // Dir del checkout principal de un repo del proyecto ('self' o un relacionado).
    const repoDirOf = (proj, repo) => (repo === 'self' ? proj.dir : (proj.related.find((r) => r.name === repo) || {}).dir);
    const hasEnvFile = (proj, repo, path) => proj.envFiles.some((e) => e.repo === repo && e.path === path);

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
      const before = projects.get(body.dir);
      if (!before) { res.writeHead(404).end(); return; }
      const touchesConfig = body.related !== undefined || body.infra !== undefined || body.envFiles !== undefined;
      if (touchesConfig) {
        if (Array.isArray(body.related)) {
          for (const r of body.related) {
            // El cliente manda rel (respecto de PROJECTS_ROOT) para los recién elegidos.
            if (r && typeof r.dir === 'string' && r.dir && !r.dir.startsWith(sep)) r.dir = resolve(config.PROJECTS_ROOT || '', r.dir);
            if (!r || typeof r.dir !== 'string' || !(await dirWithinRoot(r.dir))) { sendJson(400, { error: `relacionado ${r && r.name}: no existe o está fuera de la carpeta de proyectos` }); return; }
            if (!existsSync(join(r.dir, '.git'))) { sendJson(400, { error: `relacionado ${r.name}: no es un repo git` }); return; }
          }
        }
        if ((await git.findNestedRepos(body.dir)).length) { sendJson(400, { error: 'un proyecto contenedor no admite relacionados ni infra' }); return; }
      }
      const r = projects.update({
        dir: body.dir, label: body.label, color: body.color, chars: body.chars,
        related: body.related, infra: body.infra, envFiles: body.envFiles,
      });
      if (!r.ok) { sendJson(400, { error: r.error }); return; }
      // Plantillas de envFiles que dejaron de existir: se borran (tienen secretos). El store
      // puede tirar sincrónico (EACCES, ENAMETOOLONG): sin catch el request quedaría colgado.
      try {
        for (const e of before.envFiles) {
          if (!hasEnvFile(r.record, e.repo, e.path)) envStore.remove(basename(before.dir), e.repo, e.path);
        }
      } catch (err) {
        broadcastProjects(); // la config sí cambió
        sendJson(500, { error: `no se pudieron borrar plantillas: ${err.message}` });
        return;
      }
      broadcastProjects();
      sendJson(200, projectJson(r.record));
      return;
    }

    if (req.method === 'DELETE' && url.pathname === '/projects') {
      if (!authorize(req, res)) return;
      if (!config.ALLOW_SPAWN) { res.writeHead(403).end(); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      if (!body || typeof body.dir !== 'string') { res.writeHead(400).end(); return; }
      if (!projects.remove(body.dir)) { res.writeHead(404).end(); return; }
      try { envStore.removeProject(basename(body.dir)); } catch (err) {
        broadcastProjects(); // el proyecto sí se quitó
        sendJson(500, { error: `no se pudieron borrar las plantillas: ${err.message}` });
        return;
      }
      broadcastProjects();
      res.writeHead(200).end();
      return;
    }

    if (url.pathname === '/projects/env' || url.pathname === '/projects/env/import') {
      if (!authorize(req, res)) return;
      if (!config.ALLOW_SPAWN) { res.writeHead(403).end(); return; }
      const isImport = url.pathname === '/projects/env/import';
      const isPut = req.method === 'PUT' && !isImport;
      if (!isPut && req.method !== 'GET') { res.writeHead(405).end(); return; }
      let q;
      if (isPut) {
        let raw;
        try { raw = await readBody(req); } catch { res.writeHead(400).end(); return; }
        if (Buffer.byteLength(raw) > MAX_ENV_BYTES) { res.writeHead(413).end(); return; }
        try { q = JSON.parse(raw); } catch { res.writeHead(400).end(); return; }
      } else {
        q = { dir: url.searchParams.get('dir'), repo: url.searchParams.get('repo'), path: url.searchParams.get('path') };
      }
      const proj = q && typeof q.dir === 'string' ? projects.get(q.dir) : null;
      if (!proj) { res.writeHead(404).end(); return; }
      const project = basename(proj.dir);
      if (isImport) {
        const repoDir = repoDirOf(proj, q.repo);
        if (!repoDir || typeof q.path !== 'string' || !q.path) { res.writeHead(404).end(); return; }
        const target = resolve(repoDir, q.path);
        if (!target.startsWith(repoDir + sep)) { res.writeHead(400).end(); return; }
        let realTarget, realRepo;
        try { realTarget = await realpath(target); realRepo = await realpath(repoDir); }
        catch { res.writeHead(404).end(); return; }
        if (!realTarget.startsWith(realRepo + sep)) { res.writeHead(400).end(); return; }
        try { sendJson(200, { content: await readFile(realTarget, 'utf8') }); }
        catch { res.writeHead(404).end(); }
        return;
      }
      if (!hasEnvFile(proj, q.repo, q.path)) { res.writeHead(404).end(); return; }
      if (!isPut) { sendJson(200, { content: envStore.get(project, q.repo, q.path) }); return; }
      if (typeof q.content !== 'string') { res.writeHead(400).end(); return; }
      const { unknown } = scan(q.content, ['self', ...proj.related.map((r) => r.name)]);
      if (unknown.length) { sendJson(400, { unknown }); return; }
      try { envStore.set(project, q.repo, q.path, q.content); } catch (err) {
        sendJson(500, { error: `no se pudo guardar la plantilla: ${err.message}` });
        return;
      }
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
      // worktreeAdd reutiliza un worktree que ya esté en la ruta (típico: un cierre previo
      // lo dejó en disco porque tenía cambios). Ése no se borra nunca en un rollback.
      const existed = existsSync(path);
      const ok = nested.length
        ? await git.containerWorktreeAdd(dir, name, path, nested) // base por repo (origin/HEAD)
        : await git.worktreeAdd(dir, name, base, path);
      if (!ok) { res.writeHead(500).end(); return; }
      const proj = projects.get(dir);
      let infra = null;
      // Puertos reservados por ESTE spawn (no los de infra.ports: prepareSession puede
      // fallar en su fase de escritura —symlink, fs— DESPUÉS de haber asignado puertos,
      // y ahí infra queda null pero reservedPorts ya los tiene tomados).
      const reserved = [];
      const allocate = async (names) => {
        const r = await allocateForSpawn(names);
        if (r.ok) reserved.push(...Object.values(r.ports));
        return r;
      };
      const releasePorts = () => { for (const p of reserved) reservedPorts.delete(p); };
      // Extras de sesión (relacionados, .env, CLAUDE.local.md). No aplica a contenedores.
      if (!nested.length && hasConfig(proj)) {
        const r = await prepareSession({ project: proj, projectName, branch: name, wtPath: path, envStore, allocate, git });
        if (!r.ok) {
          releasePorts();
          // todo o nada, pero sólo si lo creó este spawn (recién creado = sin trabajo)
          if (!existed) await git.worktreeRemove(dir, path, { force: true });
          res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: r.error }));
          return;
        }
        infra = r.infra;
      }
      if (!(await tmux.newTmuxSession(tmuxName, path, undefined, { permissionMode }))) { releasePorts(); res.writeHead(500).end(); return; }
      announcePending(tmuxName, { name, project: projectName, branch: name, char, ...(infra ? { infra } : {}) });
      releasePorts(); // ya están en el store (session.infra.ports)
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: tmuxName }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/editor/open') {
      if (!authorize(req, res)) return;
      const s = store.get(url.searchParams.get('id') || '');
      if (!s || !s.cwd) { res.writeHead(409).end(); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      const path = body && body.path;
      const target = (typeof path === 'string' && path) ? resolveWithinRoot(s.cwd, path) : null;
      if (!target) { res.writeHead(400).end(); return; }
      // Guard anti-symlink: el archivo puede no existir aún (nvim lo crea), así que
      // realpathamos el ancestro existente más profundo (target → padre → … → root).
      let checkPath = target;
      while (checkPath !== s.cwd && !existsSync(checkPath)) { checkPath = dirname(checkPath); }
      let realRoot, realCheck;
      try { realRoot = await realpath(s.cwd); realCheck = await realpath(checkPath); }
      catch { res.writeHead(400).end(); return; }
      if (realCheck !== realRoot && !realCheck.startsWith(realRoot + sep)) { res.writeHead(400).end(); return; }
      const base = s.tmux || s.name;
      const r = await editor.openInEditor({ base, dir: s.cwd, file: path, cmd: config.EDITOR });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(r));
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
      await tmux.killTmuxSession(`${s.tmux || s.name}-edit`); // best-effort: terminal de editor
      // Sesión por rama (worktree): el tmux es `<proyecto>-<rama>` y difiere del proyecto.
      // Limpiamos el worktree para no dejar la carpeta huérfana (que haría fallar un re-spawn
      // de la misma rama). Best-effort: si tiene cambios sin commitear git lo deja en disco.
      const wtPath = sessionWorktree(s);
      if (wtPath) {
        // Docker primero: el compose file vive DENTRO del worktree, así que hay que bajar
        // los stacks antes de borrarlo. Best-effort: no altera la respuesta del endpoint.
        if (config.DOCKER_CLEANUP) await dockerDown(wtPath);
        const projectDir = (projects.list().find((p) => basename(p.dir) === s.project) || {}).dir;
        if (projectDir) {
          const proj = projects.get(projectDir);
          if (proj && proj.related.length) {
            // Rama con la que se crearon los relacionados (session.branch cambia con un checkout).
            const branch = (s.infra && s.infra.branch) || s.branch;
            await teardownRelated({ related: proj.related, branch, wtPath, git });
          }
          const nested = await git.findNestedRepos(projectDir);
          // Contenedor: remover primero los hijos (sin force: si hay cambios sin commitear git
          // rechaza y se deja en disco), luego el padre. Si un hijo queda, el padre tampoco se
          // borra (su carpeta no queda vacía) -> el conjunto sobrevive y un re-spawn lo reutiliza.
          for (const name of nested) {
            await git.worktreeRemove(join(projectDir, name), join(wtPath, name));
          }
          // Si quedó algún relacionado (sucio, o quitado de la config mientras la sesión
          // vivía), el principal tampoco se remueve: .habitat-related/ está en info/exclude,
          // así que git lo vería limpio y borraría recursivamente el trabajo anidado.
          if (!hasLeftoverRelated(wtPath)) await git.worktreeRemove(projectDir, wtPath);
        }
      }
      store.remove(id); // ya persiste a disco
      hub.broadcast({ type: 'remove', id });
      res.writeHead(200).end();
      return;
    }

    // Docker de la sesión: listar (status) y bajar (down) los stacks levantados dentro
    // del worktree. Mismo cerco que /kill (ALLOW_SPAWN) porque baja procesos del usuario.
    if (url.pathname === '/docker/status' || url.pathname === '/docker/down') {
      const isDown = url.pathname === '/docker/down';
      if (req.method !== (isDown ? 'POST' : 'GET')) { res.writeHead(405).end(); return; }
      if (!authorize(req, res)) return;
      if (!config.ALLOW_SPAWN) { res.writeHead(403).end(); return; }
      let id;
      if (isDown) {
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
        id = body && body.id;
        if (typeof id !== 'string' || !id) { res.writeHead(400).end(); return; }
      } else {
        id = url.searchParams.get('id') || '';
      }
      const s = store.get(id);
      if (!s) { res.writeHead(404).end(); return; }
      const wt = sessionWorktree(s);
      // Sesión plana (repo principal): sus containers son el entorno del usuario, no algo
      // que levantó hábitat. No los listamos ni los bajamos.
      const stacks = wt ? await dockerDown(wt, { dryRun: !isDown }) : [];
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ stacks }));
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

    if (req.method === 'POST' && url.pathname === '/login') {
      if (!loginEnabled) { res.writeHead(404).end(); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      const user = body && typeof body.user === 'string' ? body.user : '';
      const password = body && typeof body.password === 'string' ? body.password : '';
      const f = fails.get(user) || { count: 0, lockedUntil: 0 };
      if (f.lockedUntil > Date.now()) { res.writeHead(429).end(); return; }
      const ok = user === config.USER && verifyPassword(password, config.PASSWORD_HASH);
      if (!ok) {
        f.count += 1;
        if (f.count >= LOCK_AFTER) { f.lockedUntil = Date.now() + LOCK_MS; f.count = 0; }
        fails.set(user, f);
        res.writeHead(401).end();
        return;
      }
      fails.delete(user);
      const id = sessionStore.create(user);
      setSessionCookie(res, id);
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'POST' && url.pathname === '/logout') {
      const sid = parseCookies(req.headers.cookie)[COOKIE_NAME];
      if (sid) sessionStore.destroy(sid);
      clearSessionCookie(res);
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/auth/me') {
      const sid = parseCookies(req.headers.cookie)[COOKIE_NAME];
      const sess = sid ? sessionStore.validate(sid) : null;
      if (sess) {
        // Re-emitimos la cookie para que el Max-Age del browser deslice junto con la
        // sesión server-side: mientras entres al panel al menos una vez por TTL, no
        // te vuelve a pedir login.
        setSessionCookie(res, sid);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ user: sess.user }));
        return;
      }
      // Sin cookie de sesión válida: back-compat con token (Bearer / ?token=).
      if (isAuthenticated(req, { sessionStore, token: config.TOKEN })) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ user: config.USER }));
        return;
      }
      res.writeHead(401).end();
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
    sessionStore,
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
  attachTerm(server, store, { token: config.TOKEN, sessionStore });
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
  // Barrido de huérfanos: containers levantados en worktrees que ya no existen (sesiones
  // cerradas antes de esta limpieza, o caídas del server). Doble condición dentro de
  // downOrphans —bajo WORKTREES_DIR y directorio inexistente— para no tocar nada vivo.
  if (config.DOCKER_CLEANUP) {
    downOrphans(config.WORKTREES_DIR)
      .then((stacks) => { if (stacks.length) console.log(`[habitat] docker: stacks huérfanos bajados: ${stacks.join(', ')}`); })
      .catch((err) => console.error('[habitat] barrido docker falló (ignorado):', err && err.message));
  }
}
