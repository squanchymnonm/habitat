import { resolve, sep } from 'node:path';

// Nombre seguro: solo el basename, sin separadores ni '..'. Vacío -> 'archivo'.
export function sanitizeFilename(name) {
  const norm = String(name || '').replace(/\\/g, '/');
  let base = norm.slice(norm.lastIndexOf('/') + 1).trim();
  if (!base || base === '.' || base === '..') return 'archivo';
  return base;
}

// Resuelve `rel` dentro de `root`; null si el resultado escapa de `root`
// (guard sintáctico de path-traversal). El guard anti-symlink va aparte (realpath).
export function resolveWithinRoot(root, rel) {
  const clean = String(rel || '').replace(/^\/+/, '');
  const target = resolve(root, clean);
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

// Sufija " (1)", " (2)"… antes de la extensión si `name` ya existe en `taken`.
export function uniqueName(name, taken) {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 1;
  let candidate;
  do { candidate = `${stem} (${i})${ext}`; i++; } while (taken.has(candidate));
  return candidate;
}

// Máximo de bytes permitido: el cap normal, o Infinity si hay password
// configurada y la provista matchea. Sin password configurada, siempre el cap.
export function maxUploadBytes({ cap, configuredPassword, providedPassword }) {
  if (configuredPassword && providedPassword === configuredPassword) return Infinity;
  return cap;
}
