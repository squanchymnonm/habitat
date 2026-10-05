import { onMounted, onUnmounted } from 'vue'
import { useSessions } from '../stores/sessions'
import { useGoToSession } from './useGoToSession'

export type Shortcut = 'prev' | 'next' | 'escape'

// Los atajos no compiten con lo que el usuario escribe: se apagan en la terminal
// (xterm captura el teclado en su textarea) y en cualquier campo editable.
function typingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  if (t.closest('.xterm') || t.classList.contains('xterm-helper-textarea')) return true
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable || t.getAttribute('contenteditable') === 'true'
}

// Un diálogo (Reka) es dueño de su propio teclado: ningún atajo nuestro debe actuar
// si el evento viene de ahí adentro.
function insideDialog(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && !!t.closest('[role="dialog"]')
}

export function shortcutFor(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>, target: EventTarget | null): Shortcut | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  if (typingTarget(target)) return null
  if (insideDialog(target)) return null
  if (e.key === '[') return 'prev'
  if (e.key === ']') return 'next'
  if (e.key === 'Escape') return 'escape'
  return null
}

// [ y ] recorren las sesiones en el orden de la nav (circular). Esc delega en el foco
// (cerrar editor, desfijar panel).
export function useFocusShortcuts(opts: { onEscape: () => boolean }) {
  const store = useSessions()
  const goTo = useGoToSession()
  function onKey(e: KeyboardEvent) {
    const s = shortcutFor(e, e.target)
    if (!s) return
    if (s === 'escape') {
      // Reka's DismissableLayer escucha Esc en window y sólo cierra si el evento no
      // llegó con preventDefault: nunca lo llamamos acá, y si hay un diálogo abierto
      // en cualquier parte del documento (no sólo dentro del target), el Esc es suyo.
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      opts.onEscape()
      return
    }
    const ids = store.list.map((x) => x.id)
    if (!ids.length) return
    const i = Math.max(0, ids.indexOf(store.selectedId ?? ''))
    const next = s === 'next' ? (i + 1) % ids.length : (i - 1 + ids.length) % ids.length
    e.preventDefault()
    goTo(ids[next])
  }
  onMounted(() => document.addEventListener('keydown', onKey))
  onUnmounted(() => document.removeEventListener('keydown', onKey))
}
