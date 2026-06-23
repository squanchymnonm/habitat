import { useSessions } from '../stores/sessions'
import type { ServerMessage, ClientMessage } from '../types'
import { applyServerSettings } from './useSettings'
import { applyServerProjects } from './useProjects'

// Socket único a nivel de app. Bidireccional: recibe estado y permite enviar (chat, fase 2).
let ws: WebSocket | null = null
let started = false

function connect() {
  const store = useSessions()
  const token = new URLSearchParams(location.search).get('token') ?? ''
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/ws${token ? '?token=' + encodeURIComponent(token) : ''}`)
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data) as ServerMessage
    if (msg.type === 'snapshot') store.setAll(msg.sessions)
    else if (msg.type === 'session') store.upsert(msg.session)
    else if (msg.type === 'remove') store.remove(msg.id)
    else if (msg.type === 'fightResult') store.fight(msg.id, msg.result)
    else if (msg.type === 'settings') applyServerSettings(msg.settings)
    else if (msg.type === 'projects') applyServerProjects(msg.projects)
  }
  ws.onclose = () => setTimeout(connect, 1500) // reconexión
}

export function send(msg: ClientMessage) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

export function startSocket() {
  if (started) return
  started = true
  connect()
}
