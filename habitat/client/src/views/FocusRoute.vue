<script setup lang="ts">
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import FocusView from '../components/focus/FocusView.vue'
import EmptySessions from '../components/sessions/EmptySessions.vue'
import { useSessions } from '../stores/sessions'
import { useLayoutMode } from '../composables/useLayoutMode'

const store = useSessions()
const route = useRoute()
const router = useRouter()
const { mode } = useLayoutMode()
// En celular la pantalla principal es la lista; el foco sólo con una sesión explícita (#/s/:id).
// La carga inicial la resuelve el router (beforeEnter de '/'); esto cubre la rotación a phone
// con #/ ya montado.
watch(mode, (m) => { if (m === 'phone' && route.name === 'focus') router.replace('/sessions') })
</script>

<template>
  <div class="h-full min-h-0 min-w-0">
    <!-- Estado vacío para todos los modos (landscape/portrait/phone). -->
    <EmptySessions v-if="!store.list.length" />
    <FocusView v-else />
  </div>
</template>
