<script setup lang="ts">
import { ref, watch } from 'vue'
import { useFiles, type FileEntry } from '../composables/useFiles'
import { fmt } from '../sprites'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'pick', rel: string): void }>()

const { listing, loading, error, list, upload } = useFiles()
const cwd = ref('') // rel actual dentro del working dir
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadErr = ref('')

watch(() => props.id, (id) => { if (id) { cwd.value = ''; list(id) } }, { immediate: true })

function open(entry: FileEntry) {
  if (entry.isDir) { cwd.value = entry.rel; list(props.id, entry.rel) }
  else emit('pick', entry.rel)
}
function goCrumb(rel: string) { cwd.value = rel; list(props.id, rel) }
function goRoot() { cwd.value = ''; list(props.id, '') }

function triggerUpload() { fileInput.value?.click() }

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // permitir re-subir el mismo archivo
  if (!file) return
  uploadErr.value = ''
  uploading.value = true
  try {
    await doUpload(file)
  } catch (err) {
    uploadErr.value = err instanceof Error ? err.message : 'falló la subida'
  } finally {
    uploading.value = false
  }
}

// Sube; si el server pide password (413), la pide y reintenta una vez.
async function doUpload(file: File) {
  try {
    const { rel } = await upload(props.id, file)
    afterUpload(rel)
  } catch (err) {
    if (err && (err as { tooLarge?: boolean }).tooLarge) {
      const pw = window.prompt(`"${file.name}" supera el límite. Contraseña para subirlo igual:`)
      if (!pw) { uploadErr.value = 'subida cancelada'; return }
      const { rel } = await upload(props.id, file, pw)
      afterUpload(rel)
    } else {
      throw err
    }
  }
}

function afterUpload(rel: string) {
  emit('pick', rel) // insertar en la terminal (el padre cierra el browser al recibir pick)
}
</script>

<template>
  <div class="fb-overlay" @click.self="emit('close')">
    <div class="fb-panel" role="dialog" aria-label="Archivos">
      <button class="fb-close" @click="emit('close')" aria-label="cerrar">✕</button>
      <header class="fb-head">
        <div class="fb-kicker">Archivos</div>
        <nav class="fb-crumbs">
          <button class="fb-crumb" @click="goRoot">{{ listing?.root || '~' }}</button>
          <template v-for="c in listing?.breadcrumbs || []" :key="c.rel">
            <span class="fb-sep">/</span>
            <button class="fb-crumb" @click="goCrumb(c.rel)">{{ c.name }}</button>
          </template>
        </nav>
      </header>

      <div v-if="loading" class="fb-state">Cargando…</div>
      <div v-else-if="error === 'sin-dir'" class="fb-state">Este pod no tiene un directorio asociado.</div>
      <div v-else-if="error" class="fb-state">No se pudo listar ({{ error }})</div>
      <ul v-else class="fb-list">
        <li v-for="entry in listing?.entries || []" :key="entry.rel">
          <button class="fb-item" @click="open(entry)">
            <span class="fb-ico">{{ entry.isDir ? '📁' : '📄' }}</span>
            <span class="fb-name">{{ entry.name }}</span>
            <span v-if="!entry.isDir" class="fb-size">{{ fmt(entry.size) }}</span>
          </button>
        </li>
        <li v-if="(listing?.entries || []).length === 0" class="fb-empty">Carpeta vacía</li>
      </ul>

      <footer class="fb-foot">
        <button class="fb-upload" :disabled="uploading" @click="triggerUpload">
          {{ uploading ? 'Subiendo…' : '⬆ Subir archivo' }}
        </button>
        <span v-if="uploadErr" class="fb-uperr">{{ uploadErr }}</span>
        <input ref="fileInput" type="file" hidden @change="onFile" />
      </footer>
    </div>
  </div>
</template>

<style scoped>
.fb-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.5); z-index: 20; }
.fb-panel { position: relative; width: min(440px, 92%); max-height: 80%; display: flex; flex-direction: column; background: var(--surface, #1c1208); border: 1px solid #3a2a18; border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,.5); color: #e8dcc8; font-size: 13px; }
.fb-close { position: absolute; top: 6px; right: 8px; background: none; border: none; color: #b9a888; cursor: pointer; font-size: 14px; }
.fb-head { padding: 12px 14px 8px; border-bottom: 1px solid #3a2a18; }
.fb-kicker { text-transform: uppercase; letter-spacing: .1em; font-size: 10px; color: #b9a888; }
.fb-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; margin-top: 4px; }
.fb-crumb { background: none; border: none; color: #d8b97a; cursor: pointer; padding: 0 2px; font-size: 12px; }
.fb-sep { color: #6b5638; }
.fb-list { list-style: none; margin: 0; padding: 4px 0; overflow-y: auto; flex: 1; }
.fb-item { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: none; color: inherit; cursor: pointer; padding: 6px 14px; text-align: left; }
.fb-item:hover { background: rgba(255,255,255,.05); }
.fb-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fb-size { color: #8a7a5c; font-size: 11px; }
.fb-empty, .fb-state { padding: 16px 14px; color: #8a7a5c; }
.fb-foot { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-top: 1px solid #3a2a18; }
.fb-upload { background: #3a2a18; border: 1px solid #5a4326; color: #f0e2c8; border-radius: 5px; padding: 6px 12px; cursor: pointer; }
.fb-upload:disabled { opacity: .6; cursor: default; }
.fb-uperr { color: #e08a6a; font-size: 12px; }
</style>
