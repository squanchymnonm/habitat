import { ref } from 'vue'
import type { Project } from '../types'

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

const canSpawn = ref(false)
const canManage = ref(false)
const projects = ref<Project[]>([])
const error = ref('')
let loaded = false

const basenameOf = (dir: string) => dir.split('/').filter(Boolean).pop() ?? dir

async function load() {
  try {
    const res = await fetch('/projects', { headers: authHeaders() })
    if (!res.ok) return
    const data = (await res.json()) as { canSpawn: boolean; canManage?: boolean; projects: Project[] }
    canSpawn.value = data.canSpawn
    canManage.value = !!data.canManage
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

function colorForProject(name: string): string {
  const p = projects.value.find((p) => basenameOf(p.dir) === name || p.name === name)
  return p?.color ?? ''
}

async function spawn(dir: string, branch: string, base: string, char?: string): Promise<boolean> {
  error.value = ''
  try {
    const res = await fetch('/spawn', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ dir, branch, base, char }) })
    if (res.ok) return true
    error.value =
      res.status === 409 ? 'ya hay un agente en esa rama'
      : res.status === 400 ? 'datos inválidos'
      : res.status === 403 ? 'no permitido'
      : 'no se pudo crear el agente'
    return false
  } catch {
    error.value = 'no se pudo crear el agente'
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

export function useProjects() {
  if (!loaded) {
    loaded = true
    load()
  }
  return { canSpawn, canManage, projects, error, spawn, kill, browse, addProject, updateProject, removeProject, colorForProject }
}
