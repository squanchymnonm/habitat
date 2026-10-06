<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { SlidersHorizontal, Palette, FolderGit2, CircleUser } from 'lucide-vue-next'
import { useLayoutMode } from '../../composables/useLayoutMode'
import GeneralSettings from './GeneralSettings.vue'
import AppearanceSettings from './AppearanceSettings.vue'
import AccountSettings from './AccountSettings.vue'
import ProjectsManager from '../ProjectsManager.vue'
import { cn } from '@/lib/utils'

const route = useRoute()
const { mode } = useLayoutMode()
const SECTIONS = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'appearance', label: 'Apariencia', icon: Palette },
  { id: 'projects', label: 'Proyectos', icon: FolderGit2 },
  { id: 'account', label: 'Cuenta', icon: CircleUser },
]
// La página de un proyecto cuenta como la sección Proyectos.
const current = computed(() => (route.name === 'project' ? 'projects' : String(route.params.section ?? 'general')))
const side = computed(() => mode.value === 'landscape')
</script>

<template>
  <div :class="cn('flex h-full min-h-0', side ? 'flex-row' : 'flex-col')">
    <nav data-test="settings-nav" aria-label="Secciones de ajustes"
      :class="cn('flex shrink-0 gap-1 bg-surface p-2', side ? 'w-52 flex-col border-r border-border' : 'overflow-x-auto border-b border-border')">
      <RouterLink v-for="s in SECTIONS" :key="s.id" :to="`/settings/${s.id}`" data-test="settings-link"
        :aria-current="current === s.id ? 'page' : undefined"
        :class="cn('flex min-h-10 shrink-0 items-center gap-2 rounded-[var(--radius)] px-3 text-sm no-underline',
          current === s.id ? 'bg-surface-raised text-text' : 'text-muted hover:bg-surface-raised hover:text-text')">
        <component :is="s.icon" class="size-4" />{{ s.label }}
      </RouterLink>
    </nav>
    <div class="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <GeneralSettings v-if="current === 'general'" />
      <AppearanceSettings v-else-if="current === 'appearance'" />
      <AccountSettings v-else-if="current === 'account'" />
      <!-- Legacy hasta que lleguen ProjectsSettings / ProjectDetail (Tasks 3 y 4). -->
      <ProjectsManager v-else />
    </div>
  </div>
</template>
