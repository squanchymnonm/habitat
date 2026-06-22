import { ref } from 'vue'
import type { PermissionMode, Settings } from '../types'

// Token de la query, igual que useProjects/useSocket.
const token = () => new URLSearchParams(location.search).get('token') ?? ''
const authHeaders = (): Record<string, string> => {
  const t = token()
  return t ? { authorization: `Bearer ${t}` } : {}
}

// Estado compartido a nivel de módulo (singleton, como useProjects): /settings se
// pide una sola vez y permissionMode se comparte entre la vista y el resto.
const permissionMode = ref<PermissionMode>('acceptEdits')
const error = ref('')
const saving = ref(false)
let loaded = false

async function load() {
  try {
    const res = await fetch('/settings', { headers: authHeaders() })
    if (!res.ok) return
    const data = (await res.json()) as Settings
    permissionMode.value = data.permissionMode
  } catch {
    /* sin red: queda el default */
  }
}

async function save(mode: PermissionMode): Promise<boolean> {
  error.value = ''
  saving.value = true
  try {
    const res = await fetch('/settings', {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ permissionMode: mode }),
    })
    if (res.ok) {
      const data = (await res.json()) as Settings
      permissionMode.value = data.permissionMode
      return true
    }
    error.value = 'no se pudo guardar'
    return false
  } catch {
    error.value = 'no se pudo guardar'
    return false
  } finally {
    saving.value = false
  }
}

// Aplica un broadcast del server (otra pestaña guardó). No dispara load().
export function applyServerSettings(s: Settings) {
  permissionMode.value = s.permissionMode
}

export function useSettings() {
  if (!loaded) {
    loaded = true
    load()
  }
  return { permissionMode, error, saving, save }
}
