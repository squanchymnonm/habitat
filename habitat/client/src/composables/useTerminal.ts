import { watch, onUnmounted, type Ref } from 'vue'
import { Terminal, type IDisposable } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { createLinkProvider } from './terminalLinks'
import '@xterm/xterm/css/xterm.css'

const token = () => new URLSearchParams(location.search).get('token') ?? ''
const enc = new TextEncoder()

// Intent de copiar/pegar desde el teclado, agnóstico de plataforma.
// PEGAR: el navegador dispara su evento `paste` nativo con Ctrl+V, Cmd+V y
// Shift+Insert. Ctrl+Shift+V NO dispara paste nativo, pero lo aceptamos como alias.
// COPIAR: Ctrl+C (sin Shift) o Cmd+C. La decisión copiar-vs-SIGINT NO vive acá:
// depende de si hay selección y se resuelve en decideKeyAction.
export function copyPasteIntent(
  e: Pick<KeyboardEvent, 'type' | 'ctrlKey' | 'shiftKey' | 'metaKey' | 'code'>,
): 'copy' | 'paste' | null {
  if (e.type !== 'keydown') return null
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') return 'paste'
  if (e.shiftKey && e.code === 'Insert') return 'paste'
  if (e.ctrlKey && !e.shiftKey && e.code === 'KeyC') return 'copy'
  if (e.metaKey && e.code === 'KeyC') return 'copy'
  return null
}

// Resuelve qué hacer con una tecla de copy/paste según el estado de selección.
// 'copy'        -> copiar la selección y NO mandar la tecla al pty.
// 'paste'       -> dejar que el navegador pegue (evento paste nativo).
// 'passthrough' -> mandar la tecla al pty (p. ej. Ctrl+C sin selección = SIGINT).
export function decideKeyAction(
  intent: 'copy' | 'paste' | null,
  hasSelection: boolean,
): 'copy' | 'paste' | 'passthrough' {
  if (intent === 'paste') return 'paste'
  if (intent === 'copy') return hasSelection ? 'copy' : 'passthrough'
  return 'passthrough'
}

// ¿Podemos leer el portapapeles vía Async Clipboard API? Solo existe en contexto
// seguro (https o localhost). Servido por HTTP plano (p. ej. la tablet entrando por
// LAN a http://192.168.x.x) `navigator.clipboard` es undefined: ahí NO interceptamos
// el paste y dejamos que el navegador dispare el `paste` nativo, que xterm pega con
// clipboardData (sí funciona sin contexto seguro).
export function canReadClipboard(
  nav: { clipboard?: { readText?: unknown } } = navigator,
): boolean {
  return typeof nav.clipboard?.readText === 'function'
}

// Copia texto al portapapeles. En contexto seguro usa la Async Clipboard API; en
// contexto inseguro (HTTP/LAN) writeText no existe, así que cae a execCommand('copy')
// con un textarea temporal. DEBE llamarse dentro de un gesto del usuario.
export function copyText(text: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => execCommandCopy(text))
    return
  }
  execCommandCopy(text)
}

function execCommandCopy(text: string): void {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.top = '-1000px'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  try { document.execCommand('copy') } catch { /* sin soporte: no-op */ }
  ta.remove()
}

