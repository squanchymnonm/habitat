<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProjects, type BrowseResult } from '../composables/useProjects'
import type { Project, RelatedRepo, InfraConfig, EnvFile } from '../types'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ close: [] }>()
const { browse, saveConfig, getEnv, saveEnv, importEnv } = useProjects()

// Borrador local: se manda entero al guardar (el server valida la config completa).
const related = ref<RelatedRepo[]>((props.project.related ?? []).map((r) => ({ ...r })))
const infraRepo = ref(props.project.infra?.repo ?? '')
const infraPath = ref(props.project.infra?.path ?? '')
const infraUp = ref(props.project.infra?.up ?? '')
const infraDown = ref(props.project.infra?.down ?? '')
const envFiles = ref<EnvFile[]>((props.project.envFiles ?? []).map((e) => ({ ...e })))
const saving = ref(false)
const configError = ref('')
const configOk = ref(false)

const repoOptions = computed(() => ['self', ...related.value.map((r) => r.name)])
const repoLabel = (r: string) => (r === 'self' ? 'este repo' : r)

function draft(): { related: RelatedRepo[]; infra: InfraConfig | null; envFiles: EnvFile[] } {
  return {
    related: related.value,
    infra: infraRepo.value ? { repo: infraRepo.value, path: infraPath.value, up: infraUp.value, down: infraDown.value } : null,
    envFiles: envFiles.value,
  }
}
async function save() {
  saving.value = true
  configError.value = ''
  configOk.value = false
  const r = await saveConfig(props.project.dir, draft())
  saving.value = false
  if (r.ok) configOk.value = true
  else configError.value = r.error
}

// --- relacionados: navegador de carpetas (sólo repos git) ---
const picking = ref(false)
const tree = ref<BrowseResult | null>(null)
async function openPicker() { picking.value = true; tree.value = await browse('') }
async function go(rel: string) { tree.value = await browse(rel) }
function pick(rel: string, name: string) {
  // browse devuelve rutas relativas a PROJECTS_ROOT; el server las resuelve al guardar.
  related.value.push({ dir: rel, name })
  picking.value = false
}
function removeRelated(i: number) { related.value.splice(i, 1) }

// --- archivos .env ---
const newEnvRepo = ref('self')
const newEnvPath = ref('.env')
function addEnvFile() {
  if (!newEnvPath.value.trim()) return
  envFiles.value.push({ repo: newEnvRepo.value, path: newEnvPath.value.trim() })
}
function removeEnvFile(i: number) { envFiles.value.splice(i, 1); if (editing.value === i) editing.value = null }

const editing = ref<number | null>(null)
const envText = ref('')
const envMsg = ref('')
const envErr = ref('')
async function openEnv(i: number) {
  editing.value = i
  envMsg.value = ''
  envErr.value = ''
  const e = envFiles.value[i]
  envText.value = (await getEnv(props.project.dir, e.repo, e.path)) ?? ''
}
async function doImport() {
  const e = envFiles.value[editing.value!]
  const c = await importEnv(props.project.dir, e.repo, e.path)
  if (c == null) envErr.value = 'no hay un .env en el checkout para importar'
  else { envText.value = c; envErr.value = ''; envMsg.value = 'importado (falta guardar)' }
}
async function doSaveEnv() {
  const e = envFiles.value[editing.value!]
  const r = await saveEnv(props.project.dir, e.repo, e.path, envText.value)
  envMsg.value = r.ok ? 'guardado' : ''
  envErr.value = r.ok ? '' : r.error
}
</script>

