import { ref } from 'vue'

// Token de la query, igual que useProjects/useSocket/useSettings: permite seguir
// entrando por ?token= cuando el login (USER/PASSWORD_HASH) no está configurado.
const token = () => new URLSearchParams(location.search).get('token') ?? ''
const authHeaders = (): Record<string, string> => {
  const t = token()
  return t ? { authorization: `Bearer ${t}` } : {}
}

// null = aún no chequeado; true/false = resultado de /auth/me.
const authed = ref<boolean | null>(null)
// Usuario logueado (USER/PASSWORD_HASH); null si entró por token o aún no se sabe.
const user = ref<string | null>(null)

export function useAuth() {
  async function checkAuth() {
    try {
      const res = await fetch('/auth/me', { headers: authHeaders() })
      authed.value = res.status === 200
      if (res.status === 200) {
        const data = (await res.json?.().catch(() => ({}))) as { user?: string | null } | undefined
        user.value = data?.user ?? null
      } else {
        user.value = null
      }
    } catch {
      authed.value = false
      user.value = null
    }
  }

  async function login(username: string, password: string): Promise<boolean> {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user: username, password }),
    })
    const ok = res.status === 204
    if (ok) await checkAuth()
    return ok
  }

  async function logout() {
    try { await fetch('/logout', { method: 'POST' }) } catch { /* ignore */ }
    authed.value = false
    user.value = null
  }

  return { authed, user, checkAuth, login, logout }
}
