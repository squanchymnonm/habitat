<script setup lang="ts">
import { useLayoutMode } from '../../composables/useLayoutMode'
import SessionSidebar from './SessionSidebar.vue'
import SessionTabs from './SessionTabs.vue'

// landscape: barra a la izquierda; portrait (y phone, hasta que llegue la lista del PR 3): pestañas arriba.
const { mode } = useLayoutMode()
</script>

<template>
  <SessionSidebar v-if="mode === 'landscape'" />
  <SessionTabs v-else />
</template>
