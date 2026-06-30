import { ref } from 'vue'

const token = () => new URLSearchParams(location.search).get('token') ?? ''
const authHeaders = (): Record<string, string> => {
  const t = token()
  return t ? { authorization: `Bearer ${t}` } : {}
}

export interface TreeEntry { name: string; rel: string; isDir: boolean; size: number }
export interface TreeListing {
  root: string
  rel: string
  breadcrumbs: { name: string; rel: string }[]
  entries: TreeEntry[]
}
export type FileContent =
  | { text: string; size: number }
  | { binary: true; size: number }
  | { tooLarge: true; size: number }

export function useProjectTree() {
  const listing = ref<TreeListing | null>(null)
  const loading = ref(false)
  const error = ref('')

  async function loadTree(id: string, path = '') {
    loading.value = true
    error.value = ''
    try {
      const res = await fetch(
        `/tree?id=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`,
        { headers: authHeaders() },
      )
      if (!res.ok) { error.value = res.status === 409 ? 'sin-dir' : `HTTP ${res.status}`; return }
      listing.value = (await res.json()) as TreeListing
    } catch {
      error.value = 'sin conexión'
    } finally {
      loading.value = false
    }
  }

  async function loadFile(id: string, path: string): Promise<FileContent> {
    const res = await fetch(
      `/file?id=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`,
      { headers: authHeaders() },
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as FileContent
  }

  async function openInNvim(id: string, path: string): Promise<{ ok: boolean; message?: string }> {
    const res = await fetch(`/editor/open?id=${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` }
    return (await res.json()) as { ok: boolean; message?: string }
  }

  return { listing, loading, error, loadTree, loadFile, openInNvim }
}
