import { ref } from 'vue'

// null = aún no chequeado; true/false = resultado de /auth/me.
const authed = ref<boolean | null>(null)

export function useAuth() {
  async function checkAuth() {
    try {
      const res = await fetch('/auth/me')
      authed.value = res.status === 200
    } catch {
      authed.value = false
    }
  }

  async function login(user: string, password: string): Promise<boolean> {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user, password }),
    })
    const ok = res.status === 204
    if (ok) authed.value = true
    return ok
  }

  async function logout() {
    try { await fetch('/logout', { method: 'POST' }) } catch { /* ignore */ }
    authed.value = false
  }

  return { authed, checkAuth, login, logout }
}
