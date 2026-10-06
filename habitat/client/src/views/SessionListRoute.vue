<script setup lang="ts">
import { watch } from 'vue'
import { useRouter } from 'vue-router'
import SessionList from '../components/sessions/SessionList.vue'
import EmptySessions from '../components/sessions/EmptySessions.vue'
import { useLayoutMode } from '../composables/useLayoutMode'
import { useSessions } from '../stores/sessions'

// La lista es la pantalla principal sólo en celular; en tablet/escritorio la nav ya está a la vista.
const router = useRouter()
const { mode } = useLayoutMode()
const store = useSessions()
watch(mode, (m) => { if (m !== 'phone') router.replace('/') }, { immediate: true })
</script>

<template>
  <div class="h-full min-h-0">
    <EmptySessions v-if="!store.list.length" />
    <SessionList v-else />
  </div>
</template>
