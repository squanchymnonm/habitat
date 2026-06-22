import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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

// Quita el worktree al cerrar la sesión. Sin --force a propósito: si el worktree
// tiene cambios sin commitear git rechaza el remove y lo dejamos en disco (no
// destruimos trabajo); worktreeAdd lo reutilizará en el próximo spawn de esa rama.
export async function worktreeRemove(projectDir, path, exec = defaultExec) {
  if (String(path).startsWith('-')) return false;
  try {
    await exec('git', ['-C', projectDir, 'worktree', 'remove', path]);
    return true;
  } catch {
    return false;
  }
}
