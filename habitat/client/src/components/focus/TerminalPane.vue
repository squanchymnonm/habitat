<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useTerminal, canReadClipboard } from '../../composables/useTerminal'
import { useTermKeys } from '../../composables/useTermKeys'
import { useZoom } from '../../composables/useZoom'
import { createLongPress } from '../../composables/longPress'
import TermKeys from '../TermKeys.vue'
import type { Session } from '../../types'
import { cn } from '@/lib/utils'

const props = defineProps<{ session: Session }>()

const root = ref<HTMLElement | null>(null)
const termEl = ref<HTMLElement | null>(null)
const sessionId = computed(() => props.session.id)
const { fit, insert, getSelection, copySelection, pasteClipboard, copyVisible, selectMode, sendKey } =
  useTerminal(termEl, sessionId, { onCopied: flashCopied })
const { enabled: termKeysEnabled } = useTermKeys()
// En contexto inseguro (HTTP/LAN) no se puede leer el portapapeles desde un click:
// "Pegar" se deshabilita y el usuario pega con Ctrl+V (evento nativo).
const canPaste = canReadClipboard()

// Toast efímero "copiado".
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
function flashCopied() {
  copied.value = true
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = false), 1500)
}
function onCopyVisible() { if (copyVisible()) flashCopied() }

// Menú contextual (copiar / pegar). El navegador reserva Ctrl+Shift+C para DevTools,
// así que el click derecho es la vía explícita de copiar/pegar.
const menu = ref<{ x: number; y: number; hasSel: boolean } | null>(null)
function openMenu(p: { clientX: number; clientY: number }) {
  menu.value = { x: p.clientX, y: p.clientY, hasSel: !!getSelection() }
}
function menuCopy() { copySelection(); menu.value = null }
function menuPaste() { pasteClipboard(); menu.value = null }

// En touch no hay click derecho: un long-press sobre la terminal abre el mismo menú.
const lp = createLongPress((x, y) => openMenu({ clientX: x, clientY: y }))
function onTouchStart(e: TouchEvent) {
  if (selectMode.value) return // en modo selección el gesto es para seleccionar
  const t = e.touches[0]
  if (t) lp.start(t.clientX, t.clientY)
}
function onTouchMove(e: TouchEvent) {
  if (selectMode.value) return
  const t = e.touches[0]
  if (t) lp.move(t.clientX, t.clientY)
}
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') menu.value = null }

// fit() en cada cambio de tamaño: splitter, pestaña, rotación, colapso de la barra.
// Cambiar el zoom del root no dispara resize: re-fitear a mano.
const refit = () => nextTick(() => requestAnimationFrame(() => fit()))
const { zoom } = useZoom()
watch(zoom, refit)
let ro: ResizeObserver | null = null
onMounted(() => {
  document.addEventListener('keydown', onKey)
  if (typeof ResizeObserver !== 'undefined' && root.value) { ro = new ResizeObserver(refit); ro.observe(root.value) }
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKey)
  ro?.disconnect()
  if (copiedTimer) clearTimeout(copiedTimer)
})

// min-h-10: objetivo táctil ≥40px (spec §5).
const barBtn = 'min-h-10 shrink-0 cursor-pointer whitespace-nowrap rounded-[var(--radius)] border-0 bg-surface-raised px-2 py-1 font-mono text-[11px] text-text hover:text-accent'
defineExpose({ fit, insert })
</script>

<template>
  <div ref="root" class="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[calc(var(--radius)+4px)] border border-border bg-terminal-bg">
    <div class="flex shrink-0 flex-nowrap items-center gap-2.5 border-b border-border bg-surface px-3 py-1.5">
      <span data-test="term-title" class="min-w-0 flex-[0_1_auto] truncate font-mono text-xs text-muted">
        <b class="text-text">{{ session.project }}</b><template v-if="session.branch"> · {{ session.branch }}</template> · tmux
      </span>
      <TermKeys v-if="termKeysEnabled" dense @press="sendKey" />
      <button data-test="term-select" type="button" :class="cn(barBtn, 'ml-auto', selectMode && 'text-accent ring-1 ring-accent')"
        title="Arrastrá con el dedo para seleccionar y copiar" @click="selectMode = !selectMode">
        {{ selectMode ? '✓ seleccionar' : 'seleccionar' }}
      </button>
      <button data-test="term-copy-visible" type="button" :class="barBtn" title="Copiar todo lo visible" @click="onCopyVisible">copiar visible</button>
      <span class="hidden shrink-0 items-center gap-1.5 text-[11px] uppercase tracking-wider text-state-working sm:inline-flex">
        <i class="size-1.5 rounded-full bg-state-working motion-safe:animate-pulse" /> en vivo
      </span>
    </div>
    <div
      ref="termEl"
      data-test="term-body"
      :class="cn('min-h-0 flex-1 touch-none overflow-hidden bg-terminal-bg', selectMode && 'cursor-crosshair')"
      aria-label="terminal de la sesión"
      @contextmenu.prevent="openMenu"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="lp.cancel()"
      @touchcancel="lp.cancel()"
    />
    <div data-test="term-copied"
      :class="cn('pointer-events-none absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-[var(--radius)] border border-accent bg-surface-raised px-3 py-1.5 font-mono text-xs text-accent transition-opacity', copied ? 'opacity-100' : 'opacity-0')">
      copiado ✓
    </div>
    <template v-if="menu">
      <div class="fixed inset-0 z-40" @click="menu = null" @contextmenu.prevent="menu = null" />
      <!-- data-term-menu: useFocusShortcuts no actúa con Esc mientras este menú está abierto. -->
      <div data-term-menu data-test="term-menu" class="fixed z-41 flex min-w-36 flex-col rounded-[var(--radius)] border border-border bg-surface-raised p-1 shadow-lg" :style="{ left: menu.x + 'px', top: menu.y + 'px' }">
        <button data-test="ctx-copy" type="button" :disabled="!menu.hasSel" @click="menuCopy"
          class="flex min-h-10 cursor-pointer items-center justify-between gap-4 rounded border-0 bg-transparent px-2.5 py-1.5 text-left font-mono text-xs text-text hover:bg-surface hover:text-accent disabled:cursor-default disabled:opacity-40">
          Copiar <span class="text-[11px] opacity-50">⌃C</span>
        </button>
        <button data-test="ctx-paste" type="button" :disabled="!canPaste" :title="canPaste ? '' : 'Pegá con Ctrl+V'" @click="menuPaste"
          class="flex min-h-10 cursor-pointer items-center justify-between gap-4 rounded border-0 bg-transparent px-2.5 py-1.5 text-left font-mono text-xs text-text hover:bg-surface hover:text-accent disabled:cursor-default disabled:opacity-40">
          Pegar <span class="text-[11px] opacity-50">⌃V</span>
        </button>
      </div>
    </template>
  </div>
</template>
