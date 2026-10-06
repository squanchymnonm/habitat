<script setup lang="ts">
import { computed } from 'vue'
import { useLayoutMode } from '../../composables/useLayoutMode'
import { useGlobalShortcuts } from '../../composables/useGlobalShortcuts'
import { useSessions } from '../../stores/sessions'
import TopBar from './TopBar.vue'
import SessionNav from '../sessions/SessionNav.vue'

const { mode } = useLayoutMode()
const store = useSessions()
const landscape = computed(() => mode.value === 'landscape')
// En celular la navegación es la lista (pantalla principal); sin sesiones no hay nada que navegar.
const showNav = computed(() => mode.value !== 'phone' && store.list.length > 0)
useGlobalShortcuts()
</script>

<template>
  <div class="flex h-full flex-col bg-background text-text font-ui">
    <TopBar />
    <div :class="landscape ? 'flex min-h-0 flex-1' : 'flex min-h-0 flex-1 flex-col'">
      <SessionNav v-if="showNav" />
      <main class="min-h-0 min-w-0 flex-1"><RouterView /></main>
    </div>
  </div>
</template>
