import { mkdirSync, chmodSync, writeFileSync, renameSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Plantillas .env por proyecto. Tienen secretos: viven fuera de .projects.json (que se
// broadcastea) con 0700/0600, y sólo salen por endpoints autenticados. Sin `dir`,
// en memoria (tests), como createProjects sin persistPath.
// Repo y path van codificados y unidos por '@', que encodeURIComponent siempre escapa
// (%40): no puede aparecer en ninguna de las dos partes, así que el nombre es inyectivo.
const fileName = (repo, path) => `${encodeURIComponent(repo)}@${encodeURIComponent(path)}.env`;

export function createEnvStore({ dir } = {}) {
  if (!dir) {
    const mem = new Map();
    const key = (p, r, f) => `${p}\0${r}\0${f}`;
    return {
      get: (p, r, f) => mem.get(key(p, r, f)) ?? '',
      set: (p, r, f, content) => { mem.set(key(p, r, f), String(content)); },
      remove: (p, r, f) => { mem.delete(key(p, r, f)); },
      removeProject: (p) => { for (const k of [...mem.keys()]) if (k.startsWith(`${p}\0`)) mem.delete(k); },
    };
  }
  const projDir = (project) => join(dir, encodeURIComponent(project));
  return {
    get(project, repo, path) {
      try { return readFileSync(join(projDir(project), fileName(repo, path)), 'utf8'); } catch { return ''; }
    },
    set(project, repo, path, content) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700); // mkdir no toca el modo de una carpeta que ya existía
      mkdirSync(projDir(project), { recursive: true, mode: 0o700 });
      chmodSync(projDir(project), 0o700);
      const f = join(projDir(project), fileName(repo, path));
      const tmp = `${f}.tmp`;
      writeFileSync(tmp, String(content), { mode: 0o600 });
      renameSync(tmp, f); // atómico
    },
    remove(project, repo, path) {
      rmSync(join(projDir(project), fileName(repo, path)), { force: true });
    },
    removeProject(project) {
      rmSync(projDir(project), { recursive: true, force: true });
    },
  };
}
