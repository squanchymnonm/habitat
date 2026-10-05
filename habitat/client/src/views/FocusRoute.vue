<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useZoom } from '../composables/useZoom'
import DetailPanel from '../components/DetailPanel.vue'
import { useSessions } from '../stores/sessions'
import { useProjects } from '../composables/useProjects'

const host = ref<HTMLElement | null>(null)
const panel = ref<InstanceType<typeof DetailPanel> | null>(null)
const { zoom } = useZoom()
const store = useSessions()
// Sólo si el server permite spawnear tiene sentido apuntar al botón "+ Nueva sesión".
const { canSpawn } = useProjects()
const refit = () => nextTick(() => requestAnimationFrame(() => panel.value?.fit()))
let ro: ResizeObserver | null = null
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && host.value) { ro = new ResizeObserver(refit); ro.observe(host.value) }
})
onUnmounted(() => ro?.disconnect())
// Cambiar el zoom del root no dispara resize: re-fitear a mano.
watch(zoom, refit)
</script>

<template>
  <div ref="host" class="h-full min-h-0 min-w-0">
    <!-- Estado vacío para todos los modos (landscape/portrait/phone). -->
    <div v-if="!store.list.length" data-test="empty-sessions" class="flex h-full items-center justify-center p-6">
      <p class="max-w-sm text-center text-sm text-muted">
        No hay sesiones abiertas.<br />
        <template v-if="canSpawn">Creá una con el botón <b class="text-text">+</b> (Nueva sesión) de la barra de arriba.</template>
        <template v-else>Arrancá una con <code class="font-mono text-text">mono &lt;proyecto&gt;</code> en el server.</template>
      </p>
    </div>
    <DetailPanel v-else ref="panel" />
  </div>
</template>
