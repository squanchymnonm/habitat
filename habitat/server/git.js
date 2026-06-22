import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  readdir as fsReaddir, stat as fsStat,
  access as fsAccess, readFile as fsReadFile, writeFile as fsWriteFile,
} from 'node:fs/promises';
import { join } from 'node:path';

const run = promisify(execFile);
const defaultExec = async (file, args) => (await run(file, args)).stdout;

export function validBranch(branch) {
  const b = String(branch || '');
  if (!b || b.includes('..') || b.startsWith('-')) return false;
  return /^[A-Za-z0-9._/-]+$/.test(b);
}

export async function branchExists(projectDir, branch, exec = defaultExec) {
  try {
    await exec('git', ['-C', projectDir, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

// Ruta del worktree que ya tiene esta rama checked out, o null si ninguno.
// Cubre el caso de una sesión cerrada que dejó su worktree (git no permite
// volver a hacer `worktree add` sobre una rama ya registrada).
export async function worktreeForBranch(projectDir, branch, exec = defaultExec) {
  let out;
  try {
    out = await exec('git', ['-C', projectDir, 'worktree', 'list', '--porcelain']);
  } catch {
    return null;
  }
  let cur = null;
  for (const raw of String(out).split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('worktree ')) cur = line.slice('worktree '.length);
    else if (line === `branch refs/heads/${branch}`) return cur;
  }
  return null;
}

export async function worktreeAdd(projectDir, branch, base, path, exec = defaultExec) {
  if (!validBranch(branch)) return false;
  // argv flag smuggling: rechazar positionals que empiecen con '-'
  if (String(base).startsWith('-') || String(path).startsWith('-')) return false;
  // ¿ya hay un worktree para esta rama? (típico: cerraste la sesión y quedó la carpeta)
  const existing = await worktreeForBranch(projectDir, branch, exec);
  if (existing != null) {
    // reusar sólo si está en la ruta esperada; si la rama vive en otro lado
    // (p.ej. el checkout principal) no lo secuestramos -> el caller responde 500.
    return existing === path;
  }
  try {
    const args = (await branchExists(projectDir, branch, exec))
      ? ['-C', projectDir, 'worktree', 'add', path, branch]
      : ['-C', projectDir, 'worktree', 'add', '-b', branch, path, base];
    await exec('git', args);
    return true;
  } catch {
    return false;
  }
}

// Quita el worktree al cerrar la sesión. Sin --force a propósito (default): si el worktree
// tiene cambios sin commitear git rechaza el remove y lo dejamos en disco (no destruimos
// trabajo); worktreeAdd lo reutilizará en el próximo spawn de esa rama. El rollback del
// spawn (worktrees recién creados, sin trabajo) sí pasa { force: true }.
// Subcarpetas inmediatas de `dir` que son repos git (tienen una entrada `.git`).
// Vacío si `dir` no existe o no tiene sub-repos. Define si un proyecto es "contenedor".
export async function findNestedRepos(dir, deps = {}) {
  const readdir = deps.readdir || fsReaddir;
  const stat = deps.stat || fsStat;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const repos = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      await stat(join(dir, e.name, '.git'));
      repos.push(e.name);
    } catch {
      // no es repo git
    }
  }
  return repos.sort();
}

// Rama actual de un repo (async). '' ante error. (gitBranch en tmux.js es la versión síncrona.)
export async function currentBranch(repoDir, exec = defaultExec) {
  try {
    return String(await exec('git', ['-C', repoDir, 'rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  } catch {
    return '';
  }
}

// Rama default del remoto como ref de start-point (ej. 'origin/main'). Si origin/HEAD no está
// seteado, intenta resolverlo (remote set-head -a) y reintenta; último fallback: rama actual.
export async function remoteDefaultBranch(repoDir, exec = defaultExec) {
  const read = async () => String(
    await exec('git', ['-C', repoDir, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']),
  ).trim();
  try {
    const d = await read();
    if (d) return d;
  } catch { /* sin origin/HEAD: intentamos resolverlo abajo */ }
  try {
    await exec('git', ['-C', repoDir, 'remote', 'set-head', 'origin', '-a']);
    const d = await read();
    if (d) return d;
  } catch { /* sin remoto utilizable */ }
  return currentBranch(repoDir, exec);
}

export async function worktreeRemove(projectDir, path, { force = false } = {}, exec = defaultExec) {
  if (String(path).startsWith('-')) return false;
  try {
    const args = ['-C', projectDir, 'worktree', 'remove'];
    if (force) args.push('--force');
    args.push(path);
    await exec('git', args);
    return true;
  } catch {
    return false;
  }
}

// Asegura que el contenedor sea un repo git que versiona lo no-git de la raíz (.claude, docs, …).
// Idempotente. El .gitignore excluye cada sub-repo para que el worktree del padre no intente
// materializarlos (ahí van los worktrees de los hijos). Commit con identidad explícita para no
// depender de la config global de git.
export async function ensureContainerRepo(dir, nested, exec = defaultExec, deps = {}) {
  const access = deps.access || fsAccess;
  const readFile = deps.readFile || fsReadFile;
  const writeFile = deps.writeFile || fsWriteFile;
  try {
    await access(join(dir, '.git'));
    return true; // ya es repo
  } catch { /* falta .git: inicializar */ }
  try {
    await exec('git', ['-C', dir, 'init']);
    const giPath = join(dir, '.gitignore');
    let current = '';
    try { current = String(await readFile(giPath, 'utf8')); } catch { /* sin .gitignore previo */ }
    const lines = current.split('\n').map((l) => l.trim()).filter(Boolean);
    const has = new Set(lines);
    for (const name of nested) {
      if (!has.has(`${name}/`) && !has.has(name)) { lines.push(`${name}/`); has.add(`${name}/`); }
    }
    await writeFile(giPath, lines.join('\n') + '\n');
    await exec('git', ['-C', dir, 'add', '-A']);
    await exec('git', [
      '-C', dir,
      '-c', 'user.name=habitat', '-c', 'user.email=habitat@local',
      'commit', '--allow-empty', '-m', 'habitat: init container repo',
    ]);
    return true;
  } catch {
    return false;
  }
}
