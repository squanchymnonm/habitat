<script setup lang="ts">
import { computed } from 'vue'
import { useLayoutMode } from '../../composables/useLayoutMode'
import { useGlobalShortcuts } from '../../composables/useGlobalShortcuts'
import TopBar from './TopBar.vue'
import SessionNav from '../sessions/SessionNav.vue'

const { mode } = useLayoutMode()
const landscape = computed(() => mode.value === 'landscape')
useGlobalShortcuts()
</script>

<template>
  <div class="flex h-full flex-col bg-background text-text font-ui">
    <TopBar />
    <div :class="landscape ? 'flex min-h-0 flex-1' : 'flex min-h-0 flex-1 flex-col'">
      <SessionNav />
      <main class="min-h-0 min-w-0 flex-1"><RouterView /></main>
    </div>
  </div>
</template>
