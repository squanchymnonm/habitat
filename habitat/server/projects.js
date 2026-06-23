import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { PALETTE, pickColor } from './palette.js';
import { CHARACTERS } from './characters.js';

// Store persistido de la lista de proyectos spawneables (fuente de verdad).
// Mismo patrón que settings.js: carga al iniciar + escritura atómica. HABITAT_PROJECTS
// solo siembra cuando el archivo aún no existe; después manda siempre el disco.
const validColor = (c) => PALETTE.includes(c);
const validChars = (cs) => Array.isArray(cs) && cs.every((c) => CHARACTERS.includes(c));

function seedRecord(dir) {
  return { dir, label: basename(dir), color: pickColor(dir), chars: [] };
}

export function createProjects({ persistPath, seed = [] } = {}) {
  let items = [];

  const loaded = persistPath && existsSync(persistPath);
  if (loaded) {
    try {
      const parsed = JSON.parse(readFileSync(persistPath, 'utf8'));
      if (Array.isArray(parsed)) {
        items = parsed
          .filter((p) => p && typeof p.dir === 'string')
          .map((p) => ({
            dir: p.dir,
            label: typeof p.label === 'string' && p.label ? p.label : basename(p.dir),
            color: validColor(p.color) ? p.color : pickColor(p.dir),
            chars: validChars(p.chars) ? [...p.chars] : [],
          }));
      } else {
        items = seed.map(seedRecord); // archivo presente pero no es array: re-sembramos
      }
    } catch {
      items = seed.map(seedRecord); // corrupto: arrancamos del seed
    }
  } else {
    items = seed.map(seedRecord);
  }

  function persist() {
    if (!persistPath) return;
    const tmp = `${persistPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(items));
    renameSync(tmp, persistPath); // atómico
  }
  // Si veníamos de seed/corrupto y hay persistPath, dejamos el archivo escrito.
  if (persistPath && !loaded) persist();

  const copy = (r) => ({ dir: r.dir, label: r.label, color: r.color, chars: [...r.chars] });
  const find = (dir) => items.find((r) => r.dir === dir);

  return {
    list: () => items.map(copy),
    has: (dir) => !!find(dir),
    add: ({ dir, label, color, chars } = {}) => {
      if (typeof dir !== 'string' || !dir) return { ok: false, error: 'dir inválido' };
      if (find(dir)) return { ok: false, error: 'duplicado' };
      if (!validColor(color)) return { ok: false, error: 'color inválido' };
      if (chars != null && !validChars(chars)) return { ok: false, error: 'chars inválidos' };
      const record = {
        dir,
        label: typeof label === 'string' && label ? label : basename(dir),
        color,
        chars: chars ? [...chars] : [],
      };
      items.push(record);
      persist();
      return { ok: true, record: copy(record) };
    },
    update: ({ dir, label, color, chars } = {}) => {
      const r = find(dir);
      if (!r) return { ok: false, error: 'no existe' };
      if (color != null && !validColor(color)) return { ok: false, error: 'color inválido' };
      if (chars != null && !validChars(chars)) return { ok: false, error: 'chars inválidos' };
      if (typeof label === 'string' && label) r.label = label;
      if (color != null) r.color = color;
      if (chars != null) r.chars = [...chars];
      persist();
      return { ok: true, record: copy(r) };
    },
    remove: (dir) => {
      const i = items.findIndex((r) => r.dir === dir);
      if (i === -1) return false;
      items.splice(i, 1);
      persist();
      return true;
    },
  };
}
