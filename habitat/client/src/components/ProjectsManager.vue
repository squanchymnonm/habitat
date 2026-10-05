<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProjects, type BrowseResult, type RepoList } from '../composables/useProjects'
import { PALETTE } from '../palette'
import { CHARACTERS } from '../sprites'
import ProjectConfig from './ProjectConfig.vue'

const { projects, canManage, canClone, error, browse, listRepos, cloneRepo, addProject, updateProject, removeProject } = useProjects()

const configuring = ref('') // dir del proyecto cuyo panel de config está abierto

// --- alta con navegador de carpetas ---
const browsing = ref(false)
const tree = ref<BrowseResult | null>(null)
const busy = ref(false)

// formulario de alta para la carpeta elegida
const draftDir = ref('')
const draftLabel = ref('')
const draftColor = ref(PALETTE[0])
const draftChars = ref<string[]>([])

async function openBrowser() {
  browsing.value = true
  tree.value = await browse('')
}
async function go(rel: string) {
  tree.value = await browse(rel)
}
function chooseFolder(rel: string, name: string) {
  // Mandamos el rel y el server resuelve contra PROJECTS_ROOT.
  draftDir.value = rel // rel respecto del root; el server lo resuelve contra PROJECTS_ROOT
  draftLabel.value = name
  draftColor.value = PALETTE[0]
  draftChars.value = []
}
function toggleDraftChar(c: string) {
  draftChars.value = draftChars.value.includes(c)
    ? draftChars.value.filter((x) => x !== c)
    : [...draftChars.value, c]
}
async function submitAdd() {
  busy.value = true
  const ok = await addProject({
    dir: draftDir.value,
    label: draftLabel.value.trim() || undefined,
    color: draftColor.value,
    chars: draftChars.value,
  })
  busy.value = false
  if (ok) { browsing.value = false; tree.value = null; draftDir.value = '' }
}

// --- clonar un repo de los owners whitelisteados ---
const repoPanel = ref(false)
const repoList = ref<RepoList | null>(null)
const repoLoading = ref(false)
const repoFilter = ref('')
const cloning = ref('') // nameWithOwner en curso
const cloneError = ref('')

const filteredRepos = computed(() => {
  const q = repoFilter.value.trim().toLowerCase()
  const list = repoList.value?.repos ?? []
  return q ? list.filter((r) => r.nameWithOwner.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)) : list
})

async function openRepos() {
  browsing.value = false
  repoPanel.value = true
  repoFilter.value = ''
  cloneError.value = ''
  repoLoading.value = true
  repoList.value = await listRepos()
  repoLoading.value = false
  if (!repoList.value) cloneError.value = 'no se pudo listar los repos'
}
async function clone(nameWithOwner: string, name: string) {
  cloneError.value = ''
  cloning.value = nameWithOwner
  const r = await cloneRepo(nameWithOwner)
  cloning.value = ''
  if (!r.ok) { cloneError.value = r.message; return }
  // Seguimos con el alta normal: navegador abierto y formulario precargado.
  repoPanel.value = false
  browsing.value = true
  tree.value = await browse('')
  chooseFolder(r.rel, name)
}

async function setColor(dir: string, color: string) {
  await updateProject({ dir, color })
}
async function remove(dir: string, name: string) {
  if (confirm(`¿Quitar "${name}" de la lista? No se borra nada del disco.`)) {
    await removeProject(dir)
  }
}
</script>

