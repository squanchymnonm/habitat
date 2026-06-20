import { ref, watch, onUnmounted, type Ref } from 'vue'

// Polling del preview real de tmux (GET /preview?id=<id>) mientras el drawer está abierto.
// El endpoint exige el mismo Bearer token que el WS (Ley 1).
const token = () => new URLSearchParams(location.search).get('token') ?? ''

export function usePreview(id: Ref<string | null | undefined>, intervalMs = 2000) {
  const lines = ref('')
  const loading = ref(false)
  let timer: number | undefined

  async function fetchOnce(sessionId: string) {
    loading.value = true
    try {
      const tok = token()
      const res = await fetch(`/preview?id=${encodeURIComponent(sessionId)}`, {
        headers: tok ? { authorization: `Bearer ${tok}` } : {},
      })
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as { lines: string }
      lines.value = data.lines ?? ''
    } catch {
      lines.value = ''
    } finally {
      loading.value = false
    }
  }

  function stop() {
    if (timer != null) {
      clearInterval(timer)
      timer = undefined
    }
  }

  watch(
    id,
    (cur) => {
      stop()
      lines.value = ''
      if (!cur) return
      fetchOnce(cur)
      timer = setInterval(() => fetchOnce(cur), intervalMs) as unknown as number
    },
    { immediate: true },
  )

  onUnmounted(stop)
  return { lines, loading }
}
