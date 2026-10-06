<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProjects, type BrowseResult, type RepoList } from '../../composables/useProjects'
import { PALETTE } from '../../palette'
import { CHARACTERS, faceFor } from '../../sprites'
import { cn } from '@/lib/utils'
import { projectSlug } from './projectSlug'

const { projects, canManage, canClone, error, browse, listRepos, cloneRepo, addProject } = useProjects()

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
  draftDir.value = rel
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

const btn = 'min-h-10 cursor-pointer rounded-[var(--radius)] border-0 bg-surface-raised px-3 font-[inherit] text-sm text-text hover:text-accent disabled:opacity-50'
const input = 'min-h-10 rounded-[var(--radius)] border border-border bg-background px-3 font-[inherit] text-sm text-text'
</script>

<template>
  <div class="flex flex-col gap-6">
    <section class="flex flex-col gap-3">
      <h2 class="m-0 text-base font-semibold text-text">Proyectos</h2>
      <p v-if="!canManage" class="m-0 text-sm text-muted">Gestión deshabilitada: configurá HABITAT_ALLOW_SPAWN y HABITAT_PROJECTS_ROOT.</p>

      <ul class="m-0 flex list-none flex-col gap-2 p-0">
        <li v-for="p in projects" :key="p.dir" data-test="project-row"
          class="flex min-h-10 items-center gap-3 rounded-[var(--radius)] bg-surface px-3">
          <i class="size-3 shrink-0 rounded-sm" :style="{ background: p.color }" />
          <RouterLink :to="{ name: 'project', params: { name: projectSlug(p.dir), tab: 'general' } }" data-test="project-open"
            class="flex min-w-0 flex-1 items-center gap-3 font-[inherit] text-sm text-text no-underline hover:text-accent">
            <span class="font-semibold">{{ p.name }}</span>
            <span class="min-w-0 truncate text-xs text-muted">{{ p.dir }}</span>
          </RouterLink>
        </li>
      </ul>

      <div v-if="canManage && !browsing && !repoPanel" class="flex flex-wrap gap-2">
        <button type="button" data-test="add-open" :class="btn" @click="openBrowser">+ Agregar proyecto</button>
        <button v-if="canClone" type="button" data-test="clone-open" :class="btn" @click="openRepos">Clonar repo</button>
      </div>
    </section>

    <section v-if="repoPanel" class="flex flex-col gap-3">
      <h2 class="m-0 text-base font-semibold text-text">Clonar repo</h2>
      <input v-model="repoFilter" data-test="repo-filter" :class="input" placeholder="filtrar repos…" />
      <p v-if="repoLoading" class="m-0 text-sm text-muted">cargando repos…</p>
      <p v-for="e in repoList?.errors ?? []" :key="e.owner" class="m-0 text-sm text-danger">{{ e.owner }}: {{ e.message }}</p>
      <ul class="m-0 flex list-none flex-col gap-2 p-0">
        <li v-for="r in filteredRepos" :key="r.nameWithOwner" data-test="repo"
          class="flex min-h-10 items-center gap-3 rounded-[var(--radius)] bg-surface px-3">
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="text-sm text-text">{{ r.nameWithOwner }}<span v-if="r.isPrivate" class="ml-1.5 text-xs text-muted">privado</span></span>
            <span v-if="r.description" class="truncate text-xs text-muted">{{ r.description }}</span>
          </span>
          <button type="button" :class="btn" :disabled="r.cloned || !!cloning" @click="clone(r.nameWithOwner, r.name)">
            {{ r.cloned ? 'ya clonado' : cloning === r.nameWithOwner ? 'clonando…' : 'clonar' }}
          </button>
        </li>
      </ul>
      <p v-if="repoList && !repoLoading && filteredRepos.length === 0" class="m-0 text-sm text-muted">sin repos</p>
      <p v-if="cloneError" class="m-0 text-sm text-danger">{{ cloneError }}</p>
      <button type="button" :class="btn" :disabled="!!cloning" @click="repoPanel = false">cerrar</button>
    </section>

    <section v-if="browsing" class="flex flex-col gap-3">
      <h2 class="m-0 text-base font-semibold text-text">Agregar proyecto</h2>
      <div class="flex flex-wrap items-center gap-1">
        <button type="button" :class="btn" @click="go('')">{{ tree?.root ?? 'root' }}</button>
        <template v-for="b in tree?.breadcrumbs ?? []" :key="b.rel">
          <span class="text-muted">/</span>
          <button type="button" :class="btn" @click="go(b.rel)">{{ b.name }}</button>
        </template>
      </div>
      <ul class="m-0 flex list-none flex-col gap-2 p-0">
        <li v-for="e in tree?.entries ?? []" :key="e.rel"
          class="flex min-h-10 items-center gap-3 rounded-[var(--radius)] bg-surface px-3">
          <button type="button" @click="go(e.rel)"
            class="min-h-10 flex-1 cursor-pointer border-0 bg-transparent px-0 text-left font-[inherit] text-sm text-text hover:text-accent">
            📁 {{ e.name }}<span v-if="e.isRepo" class="ml-1.5 text-xs text-muted">git</span>
          </button>
          <button type="button" data-test="browse-pick" :class="btn" :disabled="e.added" @click="chooseFolder(e.rel, e.name)">
            {{ e.added ? 'ya agregado' : 'elegir' }}
          </button>
        </li>
      </ul>

      <div v-if="draftDir" class="flex flex-col gap-3 border-0 border-t border-border pt-3">
        <label class="flex flex-col gap-1 text-sm text-text">Nombre
          <input v-model="draftLabel" data-test="draft-name" :class="input" />
        </label>
        <div class="flex flex-col gap-1">
          <span class="text-sm text-text">Color</span>
          <div class="flex flex-wrap gap-2">
            <button v-for="(c, i) in PALETTE" :key="c" type="button" data-test="draft-color" :style="{ background: c }"
              :title="c" :aria-label="`Color ${i + 1}`" :aria-pressed="c === draftColor ? 'true' : 'false'"
              :class="cn('size-10 cursor-pointer rounded-[var(--radius)] border-0', c === draftColor && 'ring-2 ring-accent')"
              @click="draftColor = c" />
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-sm text-text">Personajes permitidos (vacío = todos)</span>
          <div class="flex flex-wrap gap-2">
            <button v-for="c in CHARACTERS" :key="c" type="button" data-test="draft-char" :title="c"
              :aria-pressed="draftChars.includes(c) ? 'true' : 'false'"
              :class="cn('min-h-10 min-w-10 cursor-pointer rounded-[var(--radius)] border-0 bg-surface-raised p-1', draftChars.includes(c) && 'ring-2 ring-accent')"
              @click="toggleDraftChar(c)">
              <img :src="faceFor('', c)" alt="" class="pixel size-8" />
            </button>
          </div>
        </div>
        <div class="flex gap-2">
          <button type="button" data-test="draft-submit" :class="btn" :disabled="busy" @click="submitAdd">Agregar</button>
          <button type="button" data-test="draft-cancel" :class="btn" :disabled="busy" @click="draftDir = ''">cancelar</button>
        </div>
      </div>

      <button type="button" :class="btn" @click="browsing = false">cerrar navegador</button>
    </section>

    <p v-if="error" class="m-0 text-sm text-danger">{{ error }}</p>
  </div>
</template>

<style scoped>
.pixel { image-rendering: pixelated; }
</style>