// Monta una terminal xterm sobre el WS /term mientras `id` esté seteado.
export function useTerminal(container: Ref<HTMLElement | null>, id: Ref<string | null | undefined>) {
  let term: Terminal | null = null
  let fitAddon: FitAddon | null = null
  let ws: WebSocket | null = null
  let linkProvider: IDisposable | null = null
  let mouseEl: HTMLElement | null = null
  // Última selección no vacía vista. tmux (mouse on) suele redibujar al soltar el mouse
  // o al hacer click derecho, lo que limpia la selección de xterm ANTES de que la leamos;
  // por eso guardamos el último texto seleccionado para no perderlo.
  let lastSelection = ''

  // En captura: el click derecho llega a xterm y le borra la selección antes del menú.
  // Snapshot de la selección + frenar la propagación para que xterm no la limpie.
  function onTermMouseDownCapture(e: MouseEvent) {
    if (e.button === 2) {
      const s = term?.getSelection()
      if (s) lastSelection = s
      e.stopPropagation()
    }
  }

  function teardown() {
    if (mouseEl) { mouseEl.removeEventListener('mousedown', onTermMouseDownCapture, true); mouseEl = null }
    if (ws) { ws.onmessage = null; ws.onerror = null; ws.onclose = null; ws.close(); ws = null }
    if (linkProvider) { linkProvider.dispose(); linkProvider = null }
    if (term) { term.dispose(); term = null }
    fitAddon = null
  }

  function sendResize() {
    if (ws && ws.readyState === 1 && term) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }
  }

  // Escribe texto al PTY como si se tipeara (lo usa el file browser para insertar
  // el path de un archivo en el prompt de Claude). No-op si el WS no está abierto.
  function insert(text: string) {
    if (ws && ws.readyState === 1) ws.send(enc.encode(text))
  }

  // Texto seleccionado en la terminal: el actual o, si tmux ya lo borró, el último visto.
  function getSelection() {
    return term?.getSelection() || lastSelection
  }

  // Copia la selección (actual o la última vista) al portapapeles. Devuelve true si copió.
  // Usa copyText para que ande también en contexto inseguro (la usa el menú de click derecho).
  function copySelection() {
    const sel = getSelection()
    if (sel) { copyText(sel); return true }
    return false
  }

  // Pega el portapapeles en la terminal (lo manda al pty vía term.paste).
  function pasteClipboard() {
    navigator.clipboard?.readText().then((t) => t && term?.paste(t)).catch(() => {})
  }

  function fit() {
    if (fitAddon) { fitAddon.fit(); sendResize() }
  }

  function setup(sessionId: string) {
    const el = container.value
    if (!el) return
    term = new Terminal({
      fontFamily: 'ui-monospace, Menlo, Consolas, "DejaVu Sans Mono", monospace',
      fontSize: 13,
      theme: { background: '#160e07' },
      cursorBlink: true,
      // En Mac, tmux mouse mode se traga el arrastre y xterm solo fuerza su selección
      // nativa con Option(Alt)+arrastrar SI esta opción está activa (default false).
      // Sin esto, en Mac no hay forma de seleccionar texto. En Linux/Win alcanza Shift.
      macOptionClickForcesSelection: true,
    })
    fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(el)
    fitAddon.fit()
    mouseEl = el
    el.addEventListener('mousedown', onTermMouseDownCapture, true)
    linkProvider = term.registerLinkProvider(
      createLinkProvider(term, (url) => window.open(url, '_blank', 'noopener,noreferrer')),
    )

    // Copiar/pegar: tmux corre con `mouse on`, así que arrastrar va a tmux y la rueda
    // scrollea su copy-mode. Para seleccionar en xterm hay que forzar su selección nativa:
    // Shift+arrastrar en Linux/Win, Option(Alt)+arrastrar en Mac (ver macOptionClickForcesSelection).
    // Copy-on-select: al soltar la selección la copiamos sola al portapapeles. El navegador
    // RESERVA Ctrl+Shift+C para DevTools y una página no lo puede cancelar, así que en
    // Linux/Win no se puede depender de ese atajo; copy-on-select + el menú de click derecho
    // (en DetailPanel) son los caminos confiables. El atajo de teclado queda igual como bonus
    // (útil sobre todo para Cmd+C/V en Mac, que sí funciona).
    term.onSelectionChange(() => {
      const sel = term?.getSelection()
      if (sel && sel !== lastSelection) {
        lastSelection = sel
        navigator.clipboard?.writeText(sel).catch(() => {})
      }
    })
    term.attachCustomKeyEventHandler((e) => {
      const action = decideKeyAction(copyPasteIntent(e), !!getSelection())
      if (action === 'passthrough') return true // p. ej. Ctrl+C sin selección -> SIGINT
      if (action === 'copy') {
        e.preventDefault()
        copyText(getSelection())
        term?.clearSelection()
        lastSelection = ''
        term?.focus()
        return false
      }
      // action === 'paste': NO hacemos preventDefault. Devolver false evita que xterm
      // emita ^V al pty, pero deja que el navegador dispare el evento `paste` nativo,
      // que el textarea oculto de xterm pega con clipboardData. Funciona igual en
      // https y en HTTP/LAN, sin leer el portapapeles por API.
      return false
    })

    const tok = token()
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/term?id=${encodeURIComponent(sessionId)}${tok ? `&token=${tok}` : ''}`)
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => sendResize()
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') term?.write(e.data)
      else term?.write(new Uint8Array(e.data))
    }
    term.onData((d) => { if (ws && ws.readyState === 1) ws.send(enc.encode(d)) })
  }

  watch(
    id,
    (cur) => {
      teardown()
      if (cur) {
        // rAF waits for the container div to be mounted in the DOM before calling setup
        requestAnimationFrame(() => cur && setup(cur))
      }
    },
    { immediate: true },
  )

  onUnmounted(teardown)
  return { fit, insert, getSelection, copySelection, pasteClipboard }
}
