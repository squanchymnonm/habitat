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
  // Pega a /auth/me y devuelve el resultado sin tocar `authed`: lo usan checkAuth (que sí
  // decide `authed` a partir de esto) y login (que ya sabe por el 204 que está logueado,
  // y no quiere que una falla de red de este pedido lo desloguee).
  async function fetchMe(): Promise<{ ok: boolean; user: string | null }> {
    try {
      const res = await fetch('/auth/me', { headers: authHeaders() })
      if (res.status !== 200) return { ok: false, user: null }
      const data = (await res.json?.().catch(() => ({}))) as { user?: string | null } | undefined
      return { ok: true, user: data?.user ?? null }
    } catch {
      return { ok: false, user: null }
    }
  }

  async function checkAuth() {
    const r = await fetchMe()
    authed.value = r.ok
    user.value = r.user
  }

  async function login(username: string, password: string): Promise<boolean> {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user: username, password }),
    })
    const ok = res.status === 204
    if (ok) {
      // El 204 ya confirma el login: se marca authed de una. El pedido a /auth/me que
      // sigue es sólo para mostrar el nombre de usuario; si falla por red no desloguea,
      // sólo queda sin `user`.
      authed.value = true
      const r = await fetchMe()
      user.value = r.user
    }
    return ok
  }

  async function logout() {
    try { await fetch('/logout', { method: 'POST' }) } catch { /* ignore */ }
    authed.value = false
    user.value = null
  }

  return { authed, user, checkAuth, login, logout }
}
