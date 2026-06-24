<script setup lang="ts">
import { computed } from 'vue'
import draggable from 'vuedraggable'
import { useSessions } from '../stores/sessions'
import { postOrder } from '../composables/useSessionOrder'
import type { Session } from '../types'
import SessionPod from './SessionPod.vue'

const store = useSessions()

// vuedraggable v-model: al soltar nos entrega el nuevo orden. Lo aplicamos local
// (optimista) y lo persistimos; el broadcast WS sincroniza otros clientes.
const draggableList = computed<Session[]>({
  get: () => store.list,
  set: (val) => {
    const ids = val.map((s) => s.id)
    store.reorder(ids)
    postOrder(ids)
  },
})
</script>

<template>
  <draggable
    class="rail"
    tag="div"
    v-model="draggableList"
    item-key="id"
    :animation="150"
    :delay="200"
    :delay-on-touch-only="true"
    ghost-class="pod-ghost"
  >
    <template #header>
      <div v-if="!store.list.length" class="empty">
        No hay sesiones abiertas.<br />
        Arrancá una con <code>mono &lt;proyecto&gt;</code> en el server.
      </div>
    </template>
    <template #item="{ element }">
      <SessionPod :session="element" />
    </template>
  </draggable>
</template>
