<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import QuestBook from './QuestBook.vue'
import FileBrowser from './FileBrowser.vue'
import { quotePath } from '../composables/useFiles'
import { useSessions } from '../stores/sessions'
import { STATUS_LABEL, type FightResult } from '../types'
import { faceFor, ago, fmt } from '../sprites'
import { useTerminal, canReadClipboard } from '../composables/useTerminal'
import { useProjects } from '../composables/useProjects'

const store = useSessions()
const { canSpawn, kill, colorForProject } = useProjects()
const selectedId = computed(() => store.selected?.id ?? null)
const termEl = ref<HTMLElement | null>(null)
const { fit, insert, getSelection, copySelection, pasteClipboard } = useTerminal(termEl, selectedId)
// En contexto inseguro (HTTP/LAN) no se puede leer el portapapeles desde un click:
// el botón "Pegar" se deshabilita y el usuario pega con Ctrl+V (evento nativo).
const canPaste = canReadClipboard()
const headTint = computed(() => {
  const c = store.selected ? colorForProject(store.selected.project) : ''
  return c ? { background: `color-mix(in srgb, ${c} 14%, var(--surface))` } : {}
})

function closeSession() {
  const s = store.selected
  if (!s) return
  if (confirm(`¿Cerrar la sesión "${s.name}"? Se perderá el trabajo en curso.`)) kill(s.id)
}

// Menú contextual de la terminal (copiar / pegar). El navegador reserva Ctrl+Shift+C
// para DevTools, así que el click derecho es la vía explícita de copiar/pegar.
const menu = ref<{ x: number; y: number; hasSel: boolean } | null>(null)
function openMenu(e: MouseEvent) {
  menu.value = { x: e.clientX, y: e.clientY, hasSel: !!getSelection() }
}
function menuCopy() { copySelection(); menu.value = null }
function menuPaste() { pasteClipboard(); menu.value = null }

const bookOpen = ref(false)
watch(selectedId, () => { bookOpen.value = false }) // cerrar el libro al cambiar de sesión
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { bookOpen.value = false; filesOpen.value = false; menu.value = null } }
onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => document.removeEventListener('keydown', onKey))

const filesOpen = ref(false)
watch(selectedId, () => { filesOpen.value = false }) // cerrar al cambiar de sesión
function onPickFile(rel: string) {
  insert(quotePath(rel) + ' ') // escribir el path (con espacio final) en la terminal
  filesOpen.value = false
}

// Overlay de loot al vencer — solo para la sesión enfocada.
const lootShown = ref(false)
const loot = ref<FightResult | null>(null)
watch(
  () => store.lastFight,
  (lf) => {
    if (lf && lf.id === store.selected?.id) {
      loot.value = lf.result
      lootShown.value = true
      setTimeout(() => (lootShown.value = false), 2600)
    }
  },
)

defineExpose({ fit })
</script>

<template>
  <div class="dpanel">
    <template v-if="store.selected">
      <div class="dhead crt" :style="headTint">
        <img class="face" :src="faceFor(store.selected.name, store.selected.char)" alt="" />
        <div class="dinfo">
          <div class="dname">
            {{ store.selected.name }}
            <span class="chip" :class="store.selected.status">{{ STATUS_LABEL[store.selected.status] }}</span>
          </div>
          <div class="repo">{{ store.selected.project }} <span class="br" v-if="store.selected.branch">⌥ {{ store.selected.branch }}</span></div>
          <div class="action">{{ store.selected.action }}</div>
          <div class="since">ACTIVA HACE {{ ago(store.selected.since) }}</div>
        </div>
        <button class="bookbtn" @click="filesOpen = !filesOpen" aria-label="archivos" title="Archivos">
          📁
        </button>
        <button class="bookbtn" @click="bookOpen = !bookOpen" aria-label="quest book" title="Quest Book">
          <img src="/assets/ui/book.png" alt="" />
        </button>
        <button v-if="canSpawn" class="killsession" @click="closeSession">✕ CERRAR</button>
      </div>
      <div ref="termEl" class="term" aria-label="terminal de la sesión" @contextmenu.prevent="openMenu"></div>
      <template v-if="menu">
        <div class="menu-backdrop" @click="menu = null" @contextmenu.prevent="menu = null"></div>
        <div class="ctxmenu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }">
          <button :disabled="!menu.hasSel" @click="menuCopy">Copiar <span class="sc">⌃C</span></button>
          <button :disabled="!canPaste" :title="canPaste ? '' : 'Pegá con Ctrl+V'" @click="menuPaste">
            Pegar <span class="sc">⌃V</span>
          </button>
        </div>
      </template>
      <QuestBook v-if="bookOpen" :id="store.selected.id" @close="bookOpen = false" />
      <FileBrowser v-if="filesOpen" :id="store.selected.id" @close="filesOpen = false" @pick="onPickFile" />
      <div class="dloot" :class="{ show: lootShown }" v-if="loot">
        <div class="ttl">★ VENCIDO ★</div>
        <div class="mn">{{ loot.monster }}</div>
        <div class="stat">HP <b>{{ fmt(loot.hp) }}</b> · {{ loot.hits }} golpes</div>
        <div class="lootline">LOOT: <span>{{ loot.loot.join(', ') }}</span></div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dpanel { position: relative; }
.bookbtn { align-self: flex-start; background: #2a1d0e; border: 1px solid #c8a860; border-radius: 6px; padding: 4px 8px; cursor: pointer; }
.bookbtn img { display: block; width: 18px; height: 18px; image-rendering: pixelated; }
.bookbtn:hover { background: #3a2a14; }
.killsession {
  align-self: flex-start; background: #5a1f1f; border: 1px solid #a44; color: #f9c;
  font-family: var(--f-ui); font-size: 11px; padding: 6px 10px; border-radius: 6px; cursor: pointer; white-space: nowrap;
}
.killsession:hover { background: #7a2a2a; }
.menu-backdrop { position: fixed; inset: 0; z-index: 40; }
.ctxmenu {
  position: fixed; z-index: 41; min-width: 120px; display: flex; flex-direction: column;
  background: #2a1d0e; border: 1px solid #c8a860; border-radius: 6px; padding: 4px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
}
.ctxmenu button {
  background: transparent; border: 0; color: #f0d9a8; font-family: var(--f-ui); font-size: 12px;
  text-align: left; padding: 6px 10px; border-radius: 4px; cursor: pointer;
}
.ctxmenu button:hover:not(:disabled) { background: #3a2a14; }
.ctxmenu button:disabled { opacity: 0.4; cursor: default; }
.ctxmenu button { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.ctxmenu .sc { opacity: 0.5; font-size: 11px; }
</style>
