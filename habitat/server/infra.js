import { defaultExec } from './git.js';
import { trimErr } from './git-write.js';

// Comandos de infra por default (proyecto con infra.up/down vacíos).
export const DEFAULT_UP = 'docker compose up -d';
export const DEFAULT_DOWN = 'docker compose down';

// Un `up` con build puede tardar varios minutos; corre con el lock de la sesión tomado.
export const UP_TIMEOUT_MS = 15 * 60_000;

// Comando de shell libre del proyecto (lo define el usuario autenticado en Settings, mismo
// modelo de confianza que el spawn). maxBuffer amplio: la salida de un build es larga.
export async function runInfraCommand(cmd, cwd, exec = defaultExec) {
  try {
    await exec('sh', ['-c', cmd], { cwd, timeout: UP_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: trimErr(e) };
  }
}
