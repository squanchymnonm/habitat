import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { remoteDefaultBranch, currentBranch } from './git.js';

const run = promisify(execFile);
const defaultExec = async (file, args) => (await run(file, args)).stdout;

// Parsea `git status --porcelain=v1 -z`. Entradas separadas por NUL; cada una es
// "XY path"; en rename/copy la ruta de origen viene en el token siguiente.
export function parsePorcelain(z) {
  const out = { staged: [], unstaged: [], untracked: [], conflicted: [] };
  const toks = String(z).split('\0');
  for (let i = 0; i < toks.length; i++) {
    const entry = toks[i];
    if (!entry) continue;
    const xy = entry.slice(0, 2);
    const rel = entry.slice(3);
    const x = xy[0], y = xy[1];
    if (xy === '??') { out.untracked.push({ rel, status: '?' }); continue; }
    let old;
    if (x === 'R' || x === 'C') { old = toks[++i]; }
    const unmerged = x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D');
    if (unmerged) { out.conflicted.push({ rel, status: xy }); continue; }
    if (x !== ' ') out.staged.push({ rel, status: x, old });
    if (y !== ' ') out.unstaged.push({ rel, status: y });
  }
  return out;
}

export async function workingStatus(cwd, exec = defaultExec) {
  const z = await exec('git', ['-C', cwd, 'status', '--porcelain=v1', '-z']);
  return parsePorcelain(z);
}

export function parseNameStatus(out) {
  const files = [];
  for (const line of String(out).split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const code = parts[0][0];
    if (code === 'R' || code === 'C') files.push({ status: code, old: parts[1], rel: parts[2] });
    else files.push({ status: code, rel: parts[1] });
  }
  return files;
}

export async function branchOverview(cwd, exec = defaultExec) {
  const branch = await currentBranch(cwd, exec);
  const def = await remoteDefaultBranch(cwd, exec); // ej. 'origin/main'
  let ahead = 0, behind = 0, files = [];
  try {
    const counts = String(
      await exec('git', ['-C', cwd, 'rev-list', '--left-right', '--count', `${def}...HEAD`]),
    ).trim();
    const [b, a] = counts.split(/\s+/);
    behind = Number(b) || 0; ahead = Number(a) || 0;
    files = parseNameStatus(
      await exec('git', ['-C', cwd, 'diff', '--name-status', `${def}...HEAD`]),
    );
  } catch { /* sin remoto comparable: 0 y [] */ }
  return { branch, default: def, ahead, behind, files };
}

export async function commits(cwd, exec = defaultExec) {
  const branch = await currentBranch(cwd, exec);
  const def = await remoteDefaultBranch(cwd, exec);
  let log = '';
  try { log = await exec('git', ['-C', cwd, 'log', '--format=%H%x1f%h%x1f%s', `${def}..HEAD`]); }
  catch { return []; }
  const rows = String(log).split('\n').filter(Boolean).map((l) => {
    const [sha, shortSha, subject] = l.split('\x1f');
    return { sha, shortSha, subject };
  });
  let unpushed;
  try {
    const out = await exec('git', ['-C', cwd, 'rev-list', `${def}..HEAD`, '--not', `origin/${branch}`]);
    unpushed = new Set(String(out).split('\n').filter(Boolean));
  } catch {
    unpushed = new Set(rows.map((r) => r.sha)); // sin origin/<branch>: todo unpushed
  }
  const result = [];
  for (const r of rows) {
    let files = [];
    try { files = parseNameStatus(await exec('git', ['-C', cwd, 'show', '--name-status', '--format=', r.sha])); }
    catch { /* dejar [] */ }
    result.push({ ...r, pushed: !unpushed.has(r.sha), files });
  }
  return result;
}

export { defaultExec, remoteDefaultBranch, currentBranch };
