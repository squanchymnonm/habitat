import { join, dirname, basename, sep } from 'node:path';

export function sanitizeBranch(branch) {
  return String(branch || '').replace(/\//g, '-');
}

export function worktreeName(worktreesDir, cwd) {
  const c = String(cwd || '');
  const prefix = worktreesDir.endsWith(sep) ? worktreesDir : worktreesDir + sep;
  if (!c.startsWith(prefix)) return null;
  const leaf = basename(c);
  const project = basename(dirname(c));
  // el padre del leaf debe ser exactamente <base>/<project>
  if (!project || dirname(c) === worktreesDir || join(worktreesDir, project) !== dirname(c)) return null;
  return { project, tmux: `${project}-${leaf}` };
}

export function worktreePaths(worktreesDir, projectName, branch) {
  const leaf = sanitizeBranch(branch);
  return { path: join(worktreesDir, projectName, leaf), tmux: `${projectName}-${leaf}` };
}
