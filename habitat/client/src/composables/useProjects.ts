import { ref } from 'vue'
import type { Project, RelatedRepo, InfraConfig, EnvFile } from '../types'

const token = () => new URLSearchParams(location.search).get('token') ?? ''
const authHeaders = (): Record<string, string> => {
  const t = token()
  return t ? { authorization: `Bearer ${t}` } : {}
}
const jsonHeaders = () => ({ ...authHeaders(), 'content-type': 'application/json' })

export interface BrowseEntry { name: string; rel: string; isRepo: boolean; added: boolean }
export interface BrowseResult {
  root: string; rel: string
  breadcrumbs: { name: string; rel: string }[]
  entries: BrowseEntry[]
}

export interface CloneRepo {
  name: string; nameWithOwner: string; description: string
  isPrivate: boolean; updatedAt: string; cloned: boolean
}
export interface RepoList { repos: CloneRepo[]; errors: { owner: string; message: string }[] }

const canSpawn = ref(false)
const canManage = ref(false)
const canClone = ref(false)
const projects = ref<Project[]>([])
const error = ref('')
let loaded = false

const basenameOf = (dir: string) => dir.split('/').filter(Boolean).pop() ?? dir

async function load() {
  try {
    const res = await fetch('/projects', { headers: authHeaders() })
    if (!res.ok) return
    const data = (await res.json()) as { canSpawn: boolean; canManage?: boolean; canClone?: boolean; projects: Project[] }
    canSpawn.value = data.canSpawn
    canManage.value = !!data.canManage
    canClone.value = !!data.canClone
    projects.value = data.projects
  } catch {
    /* sin red: el botón simplemente no aparece */
  }
}

// Aplica un broadcast del server (otra pestaña/cambio de proyectos). No dispara load().
export function applyServerProjects(list: Project[]) {
  projects.value = list
  canSpawn.value = canSpawn.value || list.length > 0
}

async function browse(path = ''): Promise<BrowseResult | null> {
  try {
    const q = path ? `?path=${encodeURIComponent(path)}` : ''
    const res = await fetch(`/projects/browse${q}`, { headers: authHeaders() })
    if (!res.ok) return null
    return (await res.json()) as BrowseResult
  } catch {
    return null
  }
}

// Repos de los owners whitelisteados (HABITAT_CLONE_OWNERS). null si no se pudo listar.
async function listRepos(): Promise<RepoList | null> {
  try {
    const res = await fetch('/projects/repos', { headers: authHeaders() })
    if (!res.ok) return null
    return (await res.json()) as RepoList
  } catch {
    return null
  }
}

// Clona owner/name en PROJECTS_ROOT. Devuelve el rel de la carpeta para seguir con el alta.
async function cloneRepo(repo: string): Promise<{ ok: true; rel: string } | { ok: false; message: string }> {
  const fail = (message: string) => ({ ok: false as const, message })
  try {
    const res = await fetch('/projects/clone', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ repo }) })
    if (res.status === 409) return fail('ya existe una carpeta con ese nombre (o se está clonando)')
    if (res.status === 403) return fail('ese repo no está permitido')
    if (!res.ok) return fail('no se pudo clonar el repo')
    const data = (await res.json()) as { ok: boolean; rel?: string; message?: string }
    return data.ok && data.rel ? { ok: true, rel: data.rel } : fail(data.message || 'no se pudo clonar el repo')
  } catch {
    return fail('no se pudo clonar el repo')
  }
}

async function addProject(p: { dir: string; label?: string; color: string; chars?: string[] }): Promise<boolean> {
  error.value = ''
  try {
    const res = await fetch('/projects', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(p) })
    if (res.ok) { await load(); return true }
    error.value = res.status === 409 ? 'ese proyecto ya está agregado' : 'no se pudo agregar el proyecto'
    return false
  } catch {
    error.value = 'no se pudo agregar el proyecto'
    return false
  }
}

async function updateProject(p: { dir: string; label?: string; color?: string; chars?: string[] }): Promise<boolean> {
  error.value = ''
  try {
    const res = await fetch('/projects', { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(p) })
    if (res.ok) { await load(); return true }
    error.value = 'no se pudo editar el proyecto'
    return false
  } catch {
    error.value = 'no se pudo editar el proyecto'
    return false
  }
}

