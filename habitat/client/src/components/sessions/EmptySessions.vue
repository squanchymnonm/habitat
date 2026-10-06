<script setup lang="ts">
import { useProjects } from '../../composables/useProjects'

// Estado vacío compartido por FocusRoute y SessionListRoute (foco y lista del celular).
const { canSpawn } = useProjects()
</script>

<template>
  <div data-test="empty-sessions" class="flex h-full items-center justify-center p-6">
    <p class="m-0 max-w-sm text-center text-sm text-muted">
      No hay sesiones abiertas.<br />
      <template v-if="canSpawn">Creá una con el botón <b class="text-text">+</b> (Nueva sesión) de la barra de arriba.</template>
      <template v-else>Arrancá una con <code class="font-mono text-text">mono &lt;proyecto&gt;</code> en el server.</template>
    </p>
  </div>
</template>
