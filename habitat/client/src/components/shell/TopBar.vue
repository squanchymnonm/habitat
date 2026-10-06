<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LayoutGrid, Focus, Plus } from 'lucide-vue-next'
import SessionSummary from './SessionSummary.vue'
import ManaMeter from './ManaMeter.vue'
import UserMenu from './UserMenu.vue'
import NewSessionDialog from '../session/NewSessionDialog.vue'
import { useSessions } from '../../stores/sessions'
import { useProjects } from '../../composables/useProjects'

const route = useRoute()
const router = useRouter()
const store = useSessions()
const { canSpawn } = useProjects()
const newOpen = ref(false)
const onBoard = computed(() => route.name === 'board' || route.path === '/board')
// Alterna tablero ↔ foco (la última sesión seleccionada, o el foco vacío).
function toggleBoard() {
  if (onBoard.value) router.push(store.selectedId ? `/s/${store.selectedId}` : '/')
  else router.push('/board')
}
</script>

<template>
  <header class="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3 pt-[env(safe-area-inset-top,0px)] sm:gap-4 sm:px-4">
    <RouterLink to="/" class="shrink-0 font-display text-lg font-bold text-accent no-underline">Hábitat</RouterLink>
    <SessionSummary />
    <span class="flex-1" />
    <!-- En teléfono el que cede ancho es el resumen (min-w-0); maná, spawn y menú son shrink-0. -->
    <ManaMeter />
    <button data-test="board-toggle" type="button" @click="toggleBoard"
      :aria-label="onBoard ? 'Foco' : 'Tablero'"
      :title="onBoard ? 'Ver la sesión en foco (g f)' : 'Ver el tablero (g b)'"
      class="inline-flex min-h-10 min-w-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius)] border-0 bg-transparent px-2 font-[inherit] text-sm text-muted hover:bg-surface-raised hover:text-text">
      <Focus v-if="onBoard" class="size-4" /><LayoutGrid v-else class="size-4" />
      <span class="hidden sm:inline">{{ onBoard ? 'Foco' : 'Tablero' }}</span>
    </button>
    <button v-if="canSpawn" data-test="new-session" type="button" aria-label="Nueva sesión" @click="newOpen = true"
      class="inline-flex min-h-10 min-w-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius)] border-0 bg-accent px-2.5 font-[inherit] text-sm font-semibold text-accent-foreground hover:opacity-90">
      <Plus class="size-4" /><span class="hidden sm:inline">Nueva sesión</span>
    </button>
    <NewSessionDialog v-model:open="newOpen" />
    <UserMenu />
  </header>
</template>
