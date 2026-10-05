<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useZoom } from '../composables/useZoom'
import DetailPanel from '../components/DetailPanel.vue'

const host = ref<HTMLElement | null>(null)
const panel = ref<InstanceType<typeof DetailPanel> | null>(null)
const { zoom } = useZoom()
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
    <DetailPanel ref="panel" />
  </div>
</template>
