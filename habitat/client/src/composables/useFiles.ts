import { ref } from 'vue'

// Token de la query, igual que useQuestBook/useProjects.
const token = () => new URLSearchParams(location.search).get('token') ?? ''
const authHeaders = (): Record<string, string> => {
  const t = token()
  return t ? { authorization: `Bearer ${t}` } : {}
}

export interface FileEntry { name: string; rel: string; isDir: boolean; size: number }
export interface FileListing {
  root: string
  rel: string
  breadcrumbs: { name: string; rel: string }[]
  entries: FileEntry[]
}

// Cita el path con comillas dobles si tiene espacios, para que Claude lo lea como
// un solo token al insertarlo en el prompt.
export function quotePath(p: string): string {
  return /\s/.test(p) ? `"${p}"` : p
}

export function useFiles() {
  const listing = ref<FileListing | null>(null)
  const loading = ref(false)
  const error = ref('')

  async function list(id: string, path = '') {
    loading.value = true
    error.value = ''
    try {
      const res = await fetch(
        `/files?id=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`,
        { headers: authHeaders() },
      )
      if (!res.ok) { error.value = res.status === 409 ? 'sin-dir' : `HTTP ${res.status}`; return }
      listing.value = (await res.json()) as FileListing
    } catch {
      error.value = 'sin conexión'
    } finally {
      loading.value = false
    }
  }

  // Sube `file` por body crudo. Ante 413 lanza { tooLarge: true } para que la UI
  // pida la contraseña y reintente con `password`.
  async function upload(id: string, file: File, password?: string): Promise<{ rel: string }> {
    const headers: Record<string, string> = {
      ...authHeaders(),
      'x-filename': encodeURIComponent(file.name),
    }
    if (password) headers['x-upload-password'] = password
    const res = await fetch(`/files/upload?id=${encodeURIComponent(id)}`, {
      method: 'POST', headers, body: file,
    })
    if (res.status === 413) throw { tooLarge: true }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as { rel: string }
  }

  return { listing, loading, error, list, upload }
}