async function removeProject(dir: string): Promise<boolean> {
  error.value = ''
  try {
    const res = await fetch('/projects', { method: 'DELETE', headers: jsonHeaders(), body: JSON.stringify({ dir }) })
    if (res.ok) { await load(); return true }
    error.value = 'no se pudo quitar el proyecto'
    return false
  } catch {
    error.value = 'no se pudo quitar el proyecto'
    return false
  }
}

const envQuery = (dir: string, repo: string, path: string) =>
  `dir=${encodeURIComponent(dir)}&repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}`

async function saveConfig(dir: string, cfg: { related: RelatedRepo[]; infra: InfraConfig | null; envFiles: EnvFile[] }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch('/projects', { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ dir, ...cfg }) })
    if (res.ok) { await load(); return { ok: true } }
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    return { ok: false, error: data.error || 'no se pudo guardar la configuración' }
  } catch {
    return { ok: false, error: 'no se pudo guardar la configuración' }
  }
}

// Plantilla guardada en Habitat. null si no se pudo leer.
async function getEnv(dir: string, repo: string, path: string): Promise<string | null> {
  try {
    const res = await fetch(`/projects/env?${envQuery(dir, repo, path)}`, { headers: authHeaders() })
    if (!res.ok) return null
    return ((await res.json()) as { content: string }).content
  } catch {
    return null
  }
}

// .env real del checkout principal, como punto de partida de la plantilla.
async function importEnv(dir: string, repo: string, path: string): Promise<string | null> {
  try {
    const res = await fetch(`/projects/env/import?${envQuery(dir, repo, path)}`, { headers: authHeaders() })
    if (!res.ok) return null
    return ((await res.json()) as { content: string }).content
  } catch {
    return null
  }
}

async function saveEnv(dir: string, repo: string, path: string, content: string): Promise<{ ok: true } | { ok: false; unknown?: string[]; error: string }> {
  try {
    const res = await fetch('/projects/env', { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({ dir, repo, path, content }) })
    if (res.ok) return { ok: true }
    if (res.status === 400) {
      const data = (await res.json().catch(() => ({}))) as { unknown?: string[] }
      if (data.unknown?.length) return { ok: false, unknown: data.unknown, error: `variables desconocidas: ${data.unknown.join(', ')}` }
    }
    return { ok: false, error: res.status === 413 ? 'la plantilla es demasiado grande' : 'no se pudo guardar la plantilla' }
  } catch {
    return { ok: false, error: 'no se pudo guardar la plantilla' }
  }
}

function colorForProject(name: string): string {
  const p = projects.value.find((p) => basenameOf(p.dir) === name || p.name === name)
  return p?.color ?? ''
}

async function spawn(dir: string, name: string, char?: string): Promise<boolean> {
  error.value = ''
  try {
    const res = await fetch('/spawn', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ dir, name, char }) })
    if (res.ok) return true
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    error.value =
      data.error ? `no se pudo crear la sesión: ${data.error}`
      : res.status === 409 ? 'ya existe un personaje con ese nombre'
      : res.status === 400 ? 'nombre inválido'
      : res.status === 403 ? 'no permitido'
      : 'no se pudo crear la sesión'
    return false
  } catch {
    error.value = 'no se pudo crear la sesión'
    return false
  }
}

async function kill(id: string): Promise<boolean> {
  try {
    const res = await fetch('/kill', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ id }) })
    return res.ok
  } catch {
    return false
  }
}

// Stacks de docker levantados dentro del worktree de la sesión. [] si no hay ninguno,
// si la sesión es plana (repo principal) o si docker no está disponible.
async function dockerStatus(id: string): Promise<string[]> {
  try {
    const res = await fetch(`/docker/status?id=${encodeURIComponent(id)}`, { headers: authHeaders() })
    if (!res.ok) return []
    const data = (await res.json()) as { stacks?: string[] }
    return data.stacks ?? []
  } catch {
    return []
  }
}

// Baja esos stacks (containers + red; los volúmenes con datos quedan). Devuelve los
// proyectos efectivamente bajados.
async function dockerDown(id: string): Promise<string[]> {
  try {
    const res = await fetch('/docker/down', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ id }) })
    if (!res.ok) return []
    const data = (await res.json()) as { stacks?: string[] }
    return data.stacks ?? []
  } catch {
    return []
  }
}

export function useProjects() {
  if (!loaded) {
    loaded = true
    load()
  }
  return { canSpawn, canManage, canClone, projects, error, spawn, kill, browse, listRepos, cloneRepo, addProject, updateProject, removeProject, colorForProject, dockerStatus, dockerDown, saveConfig, getEnv, importEnv, saveEnv }
}
