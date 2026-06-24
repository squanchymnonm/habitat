import { ref } from 'vue'
import type { QuestBook } from '../types'

// Token de la query, igual que useProjects/usePreview.
const token = () => new URLSearchParams(location.search).get('token') ?? ''
const authHeaders = (): Record<string, string> => {
  const t = token()
  return t ? { authorization: `Bearer ${t}` } : {}
}

// Pide el Quest Book on-demand (al abrir el libro). No es singleton: cada panel
// maneja su propia carga.
export function useQuestBook() {
  const book = ref<QuestBook | null>(null)
  const loading = ref(false)
  const error = ref('')

  async function load(id: string) {
    loading.value = true
    error.value = ''
    book.value = null
    try {
      const res = await fetch(`/questbook?id=${encodeURIComponent(id)}`, { headers: authHeaders() })
      if (!res.ok) { error.value = `HTTP ${res.status}`; return }
      book.value = (await res.json()) as QuestBook
    } catch {
      error.value = 'sin conexión'
    } finally {
      loading.value = false
    }
  }

  return { book, loading, error, load }
}
