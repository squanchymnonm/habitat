import { defaultExec } from './git.js';

// Comandos de infra por default (proyecto con infra.up/down vacíos).
export const DEFAULT_UP = 'docker compose up -d';
export const DEFAULT_DOWN = 'docker compose down';

// Un `up` con build puede tardar varios minutos; corre con el lock de la sesión tomado.
export const UP_TIMEOUT_MS = 15 * 60_000;

// Error legible de un comando de infra. Al revés que el trimErr de git: compose imprime
// primero el progreso (Creating/Pulling…) y el error real al FINAL, así que nos quedamos
// con las últimas líneas. El timeout es el nuestro de 15 min, no un remoto colgado.
export function infraErr(e) {
  if (e && e.killed) return `el comando de infra tardó más de ${UP_TIMEOUT_MS / 60_000} min y se cortó`;
  const s = String((e && (e.stderr || e.message)) || '').trimEnd();
  return s.split('\n').slice(-6).join('\n').slice(-800);
}

// Comando de shell libre del proyecto (lo define el usuario autenticado en Settings, mismo
// modelo de confianza que el spawn). maxBuffer amplio: la salida de un build es larga.
export async function runInfraCommand(cmd, cwd, exec = defaultExec) {
  try {
    await exec('sh', ['-c', cmd], { cwd, timeout: UP_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: infraErr(e) };
  }
}
