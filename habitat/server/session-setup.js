import { mkdir, writeFile, readFile, appendFile, chmod, realpath, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { scan, render, stackName } from './env-template.js';
import { DEFAULT_UP, DEFAULT_DOWN } from './infra.js';
import { NET_OPTS } from './git.js';

// Extras de una sesión con config de proyecto: worktrees de relacionados, .env
// renderizados, CLAUDE.local.md. El worktree principal lo crea/remueve el caller.
export const RELATED_DIR = '.habitat-related';

// Agrega patrones a info/exclude del directorio común del repo (compartido por todos
// sus worktrees, local, no se commitea). Idempotente.
export async function ensureExcluded(repoDir, patterns, exec) {
  const common = String(await exec('git', ['-C', repoDir, 'rev-parse', '--git-common-dir'])).trim();
  const file = join(resolve(repoDir, common), 'info', 'exclude');
  let cur = '';
  try { cur = await readFile(file, 'utf8'); } catch { /* sin exclude aún */ }
  const have = new Set(cur.split('\n').map((l) => l.trim()));
  const missing = patterns.filter((p) => !have.has(p));
  if (!missing.length) return;
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, (cur && !cur.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n');
}

export function claudeLocal({ branch, stack, ports, infra, infraDirRel, related }) {
  const L = ['# Sesión de Habitat', '', 'Archivo generado por Habitat para esta sesión (no se commitea).', ''];
  if (infra) {
    L.push('## Infra docker', '',
      `- Carpeta: \`${infraDirRel}\``,
      `- Levantar: \`${infra.up || DEFAULT_UP}\``,
      `- Bajar: \`${infra.down || DEFAULT_DOWN}\``,
      `- Stack: \`${stack}\``,
      '- Arranca apagada: levantala sólo si la tarea lo necesita. Al cerrar la sesión Habitat la baja sola.',
      '');
  }
  const names = Object.keys(ports);
  if (names.length) {
    L.push('## Puertos de esta sesión', '');
    for (const n of names) L.push(`- ${n} → localhost:${ports[n]}`);
    L.push('');
  }
  if (related.length) {
    L.push('## Repos relacionados', '',
      `Cada uno es un worktree en su propia rama \`${branch}\`: commiteá y pusheá desde ese repo.`, '');
    for (const r of related) L.push(`- ${r.name}: \`${RELATED_DIR}/${r.name}\``);
    L.push('');
  }
  return L.join('\n');
}

export async function prepareSession({ project, projectName, branch, wtPath, envStore, allocate, git }) {
  const created = []; // sólo los worktrees que creó esta llamada (los reutilizados no)
  const fail = async (error) => {
    for (const c of [...created].reverse()) await git.worktreeRemove(c.repoDir, c.path, { force: true });
    return { ok: false, error };
  };
  try {
    const paths = { self: wtPath };
    if (project.related.length || project.infra) {
      await ensureExcluded(project.dir, [`/${RELATED_DIR}/`, '/CLAUDE.local.md'], git.exec);
    }
    for (const r of project.related) {
      if (!existsSync(r.dir)) return fail(`el repo relacionado ${r.name} no existe`);
      const path = join(wtPath, RELATED_DIR, r.name);
      try { await git.exec('git', ['-C', r.dir, 'fetch', 'origin'], NET_OPTS); } catch { /* best-effort */ }
      const base = await git.remoteDefaultBranch(r.dir);
      // Si ya estaba (worktreeAdd lo reutiliza) puede tener trabajo: el rollback no lo toca.
      const existed = existsSync(path);
      if (!(await git.worktreeAdd(r.dir, branch, base, path))) return fail(`falló el worktree de ${r.name}`);
      if (!existed) created.push({ repoDir: r.dir, path });
      paths[r.name] = path;
    }
    const repos = Object.keys(paths);
    const templates = project.envFiles.map((e) => ({ ...e, content: envStore.get(projectName, e.repo, e.path) }));
    const portNames = new Set();
    for (const t of templates) {
      const s = scan(t.content, repos);
      if (s.unknown.length) return fail(`plantilla ${t.repo}/${t.path}: variables desconocidas: ${s.unknown.join(', ')}`);
      for (const p of s.ports) portNames.add(p);
    }
    const alloc = await allocate([...portNames].sort());
    if (!alloc.ok) return fail(alloc.error);
    const stack = stackName(projectName, branch);
    const ctx = { stack, branch, paths, ports: alloc.ports };
    for (const t of templates) {
      const root = paths[t.repo];
      const target = resolve(root, t.path);
      if (!target.startsWith(root + sep)) return fail(`plantilla ${t.repo}/${t.path}: ruta inválida`);
      // resolve() es puramente léxico: no sigue symlinks. Si una carpeta intermedia (o el
      // propio archivo) es un symlink hacia afuera del worktree, el chequeo de arriba
      // igual pasa y writeFile terminaría escribiendo el secreto en otro lado. Resolvemos
      // el ancestro existente más profundo con realpath y lo comparamos contra la raíz
      // real del worktree; además rechazamos si el target YA existe como symlink.
      let anc = target;
      while (!existsSync(anc)) anc = dirname(anc);
      let realAnc, realRoot;
      try {
        realAnc = await realpath(anc);
        realRoot = await realpath(root);
      } catch {
        return fail(`plantilla ${t.repo}/${t.path}: ruta inválida`);
      }
      if (realAnc !== realRoot && !realAnc.startsWith(realRoot + sep)) {
        return fail(`plantilla ${t.repo}/${t.path}: ruta inválida`);
      }
      // lstat SIEMPRE (no sólo si existsSync): existsSync sigue symlinks, así que un
      // symlink colgante (su destino no existe todavía) pasaría desapercibido acá y
      // writeFile lo crearía al escribir, materializando el secreto en el destino ajeno.
      try {
        if ((await lstat(target)).isSymbolicLink()) return fail(`plantilla ${t.repo}/${t.path}: ruta inválida`);
      } catch { /* ENOENT: no hay nada ahí todavía, ok */ }
      const out = render(t.content, ctx);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, out.text, { mode: 0o600 });
      await chmod(target, 0o600); // writeFile no cambia el modo de un archivo existente
      const repoDir = t.repo === 'self' ? project.dir : project.related.find((r) => r.name === t.repo).dir;
      await ensureExcluded(repoDir, [`/${t.path}`], git.exec);
    }
    const infraDir = project.infra ? resolve(paths[project.infra.repo], project.infra.path || '.') : null;
    if (project.infra || project.related.length) {
      await writeFile(join(wtPath, 'CLAUDE.local.md'), claudeLocal({
        branch, stack, ports: alloc.ports, infra: project.infra,
        infraDirRel: infraDir ? (relative(wtPath, infraDir) || '.') : null,
        related: project.related,
      }));
    }
    return { ok: true, infra: { stack, ports: alloc.ports, dir: infraDir, branch } };
  } catch (e) {
    return fail(`no se pudo preparar la sesión: ${(e && e.message) || e}`);
  }
}

// Cierre: remueve cada worktree relacionado sin forzar (si tiene cambios, git se niega y
// queda en disco) y, si salió, borra su rama con -d (sólo si no tiene commits sin mergear).
export async function teardownRelated({ related, branch, wtPath, git }) {
  for (const r of related) {
    const path = join(wtPath, RELATED_DIR, r.name);
    if (await git.worktreeRemove(r.dir, path)) {
      try { await git.exec('git', ['-C', r.dir, 'branch', '-d', branch]); } catch { /* tiene commits o no existe */ }
    }
  }
}
