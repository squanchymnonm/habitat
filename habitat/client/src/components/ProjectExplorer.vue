<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useProjectTree, type TreeEntry, type FileContent } from '../composables/useProjectTree'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'opened'): void }>()

const { listing, loading, error, loadTree, loadFile, openInNvim } = useProjectTree()
const cwd = ref('')
const preview = ref<{ path: string; content: FileContent } | null>(null)
const busy = ref('')
const actionErr = ref('')

watch(() => props.id, (id) => { if (id) { cwd.value = ''; preview.value = null; loadTree(id) } }, { immediate: true })

function openEntry(e: TreeEntry) {
  if (e.isDir) { cwd.value = e.rel; preview.value = null; loadTree(props.id, e.rel) }
  else showPreview(e.rel)
}
async function showPreview(rel: string) {
  actionErr.value = ''
  try { preview.value = { path: rel, content: await loadFile(props.id, rel) } }
  catch { actionErr.value = 'no se pudo leer el archivo' }
}
async function editInNvim(rel: string) {
  busy.value = rel; actionErr.value = ''
  const r = await openInNvim(props.id, rel)
  busy.value = ''
  if (r.ok) emit('opened')
  else actionErr.value = r.message || 'no se pudo abrir nvim'
}
function goCrumb(rel: string) { cwd.value = rel; preview.value = null; loadTree(props.id, rel) }
function goRoot() { cwd.value = ''; preview.value = null; loadTree(props.id, '') }

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { if (preview.value) preview.value = null; else emit('close') } }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="pe-overlay">
    <header class="pe-head">
      <span class="pe-title">🗂 Proyecto</span>
      <nav class="pe-crumbs">
        <button class="pe-crumb" @click="goRoot">{{ listing?.root || '~' }}</button>
        <template v-for="c in listing?.breadcrumbs || []" :key="c.rel">
          <span class="pe-sep">/</span>
          <button class="pe-crumb" @click="goCrumb(c.rel)">{{ c.name }}</button>
        </template>
      </nav>
      <button class="pe-x" @click="emit('close')" title="Cerrar">✕</button>
    </header>

    <p v-if="actionErr" class="pe-err">{{ actionErr }}</p>

    <div class="pe-body">
      <ul class="pe-list">
        <li v-if="loading" class="pe-muted">cargando…</li>
        <li v-else-if="error === 'sin-dir'" class="pe-muted">sesión sin working dir</li>
        <li v-else-if="error" class="pe-muted">no se pudo listar ({{ error }})</li>
        <li v-for="e in listing?.entries || []" :key="e.rel"
            @click="openEntry(e)" @dblclick="!e.isDir && editInNvim(e.rel)">
          <span class="ico">{{ e.isDir ? '📁' : '📄' }}</span>
          <span class="nm">{{ e.name }}</span>
        </li>
      </ul>

      <div class="pe-preview" v-if="preview">
        <header>
          <b>{{ preview.path }}</b>
          <button class="pe-edit" :disabled="busy === preview.path" @click="editInNvim(preview.path)">✎ editar en nvim</button>
        </header>
        <pre v-if="'text' in preview.content" class="pe-code">{{ preview.content.text }}</pre>
        <p v-else-if="'binary' in preview.content" class="pe-muted">archivo binario ({{ preview.content.size }} bytes)</p>
        <p v-else class="pe-muted">archivo muy grande ({{ preview.content.size }} bytes) — <button class="pe-edit" @click="editInNvim(preview.path)">abrir en nvim</button></p>
      </div>
      <div class="pe-preview pe-empty" v-else><p class="pe-muted">Elegí un archivo para previsualizar. Doble-click o "editar en nvim" para editarlo.</p></div>
    </div>
  </div>
</template>

<style scoped>
.pe-overlay { position: absolute; inset: 0; background: var(--color-base, #1a1410); color: var(--color-ink, #e8dcc0); display: flex; flex-direction: column; z-index: 5; }
.pe-head { display: flex; align-items: center; gap: .6rem; padding: .5rem .75rem; border-bottom: 1px solid var(--color-line, #3a2e22); }
.pe-title { font-weight: 700; }
.pe-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; flex: 1; overflow: hidden; }
.pe-crumb { background: none; border: none; color: var(--color-brass, #c79a4b); cursor: pointer; font-family: ui-monospace, monospace; }
.pe-sep { color: var(--color-line, #3a2e22); }
.pe-x { cursor: pointer; background: var(--color-raise, #2a2018); color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); padding: .15rem .5rem; }
.pe-err { color: #d2553f; padding: 0 .75rem; font-size: .82rem; }
.pe-body { flex: 1; display: flex; min-height: 0; }
.pe-list { list-style: none; margin: 0; padding: .3rem 0; overflow: auto; width: 38%; border-right: 1px solid var(--color-line, #3a2e22); }
.pe-list li { display: flex; align-items: center; gap: .5rem; padding: .2rem .7rem; cursor: pointer; font-family: ui-monospace, monospace; font-size: .85rem; }
.pe-list li:hover { background: rgba(255,255,255,.05); }
.pe-list .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pe-preview { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.pe-preview header { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding: .4rem .7rem; border-bottom: 1px solid var(--color-line, #3a2e22); }
.pe-edit { cursor: pointer; background: var(--color-brass, #c79a4b); color: #1a1410; border: none; border-radius: var(--radius-sm, 4px); padding: .25rem .6rem; font-weight: 700; }
.pe-edit:disabled { opacity: .5; cursor: default; }
.pe-code { flex: 1; overflow: auto; margin: 0; padding: .6rem .7rem; font-family: ui-monospace, monospace; font-size: .8rem; white-space: pre; }
.pe-muted { opacity: .65; padding: .7rem; font-size: .85rem; }
.pe-empty { align-items: center; justify-content: center; }

@media (max-width: 640px) {
  .pe-body { flex-direction: column; }
  .pe-list { width: auto; border-right: none; border-bottom: 1px solid var(--color-line, #3a2e22); max-height: 40%; }
}
</style>
