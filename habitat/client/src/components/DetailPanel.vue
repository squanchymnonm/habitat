<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import QuestBook from './QuestBook.vue'
import FileBrowser from './FileBrowser.vue'
import { quotePath } from '../composables/useFiles'
import { useSessions } from '../stores/sessions'
import { STATUS_LABEL, type FightResult } from '../types'
import { faceFor, ago, fmt } from '../sprites'
import { useTerminal } from '../composables/useTerminal'
import { useProjects } from '../composables/useProjects'

const store = useSessions()
const { canSpawn, kill, colorForProject } = useProjects()
const selectedId = computed(() => store.selected?.id ?? null)
const termEl = ref<HTMLElement | null>(null)
const { fit, insert } = useTerminal(termEl, selectedId)
const headTint = computed(() => {
  const c = store.selected ? colorForProject(store.selected.project) : ''
  return c ? { background: `color-mix(in srgb, ${c} 14%, var(--surface))` } : {}
})

function closeSession() {
  const s = store.selected
  if (!s) return
  if (confirm(`¿Cerrar la sesión "${s.name}"? Se perderá el trabajo en curso.`)) kill(s.id)
}

const bookOpen = ref(false)
watch(selectedId, () => { bookOpen.value = false }) // cerrar el libro al cambiar de sesión
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { bookOpen.value = false; filesOpen.value = false } }
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
      <div ref="termEl" class="term" aria-label="terminal de la sesión"></div>
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
</style>
