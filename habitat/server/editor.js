import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmuxArgs, sendKeys, listSessions } from './tmux.js';

const run = promisify(execFile);
const defaultExec = async (file, args) => (await run(file, args)).stdout;

export function editorSessionName(base) {
  return `${base}-edit`;
}

// Escapa para la cmdline de nvim (:e): espacios y caracteres especiales con backslash.
function nvimEscape(p) {
  return String(p).replace(/([ %#\\|!"'<>])/g, '\\$1');
}

// Abre `file` (relativo a `dir`) en la sesión de editor de `base`. Si la sesión
// `${base}-edit` no existe, la crea con tmux ejecutando nvim directamente (sin
// shell, así el path no sufre word-splitting). Si existe, fuerza normal mode
// (Escape) y abre el archivo con :e. `file` no puede empezar con '-'.
export async function openInEditor({ base, dir, file, exec = defaultExec }) {
  if (typeof file !== 'string' || !file || file.startsWith('-') || /[\x00-\x1f]/.test(file)) {
    return { ok: false, message: 'path inválido' };
  }
  const name = editorSessionName(base);
  let sessions = [];
  try { sessions = await listSessions(exec); } catch { /* asumimos que no existe */ }
  try {
    if (sessions.includes(name)) {
      await exec('tmux', tmuxArgs('send-keys', '-t', name, 'Escape'));
      await sendKeys(name, `:e ${nvimEscape(file)}`, exec);
    } else {
      await exec('tmux', tmuxArgs('new-session', '-d', '-s', name, '-c', dir, 'nvim', '--', file));
    }
    return { ok: true, tmux: name };
  } catch (e) {
    return { ok: false, message: String((e && (e.stderr || e.message)) || '').slice(0, 300) };
  }
}

export { defaultExec };