<template>
  <section class="projects">
    <h3>PROYECTOS</h3>
    <p class="hint" v-if="!canManage">Gestión deshabilitada: configurá HABITAT_ALLOW_SPAWN y HABITAT_PROJECTS_ROOT.</p>

    <ul class="plist">
      <template v-for="p in projects" :key="p.dir">
        <li class="pitem">
          <span class="sw" :style="{ background: p.color }"></span>
          <span class="plabel">{{ p.name }}</span>
          <span class="pdir">{{ p.dir }}</span>
          <span class="swatches">
            <button
              v-for="c in PALETTE"
              :key="c"
              class="swatch"
              :class="{ on: c === p.color }"
              :style="{ background: c }"
              :title="c"
              @click="setColor(p.dir, c)"
            />
          </span>
          <button class="btn del" @click="configuring = configuring === p.dir ? '' : p.dir">configurar</button>
          <button class="btn del" @click="remove(p.dir, p.name)">quitar</button>
        </li>
        <li v-if="configuring === p.dir">
          <ProjectConfig :project="p" @close="configuring = ''" />
        </li>
      </template>
    </ul>

    <div class="addbar" v-if="canManage && !browsing && !repoPanel">
      <button class="btn" @click="openBrowser">+ Agregar proyecto</button>
      <button v-if="canClone" class="btn" data-test="clone-open" @click="openRepos">Clonar repo</button>
    </div>

    <div v-if="repoPanel" class="browser">
      <input v-model="repoFilter" class="filter" data-test="repo-filter" placeholder="filtrar repos…" />
      <p class="hint" v-if="repoLoading">cargando repos…</p>
      <p class="hint" v-for="e in repoList?.errors ?? []" :key="e.owner">{{ e.owner }}: {{ e.message }}</p>
      <ul class="entries">
        <li v-for="r in filteredRepos" :key="r.nameWithOwner" data-test="repo">
          <span class="rinfo">
            <span class="rname">{{ r.nameWithOwner }}<span v-if="r.isPrivate" class="repo">privado</span></span>
            <span v-if="r.description" class="rdesc">{{ r.description }}</span>
          </span>
          <button class="pick" :disabled="r.cloned || !!cloning" @click="clone(r.nameWithOwner, r.name)">
            {{ r.cloned ? 'ya clonado' : cloning === r.nameWithOwner ? 'clonando…' : 'clonar' }}
          </button>
        </li>
      </ul>
      <p class="hint" v-if="repoList && !repoLoading && filteredRepos.length === 0">sin repos</p>
      <p class="err" v-if="cloneError">{{ cloneError }}</p>
      <button class="btn close" :disabled="!!cloning" @click="repoPanel = false">cerrar</button>
    </div>

    <div v-if="browsing" class="browser">
      <div class="crumbs">
        <button class="crumb" @click="go('')">{{ tree?.root ?? 'root' }}</button>
        <template v-for="b in tree?.breadcrumbs ?? []" :key="b.rel">
          <span class="sep">/</span>
          <button class="crumb" @click="go(b.rel)">{{ b.name }}</button>
        </template>
      </div>
      <ul class="entries">
        <li v-for="e in tree?.entries ?? []" :key="e.rel">
          <button class="enter" @click="go(e.rel)">📁 {{ e.name }}<span v-if="e.isRepo" class="repo">git</span></button>
          <button class="pick" :disabled="e.added" @click="chooseFolder(e.rel, e.name)">
            {{ e.added ? 'ya agregado' : 'elegir' }}
          </button>
        </li>
      </ul>

      <div v-if="draftDir" class="draft">
        <label>Nombre <input v-model="draftLabel" /></label>
        <div class="row">
          <span>Color</span>
          <span class="swatches">
            <button
              v-for="c in PALETTE"
              :key="c"
              class="swatch"
              :class="{ on: c === draftColor }"
              :style="{ background: c }"
              @click="draftColor = c"
            />
          </span>
        </div>
        <div class="row chars">
          <span>Personajes permitidos (vacío = todos)</span>
          <span class="charlist">
            <button
              v-for="c in CHARACTERS"
              :key="c"
              class="charbtn"
              :class="{ on: draftChars.includes(c) }"
              @click="toggleDraftChar(c)"
            >{{ c }}</button>
          </span>
        </div>
        <div class="actions">
          <button class="btn" :disabled="busy" @click="submitAdd">Agregar</button>
          <button class="btn" :disabled="busy" @click="draftDir = ''">cancelar</button>
        </div>
      </div>

      <button class="btn close" @click="browsing = false">cerrar navegador</button>
    </div>

    <p class="err" v-if="error">{{ error }}</p>
  </section>
</template>

<style scoped>
.projects { max-width: 720px; padding: clamp(18px, 3.5vw, 38px); }
.projects h3 { font-family: var(--font-lore); margin: 0 0 12px; }
.hint, .err { color: var(--color-dim); font-size: 12px; }
.err { color: var(--color-crimson); }
.plist { list-style: none; padding: 0; margin: 0 0 12px; display: flex; flex-direction: column; gap: 8px; }
.pitem { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sw, .swatch { width: 14px; height: 14px; border-radius: 3px; border: 1px solid #0006; cursor: pointer; }
.plabel { font-family: var(--font-system); font-weight: 700; }
.pdir { color: var(--color-dim); font-size: 11px; font-family: var(--font-machine); }
.swatches { display: inline-flex; gap: 3px; flex-wrap: wrap; }
.swatch.on { outline: 2px solid var(--color-brass); outline-offset: 1px; }
.del { font-size: 11px; }
.browser { margin-top: 10px; border: 2px solid var(--color-edge); border-radius: 6px; padding: 10px; }
.crumbs { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
.crumb { background: var(--color-surface-2); border: 1px solid var(--color-edge); border-radius: 4px; color: var(--color-ink); padding: 2px 6px; cursor: pointer; }
.entries { list-style: none; padding: 0; margin: 0 0 8px; display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow: auto; }
.entries li { display: flex; justify-content: space-between; gap: 8px; }
.enter { background: transparent; border: none; color: var(--color-ink); cursor: pointer; text-align: left; flex: 1; }
.enter .repo { color: var(--color-brass); font-size: 10px; margin-left: 6px; font-family: var(--font-machine); }
.draft { border-top: 1px solid var(--color-edge); margin-top: 8px; padding-top: 8px; display: flex; flex-direction: column; gap: 8px; }
.draft .row { display: flex; flex-direction: column; gap: 4px; }
.charlist { display: flex; flex-wrap: wrap; gap: 4px; }
.charbtn { background: var(--color-bg); border: 1px solid var(--color-edge); border-radius: 4px; color: var(--color-dim); font-size: 10px; padding: 2px 5px; cursor: pointer; }
.charbtn.on { color: #1B1308; background: var(--color-brass); border-color: var(--color-brass); }
.actions { display: flex; gap: 6px; }
.close { margin-top: 6px; }
.addbar { display: flex; gap: 6px; flex-wrap: wrap; }
.filter { width: 100%; box-sizing: border-box; margin-bottom: 8px; font: inherit; padding: 6px 8px; background: var(--color-bg); color: var(--color-ink); border: 1px solid var(--color-edge); border-radius: 6px; }
.rinfo { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.rname { color: var(--color-ink); }
.rname .repo { color: var(--color-brass); font-size: 10px; margin-left: 6px; font-family: var(--font-machine); }
.rdesc { color: var(--color-dim); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Premium button */
.btn { font: inherit; font-size: 13px; padding: 8px 12px; background: var(--color-surface-2); color: var(--color-ink); border: 1px solid var(--color-edge); border-radius: 9px; cursor: pointer; }
.btn:hover { border-color: var(--color-brass-2); color: var(--color-brass); }
.btn:focus-visible { outline: 2px solid var(--color-brass); outline-offset: 2px; }
.btn:disabled { opacity: .6; cursor: default; }
</style>
