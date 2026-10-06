<script setup lang="ts">
import { ref, watch } from 'vue'
import { Folder, FileText, Upload, SquarePen, TerminalSquare } from 'lucide-vue-next'
import { useProjectTree, type TreeEntry, type FileContent } from '../../composables/useProjectTree'
import { useFiles, limitMB, quotePath, type TooLarge } from '../../composables/useFiles'
import { fmt } from '../../sprites'
import { cn } from '@/lib/utils'

// Explorador del working dir de la sesión: navegar, previsualizar, insertar la ruta
// en la terminal, editar en nvim y subir archivos. La carpeta actual la maneja el
// padre (compartida con Git).
const props = defineProps<{ sessionId: string; path: string }>()
const emit = defineEmits<{ (e: 'navigate', rel: string): void; (e: 'insert', text: string): void; (e: 'opened'): void }>()

const { listing, loading, error, loadTree, loadFile, openInNvim } = useProjectTree()
const { upload } = useFiles()
const preview = ref<{ path: string; content: FileContent } | null>(null)
const busy = ref('')
const actionErr = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

watch(() => [props.sessionId, props.path] as const, ([id, path]) => {
  if (id) { preview.value = null; loadTree(id, path) }
}, { immediate: true })

function openEntry(e: TreeEntry) {
  if (e.isDir) emit('navigate', e.rel)
  else showPreview(e.rel)
}
async function showPreview(rel: string) {
  actionErr.value = ''
  try { preview.value = { path: rel, content: await loadFile(props.sessionId, rel) } }
  catch { actionErr.value = 'no se pudo leer el archivo' }
}
async function editInNvim(rel: string) {
  busy.value = rel; actionErr.value = ''
  const r = await openInNvim(props.sessionId, rel)
  busy.value = ''
  if (r.ok) emit('opened')
  else actionErr.value = r.message || 'no se pudo abrir nvim'
}
function insertPath(rel: string) { emit('insert', quotePath(rel) + ' ') }

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // permitir re-subir el mismo archivo
  if (!file) return
  actionErr.value = ''
  uploading.value = true
  try { await doUpload(file) }
  catch (err) { actionErr.value = err instanceof Error ? err.message : 'falló la subida' }
  finally { uploading.value = false }
}
// Ante 413 pide la contraseña y reintenta una vez, sólo si el server tiene una
// configurada: si no, pedirla mandaría a un reintento que falla igual.
async function doUpload(file: File) {
  try {
    insertPath((await upload(props.sessionId, file)).rel)
  } catch (err) {
    const tl = err as TooLarge | undefined
    if (!tl?.tooLarge) throw err
    if (!tl.needsPassword) { actionErr.value = `"${file.name}" supera el límite de ${limitMB(tl.max)}`; return }
    const pw = window.prompt(`"${file.name}" supera los ${limitMB(tl.max)}. Contraseña para subirlo igual:`)
    if (!pw) { actionErr.value = 'subida cancelada'; return }
    insertPath((await upload(props.sessionId, file, pw)).rel)
  }
}

// min-h-10: objetivo táctil ≥40px (spec §5).
const crumb = 'inline-flex min-h-10 items-center cursor-pointer rounded border-0 bg-transparent px-1 font-mono text-xs text-muted hover:text-accent'
const act = 'inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-[var(--radius)] border-0 bg-surface-raised px-2.5 py-1 font-[inherit] text-xs text-text hover:text-accent disabled:opacity-50'
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2 p-3">
    <div class="flex items-center gap-2">
      <nav class="flex min-w-0 flex-1 flex-wrap items-center">
        <button data-test="file-crumb" type="button" :class="crumb" @click="emit('navigate', '')">{{ listing?.root || '~' }}</button>
        <template v-for="c in listing?.breadcrumbs || []" :key="c.rel">
          <span class="text-xs text-muted">/</span>
          <button type="button" :class="crumb" @click="emit('navigate', c.rel)">{{ c.name }}</button>
        </template>
      </nav>
      <button data-test="file-upload" type="button" :class="act" :disabled="uploading" @click="fileInput?.click()">
        <Upload class="size-3.5" />{{ uploading ? 'Subiendo…' : 'Subir' }}
      </button>
      <input ref="fileInput" data-test="file-upload-input" type="file" hidden @change="onFile" />
    </div>
    <p v-if="actionErr" class="m-0 text-sm text-danger">{{ actionErr }}</p>
    <!-- En el teléfono (una columna) con preview: dos filas acotadas, cada una con su
         scroll; si no, un listado largo empuja Insertar/Editar fuera de la pantalla. -->
    <div data-test="file-grid" :class="cn('grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(12rem,1fr)_2fr]',
      preview && 'grid-rows-[minmax(0,1fr)_minmax(0,1fr)] md:grid-rows-1')">
      <ul class="m-0 min-h-0 list-none overflow-y-auto p-0">
        <li v-if="loading" class="px-2 py-1 text-sm text-muted">cargando…</li>
        <li v-else-if="error === 'sin-dir'" class="px-2 py-1 text-sm text-muted">sesión sin working dir</li>
        <li v-else-if="error" class="px-2 py-1 text-sm text-muted">no se pudo listar ({{ error }})</li>
        <li v-for="e in listing?.entries || []" :key="e.rel">
          <button data-test="file-entry" type="button" :data-dir="e.isDir ? '' : undefined" @click="openEntry(e)" @dblclick="!e.isDir && editInNvim(e.rel)"
            class="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-[var(--radius)] border-0 bg-transparent px-2 py-1 text-left font-[inherit] text-sm text-text hover:bg-surface-raised">
            <Folder v-if="e.isDir" class="size-4 shrink-0 text-accent" /><FileText v-else class="size-4 shrink-0 text-muted" />
            <span class="min-w-0 flex-1 truncate">{{ e.name }}</span>
            <span v-if="e.isRepo" class="rounded bg-surface-raised px-1.5 text-[10px] uppercase text-muted">git</span>
            <span v-else-if="!e.isDir" class="text-xs tabular-nums text-muted">{{ fmt(e.size) }}</span>
          </button>
        </li>
        <li v-if="!loading && !error && !(listing?.entries || []).length" class="px-2 py-1 text-sm text-muted">Carpeta vacía</li>
      </ul>
      <section v-if="preview" data-test="file-preview" class="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius)] border border-border">
        <header class="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-2 py-1.5">
          <b class="min-w-0 flex-1 truncate font-mono text-xs text-text">{{ preview.path }}</b>
          <button data-test="file-insert" type="button" :class="act" @click="insertPath(preview.path)"><TerminalSquare class="size-3.5" />Insertar en la terminal</button>
          <button data-test="file-edit" type="button" :class="act" :disabled="busy === preview.path" @click="editInNvim(preview.path)"><SquarePen class="size-3.5" />Editar en nvim</button>
        </header>
        <pre v-if="'text' in preview.content" class="m-0 min-h-0 flex-1 overflow-auto bg-terminal-bg p-3 font-mono text-xs text-terminal-fg">{{ preview.content.text }}</pre>
        <p v-else-if="'binary' in preview.content" class="m-0 p-3 text-sm text-muted">archivo binario ({{ preview.content.size }} bytes)</p>
        <p v-else class="m-0 p-3 text-sm text-muted">archivo muy grande ({{ preview.content.size }} bytes): abrilo en nvim.</p>
      </section>
      <p v-else class="m-0 hidden p-3 text-sm text-muted md:block">Elegí un archivo para previsualizarlo. Doble click o "Editar en nvim" para editarlo.</p>
    </div>
  </div>
</template>
