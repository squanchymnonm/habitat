import { watch, onUnmounted, type Ref } from 'vue'
import { Terminal, type IDisposable } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { createLinkProvider } from './terminalLinks'
import '@xterm/xterm/css/xterm.css'

const token = () => new URLSearchParams(location.search).get('token') ?? ''
const enc = new TextEncoder()

// Intent de copiar/pegar desde el teclado, agnóstico de plataforma: Linux/Windows
// usan Ctrl+Shift+C/V; Mac usa Cmd (metaKey) +C/V. Ctrl+C pelado (sin Shift) NO
// se intercepta para que siga llegando al pty como SIGINT.
export function copyPasteIntent(
  e: Pick<KeyboardEvent, 'type' | 'ctrlKey' | 'shiftKey' | 'metaKey' | 'code'>,
): 'copy' | 'paste' | null {
  if (e.type !== 'keydown') return null
  const mod = (e.ctrlKey && e.shiftKey) || e.metaKey
  if (!mod) return null
  if (e.code === 'KeyC') return 'copy'
  if (e.code === 'KeyV') return 'paste'
  return null
}

// Monta una terminal xterm sobre el WS /term mientras `id` esté seteado.
export function useTerminal(container: Ref<HTMLElement | null>, id: Ref<string | null | undefined>) {
  let term: Terminal | null = null
  let fitAddon: FitAddon | null = null
  let ws: WebSocket | null = null
  let linkProvider: IDisposable | null = null

  function teardown() {
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

  // Texto actualmente seleccionado en la terminal ('' si no hay selección).
  function getSelection() {
    return term?.getSelection() ?? ''
  }

  // Copia la selección actual al portapapeles. Devuelve true si había algo que copiar.
  function copySelection() {
    const sel = term?.getSelection()
    if (sel) { navigator.clipboard?.writeText(sel).catch(() => {}); return true }
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
    term.onSelectionChange(() => { copySelection() })
    term.attachCustomKeyEventHandler((e) => {
      const intent = copyPasteIntent(e)
      if (!intent) return true
      e.preventDefault()
      if (intent === 'copy') copySelection()
      else pasteClipboard()
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
