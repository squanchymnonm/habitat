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

// La rueda del mouse scrollea el riel de pods en el eje que tenga overflow.
// En modo horizontal (portrait wide) el navegador no scrollea solo con deltaY,
// así que traducimos el delta vertical a scroll horizontal.
function onWheel(e: WheelEvent) {
  const el = e.currentTarget as HTMLElement
  const canScrollY = el.scrollHeight > el.clientHeight
  const canScrollX = el.scrollWidth > el.clientWidth
  const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX
  if (canScrollY) {
    el.scrollTop += delta
    e.preventDefault()
  } else if (canScrollX) {
    el.scrollLeft += delta
    e.preventDefault()
  }
}
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
    @wheel="onWheel"
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
