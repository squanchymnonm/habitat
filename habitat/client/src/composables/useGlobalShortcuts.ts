import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSessions } from '../stores/sessions'
import { typingTarget, insideDialog } from './useFocusShortcuts'

export type GlobalAction = 'board' | 'focus'

// Secuencia estilo "g b": la g arma, la segunda tecla dentro del plazo dispara.
export function createSequence(timeoutMs = 1000) {
  let armedAt: number | null = null
  return (key: string, now: number): GlobalAction | null => {
    if (armedAt !== null && now - armedAt <= timeoutMs) {
      armedAt = null
      if (key === 'b') return 'board'
      if (key === 'f') return 'focus'
      return null
    }
    armedAt = key === 'g' ? now : null
    return null
  }
}

// g b → tablero, g f → foco. Mismas guardas que [ ]: no actúan en la terminal,
// en campos editables ni dentro de un diálogo.
export function useGlobalShortcuts() {
  const router = useRouter()
  const store = useSessions()
  const seq = createSequence()
  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (typingTarget(e.target) || insideDialog(e.target)) return
    const action = seq(e.key, Date.now())
    if (action === 'board') router.push('/board')
    else if (action === 'focus') router.push(store.selectedId ? `/s/${store.selectedId}` : '/')
  }
  onMounted(() => document.addEventListener('keydown', onKey))
  onUnmounted(() => document.removeEventListener('keydown', onKey))
}
