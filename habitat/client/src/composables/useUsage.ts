import { ref, computed } from 'vue'
import type { Usage } from '../types'

export const WINDOW_MS = 18_000_000 // 5h

const usage = ref<Usage | null>(null)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

export function manaFromUsage(u: Usage | null): number | null {
  return u ? Math.max(0, Math.min(100, Math.round(100 - u.pct))) : null
}
export function cyclePosFrom(u: Usage | null, nowMs: number): number | null {
  if (!u) return null
  const left = u.resetAt * 1000 - nowMs
  return Math.max(0, Math.min(1, 1 - left / WINDOW_MS))
}
export function fmtReset(ms: number | null): string {
  if (ms == null) return ''
  const total = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(total / 60), m = total % 60
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

export function setUsage(u: Usage | null) { usage.value = u }

export function useUsage() {
  if (!timer && typeof setInterval !== 'undefined') {
    timer = setInterval(() => { now.value = Date.now() }, 30_000)
  }
  const mana = computed(() => manaFromUsage(usage.value))
  const msToReset = computed(() => (usage.value ? usage.value.resetAt * 1000 - now.value : null))
  const cyclePos = computed(() => cyclePosFrom(usage.value, now.value))
  const resetLabel = computed(() => fmtReset(msToReset.value))
  return { usage, mana, msToReset, cyclePos, resetLabel, setUsage }
}
