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

export { defaultExec, validBranch, remoteDefaultBranch, trimErr, gitOk };
