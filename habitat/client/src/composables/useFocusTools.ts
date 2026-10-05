import { computed, reactive, ref, watch, type Ref } from 'vue'
import { useLayoutMode } from './useLayoutMode'

// Estado del modo foco. Pestaña activa, panel fijado y carpeta actual son por sesión
// y viven mientras dure la página (no se persisten). El ancho del panel fijado es
// global y se guarda por dispositivo.
export type ToolId = 'terminal' | 'git' | 'files' | 'infra' | 'quest'
export type SideTool = Exclude<ToolId, 'terminal'>

interface SessionTools { active: ToolId; pinned: SideTool | null; path: string }

const SIZE_KEY = 'habitat.focus.pinnedSize'
const DEFAULT_SIZE = 40

function readSize(): number {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY))
    return n >= 15 && n <= 85 ? n : DEFAULT_SIZE
  } catch {
    return DEFAULT_SIZE
  }
}

let bySession = reactive<Record<string, SessionTools>>({})
const pinnedSize = ref(readSize())
let watching = false

export function resetFocusTools() {
  bySession = reactive({})
  pinnedSize.value = readSize()
  watching = false
}

export function useFocusTools(sessionId: Ref<string | null>) {
  const { mode } = useLayoutMode()
  const entry = (): SessionTools | null => {
    const id = sessionId.value
    if (!id) return null
    return (bySession[id] ??= { active: 'terminal', pinned: null, path: '' })
  }
  const peek = (): SessionTools | null => (sessionId.value ? bySession[sessionId.value] ?? null : null)

  // Fijar al costado sólo tiene sentido con ancho de sobra (landscape).
  const canPin = computed(() => mode.value === 'landscape')

  // Al salir de landscape con paneles fijados, cada uno se desfija y su herramienta
  // pasa a ser la pestaña activa de su sesión.
  if (!watching) {
    watching = true
    watch(mode, (m) => {
      if (m === 'landscape') return
      for (const s of Object.values(bySession)) {
        if (s.pinned) { s.active = s.pinned; s.pinned = null }
      }
    })
  }

  function select(tool: ToolId) {
    const s = entry()
    if (!s) return
    // Con un panel fijado la terminal queda a la izquierda: elegir otra herramienta
    // cambia lo que muestra el panel fijado.
    if (s.pinned && tool !== 'terminal') { s.pinned = tool; return }
    s.active = tool
  }
  function pin(tool: SideTool) {
    const s = entry()
    if (!s || !canPin.value) return
    s.pinned = tool
    s.active = 'terminal'
  }
  function unpin() {
    const s = entry()
    if (!s || !s.pinned) return
    s.active = s.pinned
    s.pinned = null
  }
  function setPath(rel: string) {
    const s = entry()
    if (s) s.path = rel
  }
  function setPinnedSize(n: number) {
    pinnedSize.value = n
    try { localStorage.setItem(SIZE_KEY, String(Math.round(n))) } catch { /* sin storage: queda en memoria */ }
  }

  return {
    active: computed<ToolId>(() => peek()?.active ?? 'terminal'),
    pinned: computed<SideTool | null>(() => peek()?.pinned ?? null),
    path: computed(() => peek()?.path ?? ''),
    pinnedSize,
    canPin,
    select, pin, unpin, setPath, setPinnedSize,
  }
}
