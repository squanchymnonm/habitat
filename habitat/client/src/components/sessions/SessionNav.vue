<script setup lang="ts">
import { useLayoutMode } from '../../composables/useLayoutMode'
import SessionSidebar from './SessionSidebar.vue'
import SessionTabs from './SessionTabs.vue'

// landscape: barra a la izquierda; portrait: pestañas arriba. En phone, AppShell no monta
// esta nav (la pantalla principal es la lista de sesiones en /sessions).
const { mode } = useLayoutMode()
</script>

<template>
  <SessionSidebar v-if="mode === 'landscape'" />
  <SessionTabs v-else />
</template>
