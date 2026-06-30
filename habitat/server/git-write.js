import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validBranch, remoteDefaultBranch } from './git.js';

const run = promisify(execFile);
const defaultExec = async (file, args) => (await run(file, args)).stdout;

function safePaths(rels) {
  if (!Array.isArray(rels) || rels.length === 0) return null;
  for (const r of rels) { if (typeof r !== 'string' || !r || r.startsWith('-')) return null; }
  return rels;
}

function trimErr(e) {
  const s = (e && (e.stderr || e.message)) || '';
  return String(s).split('\n').slice(0, 6).join('\n').slice(0, 800);
}

async function gitOk(cwd, args, exec) {
  try { await exec('git', ['-C', cwd, ...args]); return { ok: true }; }
  catch (e) { return { ok: false, code: e && e.code, message: trimErr(e) }; }
}

export async function stage(cwd, rels, exec = defaultExec) {
  const p = safePaths(rels); if (!p) return { ok: false, message: 'paths inválidos' };
  return gitOk(cwd, ['add', '--', ...p], exec);
}

export async function unstage(cwd, rels, exec = defaultExec) {
  const p = safePaths(rels); if (!p) return { ok: false, message: 'paths inválidos' };
  return gitOk(cwd, ['restore', '--staged', '--', ...p], exec);
}

export async function discard(cwd, rels, exec = defaultExec) {
  const p = safePaths(rels); if (!p) return { ok: false, message: 'paths inválidos' };
  return gitOk(cwd, ['restore', '--', ...p], exec);
}

export async function commit(cwd, message, exec = defaultExec) {
  if (typeof message !== 'string' || !message.trim()) return { ok: false, message: 'mensaje vacío' };
  return gitOk(cwd, ['commit', '-m', message], exec);
}

export async function push(cwd, branch, exec = defaultExec) {
  const first = await gitOk(cwd, ['push'], exec);
  if (first.ok || !validBranch(branch)) return first;
  return gitOk(cwd, ['push', '-u', 'origin', branch], exec);
}

async function conflictResult(cwd, exec) {
  let files = [];
  try {
    const z = await exec('git', ['-C', cwd, 'diff', '--name-only', '--diff-filter=U', '-z']);
    files = String(z).split('\0').filter(Boolean);
  } catch { /* dejar [] */ }
  return { ok: false, conflict: true, files };
}

function isConflict(e) {
  const out = (e && ((e.stdout || '') + (e.stderr || ''))) || '';
  return /CONFLICT|Automatic merge failed|Merge conflict/i.test(out);
}

export async function pull(cwd, exec = defaultExec) {
  try { await exec('git', ['-C', cwd, 'pull', '--no-edit']); return { ok: true }; }
  catch (e) { return isConflict(e) ? conflictResult(cwd, exec) : { ok: false, code: e && e.code, message: trimErr(e) }; }
}

export async function mergeDefault(cwd, exec = defaultExec) {
  const def = await remoteDefaultBranch(cwd, exec); // 'origin/main'
  const slash = String(def).indexOf('/');
  const remote = slash > 0 ? def.slice(0, slash) : 'origin';
  const name = slash > 0 ? def.slice(slash + 1) : def;
  if (!validBranch(name) || remote.startsWith('-')) return { ok: false, message: 'rama default inválida' };
  try { await exec('git', ['-C', cwd, 'fetch', remote, name]); }
  catch (e) { return { ok: false, code: e && e.code, message: trimErr(e) }; }
  try { await exec('git', ['-C', cwd, 'merge', '--no-edit', def]); return { ok: true }; }
  catch (e) { return isConflict(e) ? conflictResult(cwd, exec) : { ok: false, code: e && e.code, message: trimErr(e) }; }
}

export async function abort(cwd, exec = defaultExec) {
  return gitOk(cwd, ['merge', '--abort'], exec);
}

export { defaultExec, validBranch, remoteDefaultBranch, trimErr, gitOk };
