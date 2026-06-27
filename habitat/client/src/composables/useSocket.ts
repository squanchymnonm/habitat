import { useSessions } from '../stores/sessions'
import type { ServerMessage, ClientMessage } from '../types'
import { applyServerSettings } from './useSettings'
import { applyServerProjects } from './useProjects'
import { useAuth } from './useAuth'
import { setUsage } from './useUsage'

// Socket único a nivel de app. Bidireccional: recibe estado y permite enviar (chat, fase 2).
let ws: WebSocket | null = null
let started = false

/**
 * Procesa el cierre del WebSocket. Devuelve `true` cuando el caller debe
 * reconectar, `false` cuando no debe (sesión expirada → volver al login).
 * Efecto secundario en code===1008: marca authed=false y resetea `started`
 * para que un re-login posterior re-arme el socket.
 */
export function onSocketClose(code: number): boolean {
  if (code === 1008) {
    const { authed } = useAuth()
    authed.value = false
    started = false
    return false
  }
  return true
}

function connect() {
  const store = useSessions()
  const token = new URLSearchParams(location.search).get('token') ?? ''
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/ws${token ? '?token=' + encodeURIComponent(token) : ''}`)
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data) as ServerMessage
    if (msg.type === 'snapshot') { store.setAll(msg.sessions); setUsage(msg.usage ?? null) }
    else if (msg.type === 'usage') setUsage(msg.usage)
    else if (msg.type === 'session') store.upsert(msg.session)
    else if (msg.type === 'remove') store.remove(msg.id)
    else if (msg.type === 'rekey') store.rekey(msg.from, msg.to, msg.session)
    else if (msg.type === 'fightResult') store.fight(msg.id, msg.result)
    else if (msg.type === 'settings') applyServerSettings(msg.settings)
    else if (msg.type === 'projects') applyServerProjects(msg.projects)
    else if (msg.type === 'reorder') store.reorder(msg.order)
  }
  ws.onclose = (ev) => { if (onSocketClose(ev.code)) setTimeout(connect, 1500) }
}

export function send(msg: ClientMessage) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

export function startSocket() {
  if (started) return
  started = true
  connect()
}
