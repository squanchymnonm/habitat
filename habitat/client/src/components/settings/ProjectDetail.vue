<script setup lang="ts">
import { computed, effectScope, onScopeDispose, shallowRef, watch, type EffectScope } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjects } from '../../composables/useProjects'
import { useProjectConfigDraft, type ProjectConfigDraft } from '../../composables/useProjectConfigDraft'
import type { Project } from '../../types'
import { projectSlug } from './projectSlug'
import ProjectGeneralTab from './project/ProjectGeneralTab.vue'
import ProjectRelatedTab from './project/ProjectRelatedTab.vue'
import ProjectInfraTab from './project/ProjectInfraTab.vue'
import ProjectEnvTab from './project/ProjectEnvTab.vue'
import { cn } from '@/lib/utils'

const route = useRoute()
const router = useRouter()
const { projects, loaded, error } = useProjects()

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'related', label: 'Relacionados' },
  { id: 'infra', label: 'Infra' },
  { id: 'env', label: 'Archivos .env' },
] as const
type TabId = (typeof TABS)[number]['id']

const name = computed(() => String(route.params.name ?? ''))
const tab = computed<TabId>(() => {
  const t = String(route.params.tab ?? '')
  return TABS.some((x) => x.id === t) ? (t as TabId) : 'general'
})
const project = computed(() => projects.value.find((p) => projectSlug(p.dir) === name.value))

// Un único borrador para Relacionados, Infra y .env: cambiar de pestaña no pierde lo editado.
// Se crea cuando aparece el proyecto (la lista puede llegar después) y se rehace sólo al
// cambiar de proyecto, no cuando la lista se recarga tras guardar.
// Cada borrador vive en su propio scope, que se para al cambiar de proyecto o al desmontar.
const draft = shallowRef<ProjectConfigDraft | null>(null)
let draftScope: EffectScope | null = null
watch(() => project.value?.dir, (dir) => {
  draftScope?.stop()
  draftScope = dir ? effectScope(true) : null
  draft.value = draftScope?.run(() => useProjectConfigDraft(computed(() => project.value as Project))) ?? null
}, { immediate: true })
onScopeDispose(() => draftScope?.stop())

function choose(id: TabId) {
  if (id !== tab.value) router.replace(`/settings/projects/${name.value}/${id}`)
}

const link = 'inline-flex min-h-10 items-center text-sm text-muted no-underline hover:text-accent'
</script>

<template>
  <p v-if="!project && !loaded" class="m-0 text-sm text-muted">Cargando…</p>
  <div v-else-if="!project" class="flex flex-col gap-3">
    <p class="m-0 text-sm text-text">Proyecto no encontrado.</p>
    <RouterLink to="/settings/projects" :class="link">‹ Volver a Proyectos</RouterLink>
  </div>
  <div v-else class="flex flex-col gap-4">
    <div class="flex flex-col gap-1">
      <RouterLink to="/settings/projects" :class="link">‹ Proyectos</RouterLink>
      <h2 class="m-0 flex items-center gap-3 text-base font-semibold text-text">
        <i class="size-3 shrink-0 rounded-sm" :style="{ background: project.color }" />
        <span data-test="project-title">{{ project.name }}</span>
      </h2>
      <p class="m-0 font-mono text-xs text-muted [overflow-wrap:anywhere]">{{ project.dir }}</p>
    </div>

    <nav role="tablist" aria-label="Secciones del proyecto" class="flex items-center gap-1 overflow-x-auto border-0 border-b border-border">
      <button v-for="t in TABS" :key="t.id" data-test="project-tab" type="button" role="tab"
        :aria-selected="tab === t.id ? 'true' : 'false'"
        :class="cn('inline-flex min-h-10 shrink-0 cursor-pointer items-center border-0 border-b-2 bg-transparent px-3 font-[inherit] text-sm',
          tab === t.id ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text')"
        @click="choose(t.id)">
        {{ t.label }}
      </button>
    </nav>

    <div role="tabpanel">
      <ProjectGeneralTab v-if="tab === 'general'" :project="project" />
      <template v-else-if="draft">
        <ProjectRelatedTab v-if="tab === 'related'" :key="project.dir" :draft="draft" />
        <ProjectInfraTab v-else-if="tab === 'infra'" :key="project.dir" :draft="draft" />
        <ProjectEnvTab v-else :key="project.dir" :project="project" :draft="draft" />
      </template>
    </div>

    <p v-if="error" class="m-0 text-sm text-danger">{{ error }}</p>
  </div>
</template>
