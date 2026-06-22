import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const defaultExec = async (file, args) => (await run(file, args)).stdout;

export function validBranch(branch) {
  const b = String(branch || '');
  if (!b || b.includes('..')) return false;
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

export async function worktreeAdd(projectDir, branch, base, path, exec = defaultExec) {
  if (!validBranch(branch)) return false;
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
