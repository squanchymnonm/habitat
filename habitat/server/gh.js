import { currentBranch, remoteDefaultBranch, validBranch, defaultExec, REMOTE_PREFIX, NET_TIMEOUT_MS } from './git.js';
import { trimErr } from './git-write.js';

// Extrae la URL del *PR*, no la primera URL del texto: gh mete de todo antes
// (banner de "hay una versión nueva de gh", link al manual, etc.) y una URL
// cualquiera ahí adelante ganaría con un regex sin anclar. Anclado a /pull/<n>
// además evita arrastrar puntuación pegada al final ("...).", el paréntesis
// y el punto quedaban dentro del link).
const prUrl = (s) => (String(s).match(/https:\/\/\S*?\/pull\/\d+/) || [null])[0];

// REMOTE_PREFIX sale de git.js (único punto de verdad del contrato dual de
// remoteDefaultBranch): cuando resuelve bien devuelve 'origin/main', y si no hay
// origin/HEAD resoluble cae a currentBranch(cwd) tal cual, sin prefijo. Pelar por
// la primera '/' a ciegas ahí mutila un nombre de rama con barras (p.ej.
// 'feature/x' -> 'x'), que además puede coincidir con una rama real y abrir el
// PR contra una base equivocada.

// Errores de gh que valen para cualquier subcomando: no instalado / no autenticado.
function ghCommonError(e) {
  if (e && e.code === 'ENOENT') return { ok: false, message: 'gh no está instalado' };
  const err = (e && ((e.stderr || '') + (e.stdout || ''))) || '';
  if (/gh auth login|not logged into/i.test(err)) {
    return { ok: false, message: 'gh no autenticado: corré `gh auth login` en la terminal' };
  }
  return null;
}

// Crea el PR con gh. No pushea por su cuenta: si falta pushear, el cliente
// deshabilita el botón. Tampoco intenta autenticar desde la web.
export async function prCreate(cwd, exec = defaultExec) {
  const head = await currentBranch(cwd, exec);
  if (!validBranch(head) || head === 'HEAD') return { ok: false, message: 'rama actual inválida (HEAD detached?)' };
  const def = String(await remoteDefaultBranch(cwd, exec)); // 'origin/main', o la rama actual si no hay origin/HEAD
  const base = def.startsWith(REMOTE_PREFIX) ? def.slice(REMOTE_PREFIX.length) : def;
  // Sin origin/HEAD resoluble, remoteDefaultBranch cae a currentBranch(cwd): la
  // misma rama que head. No inventamos una base con eso: mejor avisar que abrir
  // un PR contra sí misma (gh fallaría igual, con un mensaje mucho más críptico).
  if (!validBranch(base) || base === head) {
    return { ok: false, message: 'no se pudo determinar la rama base del PR (¿falta configurar el remoto o origin/HEAD?)' };
  }
  try {
    // `gh pr create` habla con la API de GitHub: con la red caída se cuelga, y corre
    // con el lock del repo tomado. timeout acota cuánto queda tomado ese lock.
    const out = await exec('gh', ['pr', 'create', '--base', base, '--head', head, '--fill'], { cwd, timeout: NET_TIMEOUT_MS });
    return { ok: true, url: prUrl(out) || '' };
  } catch (e) {
    const common = ghCommonError(e);
    if (common) return common;
    const err = (e && ((e.stderr || '') + (e.stdout || ''))) || '';
    if (/already exists/i.test(err)) {
      return { ok: false, url: prUrl(err) || '', message: 'ya existe un PR para esta rama' };
    }
    // Fallback genérico: reusar trimErr (ya usado en el resto del server) en vez
    // de reimplementar el recorte con otros límites. A diferencia de `err` (que
    // sólo mira stdout/stderr), trimErr cae a e.message si stderr viene vacío
    // (EACCES, ENOTFOUND, timeout, killed), así el mensaje nunca queda "".
    return { ok: false, message: trimErr(e) };
  }
}

// Un clone de un repo grande tarda bastante más que un push/pull: NET_TIMEOUT_MS
// (60 s) lo cortaría a mitad de camino.
export const CLONE_TIMEOUT_MS = 5 * 60_000;

// 'owner/name' -> { owner, name }, o null. Estricto a propósito: name termina siendo
// el nombre de la carpeta destino dentro de PROJECTS_ROOT, así que nada de '..',
// barras extra ni nombres que arranquen con '-' (gh/git los leerían como flags).
const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const NAME_RE = /^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/;
export function parseRepo(s) {
  if (typeof s !== 'string') return null;
  const parts = s.split('/');
  if (parts.length !== 2) return null;
  const [owner, name] = parts;
  if (!OWNER_RE.test(owner) || !NAME_RE.test(name) || name === '.' || name === '..') return null;
  return { owner, name };
}

const REPO_FIELDS = 'name,nameWithOwner,description,isPrivate,updatedAt';

// Repos de un owner (usuario u org) según lo que ve la cuenta de `gh auth login`:
// incluye privados si esa cuenta tiene acceso.
export async function repoList(owner, exec = defaultExec) {
  try {
    const out = await exec('gh', ['repo', 'list', owner, '--limit', '200', '--json', REPO_FIELDS], { timeout: NET_TIMEOUT_MS });
    const repos = JSON.parse(out).map((r) => ({
      name: r.name,
      nameWithOwner: r.nameWithOwner,
      description: r.description || '',
      isPrivate: !!r.isPrivate,
      updatedAt: r.updatedAt || '',
    }));
    return { ok: true, repos };
  } catch (e) {
    return ghCommonError(e) || { ok: false, message: trimErr(e) };
  }
}

// Clona con gh por https explícito. Con 'owner/name' a secas gh usaría el protocolo
// de su config (en esta máquina, ssh, sin clave registrada en GitHub -> publickey
// denied); los repos existentes usan https + credential helper, igual que acá.
export async function repoClone(nameWithOwner, dest, exec = defaultExec) {
  try {
    await exec('gh', ['repo', 'clone', `https://github.com/${nameWithOwner}.git`, dest], { timeout: CLONE_TIMEOUT_MS });
    return { ok: true };
  } catch (e) {
    return ghCommonError(e) || { ok: false, message: trimErr(e) };
  }
}
