<script setup lang="ts">
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import FocusView from '../components/focus/FocusView.vue'
import { useSessions } from '../stores/sessions'
import { useProjects } from '../composables/useProjects'
import { useLayoutMode } from '../composables/useLayoutMode'

const store = useSessions()
// Sólo si el server permite spawnear tiene sentido apuntar al botón "+ Nueva sesión".
const { canSpawn } = useProjects()
const route = useRoute()
const router = useRouter()
const { mode } = useLayoutMode()
// En celular la pantalla principal es la lista; el foco sólo con una sesión explícita (#/s/:id).
watch([mode, () => route.name], ([m, name]) => { if (m === 'phone' && name === 'focus') router.replace('/sessions') }, { immediate: true })
</script>

<template>
  <div class="h-full min-h-0 min-w-0">
    <!-- Estado vacío para todos los modos (landscape/portrait/phone). -->
    <div v-if="!store.list.length" data-test="empty-sessions" class="flex h-full items-center justify-center p-6">
      <p class="max-w-sm text-center text-sm text-muted">
        No hay sesiones abiertas.<br />
        <template v-if="canSpawn">Creá una con el botón <b class="text-text">+</b> (Nueva sesión) de la barra de arriba.</template>
        <template v-else>Arrancá una con <code class="font-mono text-text">mono &lt;proyecto&gt;</code> en el server.</template>
      </p>
    </div>
    <FocusView v-else />
  </div>
</template>
