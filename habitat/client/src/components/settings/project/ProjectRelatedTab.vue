<script setup lang="ts">
import { ref } from 'vue'
import { TriangleAlert } from 'lucide-vue-next'
import { useProjects, type BrowseResult } from '../../../composables/useProjects'
import type { ProjectConfigDraft } from '../../../composables/useProjectConfigDraft'
import ConfigSaveBar from './ConfigSaveBar.vue'

const props = defineProps<{ draft: ProjectConfigDraft }>()
const { related } = props.draft
const { browse } = useProjects()

// Navegador de carpetas (sólo se pueden elegir repos git).
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

const btn = 'min-h-10 cursor-pointer rounded-[var(--radius)] border-0 bg-surface-raised px-3 font-[inherit] text-sm text-text hover:text-accent disabled:opacity-50'
const input = 'min-h-10 rounded-[var(--radius)] border border-border bg-background px-3 font-[inherit] text-sm text-text'
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="m-0 text-sm text-muted">Repos que se clonan como worktree junto al proyecto en cada sesión.</p>
    <ul class="m-0 flex list-none flex-col gap-2 p-0">
      <li v-for="(r, i) in related" :key="r.dir" data-test="related-row"
        class="flex flex-wrap items-center gap-3 rounded-[var(--radius)] bg-surface p-2">
        <input v-model="r.name" aria-label="Nombre del relacionado" :class="[input, 'w-36']" />
        <span :class="['flex min-w-0 flex-1 items-center gap-1.5 font-mono text-xs [overflow-wrap:anywhere]', r.exists === false ? 'text-danger' : 'text-muted']">
          <TriangleAlert v-if="r.exists === false" class="size-4 shrink-0" aria-hidden="true" />
          {{ r.dir }}<template v-if="r.exists === false"> (no existe)</template>
        </span>
        <button type="button" :class="btn" @click="removeRelated(i)">quitar</button>
      </li>
    </ul>
    <p v-if="!related.length" class="m-0 text-sm text-muted">Sin repos relacionados.</p>

    <div v-if="!picking"><button type="button" data-test="related-add" :class="btn" @click="openPicker">+ agregar</button></div>
    <div v-else class="flex flex-col gap-3 rounded-[var(--radius)] border border-border p-3">
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
          <button type="button" data-test="related-pick" :class="btn" :disabled="!e.isRepo" @click="pick(e.rel, e.name)">elegir</button>
        </li>
      </ul>
      <div><button type="button" :class="btn" @click="picking = false">cancelar</button></div>
    </div>

    <ConfigSaveBar :draft="draft" />
  </div>
</template>
