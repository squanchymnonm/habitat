import { readFileSync, writeFileSync, renameSync } from 'node:fs';

export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];
const DEFAULT_MODE = 'acceptEdits';

// Setting global del hábitat, respaldada en disco con escritura atómica (igual que
// state.js). Hoy sólo guarda el permissionMode con el que se lanzan las sesiones nuevas.
export function createSettings({ persistPath } = {}) {
  let permissionMode = DEFAULT_MODE;

  if (persistPath) {
    try {
      const parsed = JSON.parse(readFileSync(persistPath, 'utf8'));
      if (PERMISSION_MODES.includes(parsed.permissionMode)) permissionMode = parsed.permissionMode;
    } catch { /* sin archivo aún, o corrupto: arrancamos en default */ }
  }

  function persist() {
    if (!persistPath) return;
    const tmp = `${persistPath}.tmp`;
    writeFileSync(tmp, JSON.stringify({ permissionMode }));
    renameSync(tmp, persistPath); // atómico: nunca dejamos un JSON a medias
  }

  return {
    get: () => ({ permissionMode }),
    // true si el patch trae un modo válido (aplica + persiste); false si es inválido.
    set: (patch = {}) => {
      if (!patch || !PERMISSION_MODES.includes(patch.permissionMode)) return false;
      permissionMode = patch.permissionMode;
      persist();
      return true;
    },
  };
}
