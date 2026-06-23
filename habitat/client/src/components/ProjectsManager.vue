<script setup lang="ts">
import { ref } from 'vue'
import { useProjects, type BrowseResult } from '../composables/useProjects'
import { PALETTE } from '../palette'
import { CHARACTERS } from '../sprites'

const { projects, canManage, error, browse, addProject, updateProject, removeProject } = useProjects()

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
      <li v-for="p in projects" :key="p.dir" class="pitem">
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
        <button class="ctl del" @click="remove(p.dir, p.name)">quitar</button>
      </li>
    </ul>

    <button v-if="canManage && !browsing" class="ctl" @click="openBrowser">+ Agregar proyecto</button>

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
          <button class="ctl" :disabled="busy" @click="submitAdd">Agregar</button>
          <button class="ctl" :disabled="busy" @click="draftDir = ''">cancelar</button>
        </div>
      </div>

      <button class="ctl close" @click="browsing = false">cerrar navegador</button>
    </div>

    <p class="err" v-if="error">{{ error }}</p>
  </section>
</template>

<style scoped>
.projects { max-width: 720px; padding: clamp(18px, 3.5vw, 38px); }
.projects h3 { font-family: var(--f-logo); margin: 0 0 12px; }
.hint, .err { color: var(--dim); font-size: 12px; }
.err { color: #e06; }
.plist { list-style: none; padding: 0; margin: 0 0 12px; display: flex; flex-direction: column; gap: 8px; }
.pitem { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sw, .swatch { width: 14px; height: 14px; border-radius: 3px; border: 1px solid #0006; cursor: pointer; }
.plabel { font-family: var(--f-ui); font-weight: 700; }
.pdir { color: var(--dim); font-size: 11px; }
.swatches { display: inline-flex; gap: 3px; flex-wrap: wrap; }
.swatch.on { outline: 2px solid var(--ink); outline-offset: 1px; }
.del { font-size: 11px; }
.browser { margin-top: 10px; border: 2px solid #3a3a4a; border-radius: 6px; padding: 10px; }
.crumbs { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
.crumb { background: transparent; border: 1px solid #3a3a4a; border-radius: 4px; color: var(--ink); padding: 2px 6px; cursor: pointer; }
.entries { list-style: none; padding: 0; margin: 0 0 8px; display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow: auto; }
.entries li { display: flex; justify-content: space-between; gap: 8px; }
.enter { background: transparent; border: none; color: var(--ink); cursor: pointer; text-align: left; flex: 1; }
.enter .repo { color: var(--gold); font-size: 10px; margin-left: 6px; }
.draft { border-top: 1px solid #3a3a4a; margin-top: 8px; padding-top: 8px; display: flex; flex-direction: column; gap: 8px; }
.draft .row { display: flex; flex-direction: column; gap: 4px; }
.charlist { display: flex; flex-wrap: wrap; gap: 4px; }
.charbtn { background: #1a1a24; border: 1px solid #3a3a4a; border-radius: 4px; color: var(--dim); font-size: 10px; padding: 2px 5px; cursor: pointer; }
.charbtn.on { color: #2a1c0a; background: var(--gold); border-color: var(--gold); }
.actions { display: flex; gap: 6px; }
.close { margin-top: 6px; }
</style>
