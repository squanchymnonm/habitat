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

export { defaultExec, remoteDefaultBranch, currentBranch };
