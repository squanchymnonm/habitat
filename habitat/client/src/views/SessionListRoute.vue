<script setup lang="ts">
import { watch } from 'vue'
import { useRouter } from 'vue-router'
import SessionList from '../components/sessions/SessionList.vue'
import { useLayoutMode } from '../composables/useLayoutMode'
import { useSessions } from '../stores/sessions'
import { useProjects } from '../composables/useProjects'

// La lista es la pantalla principal sólo en celular; en tablet/escritorio la nav ya está a la vista.
const router = useRouter()
const { mode } = useLayoutMode()
const store = useSessions()
const { canSpawn } = useProjects()
watch(mode, (m) => { if (m !== 'phone') router.replace('/') }, { immediate: true })
</script>

<template>
  <div class="h-full min-h-0">
    <div v-if="!store.list.length" data-test="empty-sessions" class="flex h-full items-center justify-center p-6">
      <p class="m-0 max-w-sm text-center text-sm text-muted">
        No hay sesiones abiertas.<br />
        <template v-if="canSpawn">Creá una con el botón <b class="text-text">+</b> de la barra de arriba.</template>
        <template v-else>Arrancá una con <code class="font-mono text-text">mono &lt;proyecto&gt;</code> en el server.</template>
      </p>
    </div>
    <SessionList v-else />
  </div>
</template>
