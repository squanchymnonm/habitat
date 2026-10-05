import { ref, computed } from 'vue'

// Modo de layout según el tamaño de la ventana. phone: el lado menor no llega a 600
// (celular, también acostado). landscape: más ancho que alto y al menos 900 de ancho
// (barra de sesiones a la izquierda). portrait: el resto (pestañas arriba).
export type LayoutMode = 'landscape' | 'portrait' | 'phone'

export function layoutModeFor(w: number, h: number): LayoutMode {
  if (Math.min(w, h) < 600) return 'phone'
  if (w > h && w >= 900) return 'landscape'
  return 'portrait'
}

const KEY = (m: LayoutMode) => `habitat.nav.collapsed.${m}`
function readCollapsed(m: LayoutMode): boolean {
  try { return localStorage.getItem(KEY(m)) === '1' } catch { return false }
}

const size = () => (typeof window === 'undefined' ? [1440, 900] : [window.innerWidth, window.innerHeight])
const mode = ref<LayoutMode>(layoutModeFor(...(size() as [number, number])))
const collapsedByMode = ref<Record<LayoutMode, boolean>>({
  landscape: readCollapsed('landscape'), portrait: readCollapsed('portrait'), phone: false,
})

let listening = false
function listen() {
  if (listening || typeof window === 'undefined') return
  listening = true
  // resize cubre también la rotación en tablets.
  window.addEventListener('resize', () => { mode.value = layoutModeFor(window.innerWidth, window.innerHeight) })
}

export function useLayoutMode() {
  listen()
  const collapsed = computed(() => collapsedByMode.value[mode.value])
  function setCollapsed(v: boolean) {
    if (mode.value === 'phone') return
    collapsedByMode.value = { ...collapsedByMode.value, [mode.value]: v }
    try { localStorage.setItem(KEY(mode.value), v ? '1' : '0') } catch { /* sin storage */ }
  }
  function toggleCollapsed() { setCollapsed(!collapsed.value) }
  return { mode, collapsed, setCollapsed, toggleCollapsed }
}