<template>
  <div class="pconfig">
    <h4>Repos relacionados</h4>
    <ul class="rows">
      <li v-for="(r, i) in related" :key="r.dir" class="row" :class="{ missing: r.exists === false }" data-test="related-row">
        <input v-model="r.name" class="name" />
        <span class="dir">{{ r.dir }}</span>
        <button class="btn small" @click="removeRelated(i)">quitar</button>
      </li>
    </ul>
    <button v-if="!picking" class="btn small" data-test="related-add" @click="openPicker">+ agregar</button>
    <div v-if="picking" class="picker">
      <div class="crumbs">
        <button class="crumb" @click="go('')">{{ tree?.root ?? 'root' }}</button>
        <template v-for="b in tree?.breadcrumbs ?? []" :key="b.rel">/<button class="crumb" @click="go(b.rel)">{{ b.name }}</button></template>
      </div>
      <ul class="rows">
        <li v-for="e in tree?.entries ?? []" :key="e.rel" class="row">
          <button class="enter" @click="go(e.rel)">📁 {{ e.name }}</button>
          <button class="btn small" data-test="related-pick" :disabled="!e.isRepo" @click="pick(e.rel, e.name)">elegir</button>
        </li>
      </ul>
      <button class="btn small" @click="picking = false">cancelar</button>
    </div>

    <h4>Infra docker</h4>
    <div class="grid">
      <label>Dónde está
        <select v-model="infraRepo" data-test="infra-repo">
          <option value="">ninguna</option>
          <option v-for="r in repoOptions" :key="r" :value="r">{{ repoLabel(r) }}</option>
        </select>
      </label>
      <template v-if="infraRepo">
        <label>Subcarpeta <input v-model="infraPath" data-test="infra-path" placeholder="(raíz)" /></label>
        <label>Levantar <input v-model="infraUp" placeholder="docker compose up -d" /></label>
        <label>Bajar <input v-model="infraDown" placeholder="docker compose down" /></label>
      </template>
    </div>

    <h4>Archivos .env</h4>
    <ul class="rows">
      <li v-for="(e, i) in envFiles" :key="e.repo + e.path" class="row">
        <span class="dir">{{ repoLabel(e.repo) }} / {{ e.path }}</span>
        <button class="btn small" data-test="env-open" @click="openEnv(i)">editar</button>
        <button class="btn small" @click="removeEnvFile(i)">quitar</button>
      </li>
    </ul>
    <div class="row">
      <select v-model="newEnvRepo"><option v-for="r in repoOptions" :key="r" :value="r">{{ repoLabel(r) }}</option></select>
      <input v-model="newEnvPath" placeholder=".env" />
      <button class="btn small" @click="addEnvFile">+ agregar</button>
    </div>
    <p class="hint">Guardá la configuración antes de editar un archivo nuevo.</p>

    <div v-if="editing !== null" class="editor">
      <textarea v-model="envText" data-test="env-text" spellcheck="false" rows="12"></textarea>
      <details class="help">
        <summary>Variables disponibles</summary>
        <ul>
          <li><code v-pre>{{stack}}</code>: nombre único del stack de la sesión</li>
          <li><code v-pre>{{port:NOMBRE}}</code>: un puerto libre por nombre (mismo nombre, mismo puerto)</li>
          <li><code v-pre>{{path:self}}</code> / <code v-pre>{{path:&lt;relacionado&gt;}}</code>: ruta del worktree</li>
          <li><code v-pre>{{branch}}</code>: rama de la sesión</li>
        </ul>
      </details>
      <div class="row">
        <button class="btn small" data-test="env-import" @click="doImport">importar del checkout</button>
        <button class="btn small" data-test="env-save" @click="doSaveEnv">guardar</button>
        <button class="btn small" @click="editing = null">cerrar</button>
      </div>
      <p class="ok" v-if="envMsg">{{ envMsg }}</p>
      <p class="err" v-if="envErr">{{ envErr }}</p>
    </div>

    <div class="actions">
      <button class="btn" data-test="save-config" :disabled="saving" @click="save">Guardar configuración</button>
      <button class="btn" @click="emit('close')">cerrar</button>
    </div>
    <p class="ok" v-if="configOk">configuración guardada</p>
    <p class="err" v-if="configError">{{ configError }}</p>
  </div>
</template>

<style scoped>
.pconfig { border: 2px solid var(--color-edge); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px; margin: 6px 0 12px; }
.pconfig h4 { margin: 6px 0 0; font-family: var(--font-lore); font-size: 13px; }
.rows { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.name { width: 120px; }
.row.missing .dir { color: var(--color-crimson); }
.row.missing .dir::after { content: ' (no existe)'; }
.dir { color: var(--color-dim); font-size: 11px; font-family: var(--font-machine); flex: 1; min-width: 0; overflow-wrap: anywhere; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 6px; }
.grid label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
input, select, textarea { font: inherit; background: var(--color-bg); color: var(--color-ink); border: 1px solid var(--color-edge); border-radius: 6px; padding: 4px 6px; }
textarea { width: 100%; box-sizing: border-box; font-family: var(--font-machine); font-size: 12px; }
.picker, .editor { border-top: 1px solid var(--color-edge); padding-top: 6px; display: flex; flex-direction: column; gap: 6px; }
.crumbs { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.crumb, .enter { background: transparent; border: none; color: var(--color-ink); cursor: pointer; }
.help { font-size: 12px; color: var(--color-dim); }
.hint { color: var(--color-dim); font-size: 11px; margin: 0; }
.ok { color: var(--color-brass); font-size: 12px; margin: 0; }
.err { color: var(--color-crimson); font-size: 12px; margin: 0; }
.actions { display: flex; gap: 6px; }
.btn { font: inherit; font-size: 13px; padding: 8px 12px; background: var(--color-surface-2); color: var(--color-ink); border: 1px solid var(--color-edge); border-radius: 9px; cursor: pointer; }
.btn.small { font-size: 11px; padding: 4px 8px; }
.btn:hover { border-color: var(--color-brass-2); color: var(--color-brass); }
.btn:disabled { opacity: .6; cursor: default; }
</style>
