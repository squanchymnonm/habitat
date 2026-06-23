import { watch, onUnmounted, type Ref } from 'vue'
import { Terminal, type IDisposable } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { createLinkProvider } from './terminalLinks'
import '@xterm/xterm/css/xterm.css'

const token = () => new URLSearchParams(location.search).get('token') ?? ''
const enc = new TextEncoder()

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
    })
    fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(el)
    fitAddon.fit()
    linkProvider = term.registerLinkProvider(
      createLinkProvider(term, (url) => window.open(url, '_blank', 'noopener,noreferrer')),
    )

    // Copiar/pegar: tmux corre con `mouse on`, así que arrastrar va a tmux y la rueda
    // scrollea su copy-mode. Para seleccionar en xterm hay que mantener Shift al arrastrar
    // (xterm fuerza su selección nativa). Acá cableamos Ctrl+Shift+C/V sobre esa selección;
    // devolver false evita que xterm mande la tecla al pty. usa e.code para ser agnóstico al layout.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey) return true
      if (e.code === 'KeyC') {
        const sel = term?.getSelection()
        if (sel) navigator.clipboard?.writeText(sel)
        return false
      }
      if (e.code === 'KeyV') {
        navigator.clipboard?.readText().then((t) => t && term?.paste(t))
        return false
      }
      return true
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
  return { fit }
}
