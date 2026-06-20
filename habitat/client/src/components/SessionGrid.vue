<script setup lang="ts">
import { useSessions } from '../stores/sessions'
import SessionPod from './SessionPod.vue'

const store = useSessions()
</script>

<template>
  <div class="grid">
    <div v-if="!store.list.length" class="empty">
      No hay sesiones abiertas.<br />
      Arrancá una con <code>mono &lt;proyecto&gt;</code> en el server.
    </div>
    <SessionPod v-for="s in store.list" :key="s.id" :session="s" />
  </div>
</template>
