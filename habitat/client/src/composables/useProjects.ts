import { ref, onMounted } from 'vue'

// Token de la query, igual que usePreview/useSocket.
const token = () => new URLSearchParams(location.search).get('token') ?? ''
const authHeaders = (): Record<string, string> => {
  const t = token()
  return t ? { authorization: `Bearer ${t}` } : {}
}

export interface Project {
  name: string
  dir: string
}

export function useProjects() {
  const canSpawn = ref(false)
  const projects = ref<Project[]>([])
  const error = ref('')

  async function load() {
    try {
      const res = await fetch('/projects', { headers: authHeaders() })
      if (!res.ok) return
      const data = (await res.json()) as { canSpawn: boolean; projects: Project[] }
      canSpawn.value = data.canSpawn
      projects.value = data.projects
    } catch {
      /* sin red: el botón simplemente no aparece */
    }
  }

  async function spawn(dir: string, branch: string, base: string): Promise<boolean> {
    error.value = ''
    try {
      const res = await fetch('/spawn', {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ dir, branch, base }),
      })
      if (res.ok) return true
      error.value =
        res.status === 409 ? 'ya hay un agente en esa rama'
        : res.status === 400 ? 'nombre de rama inválido'
        : res.status === 403 ? 'no permitido'
        : 'no se pudo crear el agente'
      return false
    } catch {
      error.value = 'no se pudo crear el agente'
      return false
    }
  }

  onMounted(load)
  return { canSpawn, projects, error, spawn }
}
