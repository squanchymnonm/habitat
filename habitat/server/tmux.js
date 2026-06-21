import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const defaultExec = async (file, args) => (await run(file, args)).stdout;
// stdio: silenciar stderr (ej. "fatal: not a git repository") — el catch ya maneja el fallo.
const defaultSyncExec = (file, args) => execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

export async function capturePane(name, lines, exec = defaultExec) {
  try {
    const out = await exec('tmux', ['capture-pane', '-p', '-t', name]);
    const arr = String(out).replace(/\n+$/, '').split('\n');
    return arr.slice(-lines).join('\n');
  } catch {
    return '';
  }
}

export async function listSessions(exec = defaultExec) {
  try {
    const out = await exec('tmux', ['ls', '-F', '#{session_name}']);
    return String(out).split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// Escribe texto en el pane de la sesión y manda Enter (modo -l = literal, no interpreta keys).
export async function sendKeys(name, text, exec = defaultExec) {
  const t = String(text || '').trim();
  if (!t) return false;
  try {
    await exec('tmux', ['send-keys', '-t', name, '-l', t]);
    await exec('tmux', ['send-keys', '-t', name, 'Enter']);
    return true;
  } catch {
    return false;
  }
}

// Rama git actual del cwd (para el chip ⌥ del pod). '' si no es repo.
// Síncrona: applyEvent es síncrono y la setea inline en SessionStart.
export function gitBranch(cwd, exec = defaultSyncExec) {
  try {
    return String(exec('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  } catch {
    return '';
  }
}

// Crea una sesión tmux detached en `dir` y lanza claude dentro (vía shell de login,
// para heredar PATH/rc y disparar los hooks de ~/.claude/settings.json).
export async function newTmuxSession(name, dir, exec = defaultExec) {
  try {
    await exec('tmux', ['new-session', '-d', '-s', name, '-c', dir]);
    await sendKeys(name, 'claude', exec);
    return true;
  } catch {
    return false;
  }
}
