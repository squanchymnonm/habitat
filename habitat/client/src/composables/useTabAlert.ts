import { watch } from 'vue'
import { useSessions } from '../stores/sessions'
import { newlyWaiting } from './tabAlert'

const BASE_TITLE = 'Hábitat · El Mono'
const ICON_HREF = '/assets/char/Monkey/face.png'
const SIZE = 64

// --- favicon: dibuja el rostro del Monkey en un canvas y, si hay alerta,
// le pinta un badge rojo (con número si needCount > 1). Setea el <link> via dataURL.
let iconImg: HTMLImageElement | null = null
let iconReady = false

function ensureIconLink(): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  return link
}

function drawFavicon(needCount: number) {
  if (!iconReady || !iconImg) return
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingEnabled = false // mantener pixel-art nítido
  ctx.clearRect(0, 0, SIZE, SIZE)
  ctx.drawImage(iconImg, 0, 0, SIZE, SIZE)

  if (needCount > 0) {
    const r = SIZE * 0.28
    const cx = SIZE - r - 2
    const cy = SIZE - r - 2
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = '#e03b3b'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#2a1c0a'
    ctx.stroke()
    if (needCount > 1) {
      ctx.fillStyle = '#fff'
      ctx.font = `bold ${Math.round(r * 1.2)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(needCount > 9 ? '9+' : needCount), cx, cy + 1)
    }
  }
  ensureIconLink().href = canvas.toDataURL('image/png')
}

// --- sonido: chime corto de dos notas con WebAudio (sin asset). ---
let audioCtx: AudioContext | null = null
function playChime() {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    if (!audioCtx) audioCtx = new Ctor()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    const now = audioCtx.currentTime
    const notes = [660, 880]
    notes.forEach((freq, i) => {
      const t = now + i * 0.13
      const osc = audioCtx!.createOscillator()
      const gain = audioCtx!.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.2, t + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
      osc.connect(gain).connect(audioCtx!.destination)
      osc.start(t)
      osc.stop(t + 0.13)
    })
  } catch {
    /* sin sonido si el navegador lo bloquea */
  }
}

// --- notificación del navegador (solo en background). ---
function notify(names: string[]) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const body =
    names.length === 1
      ? `La sesión «${names[0]}» te necesita`
      : `«${names[0]}» y ${names.length - 1} más te necesitan`
  try {
    new Notification('El Mono · Hábitat', { body, icon: ICON_HREF })
  } catch {
    /* algunos navegadores requieren ServiceWorker; se omite */
  }
}

export function useTabAlert(): void {
  const store = useSessions()

  // pedir permiso una vez (si el navegador lo soporta y está en 'default')
  if ('Notification' in window && Notification.permission === 'default') {
    void Notification.requestPermission()
  }

  // cargar el sprite del Monkey y dibujar el favicon inicial
  iconImg = new Image()
  iconImg.onload = () => {
    iconReady = true
    drawFavicon(store.needCount)
  }
  iconImg.src = ICON_HREF

  // título + favicon reflejan el estado actual (siempre)
  watch(
    () => store.needCount,
    (n) => {
      document.title = n > 0 ? `(${n}) ${BASE_TITLE}` : BASE_TITLE
      drawFavicon(n)
    },
    { immediate: true },
  )

  // transición a waiting → notif + sonido (solo en background)
  let prevWaiting = new Set(store.list.filter((s) => s.status === 'waiting').map((s) => s.id))
  watch(
    () => store.list.map((s) => `${s.id}:${s.status}`).join('|'),
    () => {
      const current = new Set(store.list.filter((s) => s.status === 'waiting').map((s) => s.id))
      const fresh = newlyWaiting(prevWaiting, current)
      prevWaiting = current
      if (fresh.length && document.hidden) {
        const names = fresh.map((id) => store.list.find((s) => s.id === id)?.name ?? id)
        notify(names)
        playChime()
      }
    },
  )
}
