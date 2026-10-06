<script setup lang="ts">
import { ref } from 'vue'
import { Textarea } from '@/components/ui/textarea'
import { useProjects } from '../../../composables/useProjects'
import type { ProjectConfigDraft } from '../../../composables/useProjectConfigDraft'
import type { EnvFile, Project } from '../../../types'
import ConfigSaveBar from './ConfigSaveBar.vue'

const props = defineProps<{ project: Project; draft: ProjectConfigDraft }>()
const { envFiles, repoOptions, repoLabel } = props.draft
const { getEnv, saveEnv, importEnv } = useProjects()

const newEnvRepo = ref('self')
const newEnvPath = ref('.env')
function addEnvFile() {
  if (!newEnvPath.value.trim()) return
  envFiles.value.push({ repo: newEnvRepo.value, path: newEnvPath.value.trim() })
}
function removeEnvFile(i: number) {
  const e = envFiles.value[i]
  envFiles.value.splice(i, 1)
  // Si el archivo quitado es el que se está editando, cerrar el editor
  // (identificado por repo+path, no por índice: el índice se corre al quitar filas).
  if (editing.value && editing.value.repo === e.repo && editing.value.path === e.path) editing.value = null
}

// Se identifica el archivo en edición por (repo, path), no por índice: si se
// quita una fila anterior en la lista, un índice quedaría apuntando a otro
// archivo (o fuera de rango).
const editing = ref<EnvFile | null>(null)
const envText = ref('')
const envMsg = ref('')
const envErr = ref('')
async function openEnv(i: number) {
  const e = envFiles.value[i]
  editing.value = { ...e }
  envMsg.value = ''
  envErr.value = ''
  envText.value = (await getEnv(props.project.dir, e.repo, e.path)) ?? ''
}
async function doImport() {
  const e = editing.value!
  const c = await importEnv(props.project.dir, e.repo, e.path)
  if (c == null) envErr.value = 'no hay un .env en el checkout para importar'
  else { envText.value = c; envErr.value = ''; envMsg.value = 'importado (falta guardar)' }
}
async function doSaveEnv() {
  const e = editing.value!
  const r = await saveEnv(props.project.dir, e.repo, e.path, envText.value)
  envMsg.value = r.ok ? 'guardado' : ''
  envErr.value = r.ok ? '' : r.error
}

const btn = 'min-h-10 cursor-pointer rounded-[var(--radius)] border-0 bg-surface-raised px-3 font-[inherit] text-sm text-text hover:text-accent disabled:opacity-50'
const input = 'min-h-10 rounded-[var(--radius)] border border-border bg-background px-3 font-[inherit] text-sm text-text'
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="m-0 text-sm text-muted">Plantillas de .env que se generan en el worktree de cada sesión.</p>
    <ul class="m-0 flex list-none flex-col gap-2 p-0">
      <li v-for="(e, i) in envFiles" :key="e.repo + e.path" data-test="env-row"
        class="flex flex-wrap items-center gap-3 rounded-[var(--radius)] bg-surface p-2">
        <span class="min-w-0 flex-1 font-mono text-xs text-muted [overflow-wrap:anywhere]">{{ repoLabel(e.repo) }} / {{ e.path }}</span>
        <button type="button" data-test="env-open" :class="btn" @click="openEnv(i)">editar</button>
        <button type="button" data-test="env-remove" :class="btn" @click="removeEnvFile(i)">quitar</button>
      </li>
    </ul>
    <div class="flex flex-wrap items-center gap-2">
      <select v-model="newEnvRepo" aria-label="Repo del archivo" :class="[input, 'cursor-pointer']">
        <option v-for="r in repoOptions" :key="r" :value="r">{{ repoLabel(r) }}</option>
      </select>
      <input v-model="newEnvPath" aria-label="Ruta del archivo" placeholder=".env" :class="[input, 'w-40']" />
      <button type="button" :class="btn" @click="addEnvFile">+ agregar</button>
    </div>
    <p class="m-0 text-xs text-muted">Guardá la configuración antes de editar un archivo nuevo.</p>

    <div v-if="editing" class="flex flex-col gap-3 rounded-[var(--radius)] border border-border p-3">
      <p class="m-0 font-mono text-xs text-muted">{{ repoLabel(editing.repo) }} / {{ editing.path }}</p>
      <Textarea v-model="envText" data-test="env-text" spellcheck="false" class="min-h-48 font-mono" />
      <details class="text-sm text-muted">
        <summary class="min-h-10 cursor-pointer leading-10">Variables disponibles</summary>
        <ul class="m-0 flex flex-col gap-1 pl-5">
          <li><code v-pre class="font-mono">{{stack}}</code>: nombre único del stack de la sesión</li>
          <li><code v-pre class="font-mono">{{port:NOMBRE}}</code>: un puerto libre por nombre (mismo nombre, mismo puerto)</li>
          <li><code v-pre class="font-mono">{{path:self}}</code> / <code v-pre class="font-mono">{{path:&lt;relacionado&gt;}}</code>: ruta del worktree</li>
          <li><code v-pre class="font-mono">{{branch}}</code>: rama de la sesión</li>
        </ul>
      </details>
      <div class="flex flex-wrap gap-2">
        <button type="button" data-test="env-import" :class="btn" @click="doImport">importar del checkout</button>
        <button type="button" data-test="env-save" :class="btn" @click="doSaveEnv">guardar</button>
        <button type="button" :class="btn" @click="editing = null">cerrar</button>
      </div>
      <p v-if="envMsg" class="m-0 text-sm text-muted">{{ envMsg }}</p>
      <p v-if="envErr" class="m-0 text-sm text-danger">{{ envErr }}</p>
    </div>

    <ConfigSaveBar :draft="draft" />
  </div>
</template>
