import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import { PALETTE, pickColor } from './palette.js';
import { CHARACTERS } from './characters.js';

// Store persistido de la lista de proyectos spawneables (fuente de verdad).
// Mismo patrón que settings.js: carga al iniciar + escritura atómica. HABITAT_PROJECTS
// solo siembra cuando el archivo aún no existe; después manda siempre el disco.
const validColor = (c) => PALETTE.includes(c);
const validChars = (cs) => Array.isArray(cs) && cs.every((c) => CHARACTERS.includes(c));

const REL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
// Relativo, sin '..' ni absoluto. allowEmpty: '' = raíz del repo (subcarpeta de infra).
const safeRel = (p, allowEmpty) => typeof p === 'string' && (allowEmpty || p !== '')
  && !isAbsolute(p) && !p.split(/[\\/]/).includes('..');
const fail = (error) => ({ ok: false, error });

// Valida y normaliza la config de infra/relacionados de un proyecto. Sólo forma: la
// existencia en disco de los relacionados la chequea index.js (async, con realpath).
export function validateConfig({ related = [], infra = null, envFiles = [] } = {}, selfDir) {
  if (!Array.isArray(related) || !Array.isArray(envFiles)) return fail('config inválida');
  const names = new Set();
  const rel = [];
  for (const r of related) {
    if (!r || typeof r.dir !== 'string' || !isAbsolute(r.dir)) return fail('relacionado: ruta inválida');
    if (r.dir === selfDir) return fail('relacionado: no puede ser el propio proyecto');
    if (typeof r.name !== 'string' || !REL_NAME_RE.test(r.name) || r.name === 'self') return fail(`relacionado: nombre inválido "${r && r.name}"`);
    if (names.has(r.name)) return fail(`relacionado: nombre duplicado "${r.name}"`);
    names.add(r.name);
    rel.push({ dir: r.dir, name: r.name });
  }
  const known = (x) => x === 'self' || names.has(x);
  const dangling = [];
  if (infra != null && !known(infra.repo)) dangling.push(String(infra.repo));
  for (const e of envFiles) if (e && !known(e.repo) && !dangling.includes(String(e.repo))) dangling.push(String(e.repo));
  if (dangling.length) return fail(`referencias a relacionados inexistentes: ${dangling.join(', ')}`);
  let inf = null;
  if (infra != null) {
    if (typeof infra !== 'object') return fail('infra inválida');
    const path = infra.path ?? '';
    const up = infra.up ?? '';
    const down = infra.down ?? '';
    if (!safeRel(path, true)) return fail('infra: subcarpeta inválida');
    if (typeof up !== 'string' || typeof down !== 'string') return fail('infra: comandos inválidos');
    inf = { repo: infra.repo, path, up, down };
  }
  const seen = new Set();
  const env = [];
  for (const e of envFiles) {
    if (!e || !safeRel(e.path, false)) return fail(`archivo .env: ruta inválida "${e && e.path}"`);
    const key = `${e.repo}\0${e.path}`;
    if (seen.has(key)) return fail(`archivo .env duplicado: ${e.repo}/${e.path}`);
    seen.add(key);
    env.push({ repo: e.repo, path: e.path });
  }
  return { ok: true, value: { related: rel, infra: inf, envFiles: env } };
}

// ¿El proyecto tiene algo que preparar en el spawn más allá del worktree?
export function hasConfig(p) {
  return !!(p && (p.related.length || p.infra || p.envFiles.length));
}

function seedRecord(dir) {
  return { dir, label: basename(dir), color: pickColor(dir), chars: [], related: [], infra: null, envFiles: [] };
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
          .map((p) => {
            const cfg = validateConfig({ related: p.related, infra: p.infra, envFiles: p.envFiles }, p.dir);
            return {
              dir: p.dir,
              label: typeof p.label === 'string' && p.label ? p.label : basename(p.dir),
              color: validColor(p.color) ? p.color : pickColor(p.dir),
              chars: validChars(p.chars) ? [...p.chars] : [],
              ...(cfg.ok ? cfg.value : { related: [], infra: null, envFiles: [] }),
            };
          });
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

  const copy = (r) => ({
    dir: r.dir, label: r.label, color: r.color, chars: [...r.chars],
    related: r.related.map((x) => ({ ...x })),
    infra: r.infra ? { ...r.infra } : null,
    envFiles: r.envFiles.map((x) => ({ ...x })),
  });
  const find = (dir) => items.find((r) => r.dir === dir);

  return {
    list: () => items.map(copy),
    has: (dir) => !!find(dir),
    get: (dir) => { const r = find(dir); return r ? copy(r) : null; },
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
        related: [],
        infra: null,
        envFiles: [],
      };
      items.push(record);
      persist();
      return { ok: true, record: copy(record) };
    },
    update: ({ dir, label, color, chars, related, infra, envFiles } = {}) => {
      const r = find(dir);
      if (!r) return { ok: false, error: 'no existe' };
      if (color != null && !validColor(color)) return { ok: false, error: 'color inválido' };
      if (chars != null && !validChars(chars)) return { ok: false, error: 'chars inválidos' };
      let cfg = null;
      if (related !== undefined || infra !== undefined || envFiles !== undefined) {
        cfg = validateConfig({
          related: related !== undefined ? related : r.related,
          infra: infra !== undefined ? infra : r.infra,
          envFiles: envFiles !== undefined ? envFiles : r.envFiles,
        }, r.dir);
        if (!cfg.ok) return cfg;
      }
      if (typeof label === 'string' && label) r.label = label;
      if (color != null) r.color = color;
      if (chars != null) r.chars = [...chars];
      if (cfg) Object.assign(r, cfg.value);
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
