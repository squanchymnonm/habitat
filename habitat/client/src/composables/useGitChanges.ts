import { ref } from 'vue'

const token = () => new URLSearchParams(location.search).get('token') ?? ''
const authHeaders = (): Record<string, string> => {
  const t = token()
  return t ? { authorization: `Bearer ${t}` } : {}
}

export interface GitFile { rel: string; status: string; old?: string }
export interface GitOverview { branch: string; default: string; ahead: number; behind: number; files: GitFile[] }
export interface GitCommit { sha: string; shortSha: string; subject: string; pushed: boolean; files: GitFile[] }
export interface GitWorking { staged: GitFile[]; unstaged: GitFile[]; untracked: GitFile[]; conflicted: GitFile[] }
export interface GitStatus { working: GitWorking; overview: GitOverview; commits: GitCommit[]; canWrite: boolean }
export interface GitActionResult { ok: boolean; conflict?: boolean; files?: string[]; code?: number; message?: string }
export type DiffBase = 'working' | 'staged' | 'branch' | `commit:${string}`

export function useGitChanges() {
  const status = ref<GitStatus | null>(null)
  const loading = ref(false)
  const error = ref('')

  async function loadStatus(id: string) {
    loading.value = true
    error.value = ''
    try {
      const res = await fetch(`/git/status?id=${encodeURIComponent(id)}`, { headers: authHeaders() })
      if (!res.ok) { error.value = res.status === 409 ? 'sin-dir' : `HTTP ${res.status}`; return }
      status.value = (await res.json()) as GitStatus
    } catch {
      error.value = 'sin conexión'
    } finally {
      loading.value = false
    }
  }

  async function loadDiff(id: string, file: string, base: DiffBase): Promise<{ binary: boolean; patch: string }> {
    const res = await fetch(
      `/git/diff?id=${encodeURIComponent(id)}&file=${encodeURIComponent(file)}&base=${encodeURIComponent(base)}`,
      { headers: authHeaders() },
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as { binary: boolean; patch: string }
  }

  async function action(
    id: string,
    actionName: string,
    payload: { paths?: string[]; message?: string } = {},
  ): Promise<GitActionResult> {
    const res = await fetch(`/git/action?id=${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ action: actionName, ...payload }),
    })
    if (res.status === 403) return { ok: false, message: 'acciones git deshabilitadas (HABITAT_ALLOW_GIT_WRITE)' }
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` }
    return (await res.json()) as GitActionResult
  }

  return { status, loading, error, loadStatus, loadDiff, action }
}
