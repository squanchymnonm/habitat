import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const defaultExec = async (file, args) => (await run(file, args)).stdout;
// stdio: silenciar stderr (ej. "fatal: not a git repository") — el catch ya maneja el fallo.
const defaultSyncExec = (file, args) => execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

// Socket tmux DEDICADO para hábitat. Todas las invocaciones van con `-L <socket>` para
// aislar las sesiones del panel del tmux por defecto del usuario (y de cualquier `tmux`
// suelto que corra un agente fuera de una sesión). Así `listSessions`/`killTmuxSession`
// nunca tocan sesiones ajenas, y un re-spawn no pisa el tmux personal del usuario.
// Configurable por si se quiere otro socket (o el default, con '').
export const TMUX_SOCKET = process.env.HABITAT_TMUX_SOCKET ?? 'habitat';
// Prefijo de args: `-L <socket>` antepuesto a cada comando (vacío si socket = '').
export const tmuxArgs = (...args) => (TMUX_SOCKET ? ['-L', TMUX_SOCKET, ...args] : [...args]);

export async function capturePane(name, lines, exec = defaultExec) {
  try {
    const out = await exec('tmux', tmuxArgs('capture-pane', '-p', '-t', name));
    const arr = String(out).replace(/\n+$/, '').split('\n');
    return arr.slice(-lines).join('\n');
  } catch {
    return '';
  }
}

export async function listSessions(exec = defaultExec) {
  try {
    const out = await exec('tmux', tmuxArgs('ls', '-F', '#{session_name}'));
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
    await exec('tmux', tmuxArgs('send-keys', '-t', name, '-l', t));
    await exec('tmux', tmuxArgs('send-keys', '-t', name, 'Enter'));
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
// para heredar PATH/rc y disparar los hooks de ~/.claude/settings.json). El
// permissionMode (setting global) define el flag: 'default'/ausente => claude pelado.
export async function newTmuxSession(name, dir, exec = defaultExec, { permissionMode } = {}) {
  try {
    await exec('tmux', tmuxArgs('new-session', '-d', '-s', name, '-c', dir));
    const flag = permissionMode && permissionMode !== 'default' ? ` --permission-mode ${permissionMode}` : '';
    await sendKeys(name, `claude${flag}`, exec);
    return true;
  } catch {
    return false;
  }
}

// Mata la sesión tmux (y con ella claude+shell). Best-effort: si la sesión ya no
// existe, exec tira y devolvemos false, pero el endpoint igual limpia el pod.
export async function killTmuxSession(name, exec = defaultExec) {
  try {
    await exec('tmux', tmuxArgs('kill-session', '-t', name));
    return true;
  } catch {
    return false;
  }
}
