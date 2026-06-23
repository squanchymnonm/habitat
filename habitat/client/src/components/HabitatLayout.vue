<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useSessions } from '../stores/sessions'
import { useViewport } from '../composables/useViewport'
import SessionRail from './SessionRail.vue'
import DetailPanel from './DetailPanel.vue'

const store = useSessions()
const { isNarrow } = useViewport()
const panel = ref<InstanceType<typeof DetailPanel> | null>(null)

// Ancho del rail en landscape (px), persistido.
const RAIL_MIN = 280
const RAIL_MAX = 640
const railW = ref(Math.min(RAIL_MAX, Math.max(RAIL_MIN, Number(localStorage.getItem('habitat.railWidth')) || 340)))

function startResize(e: MouseEvent) {
  e.preventDefault()
  const onMove = (m: MouseEvent) => {
    railW.value = Math.min(RAIL_MAX, Math.max(RAIL_MIN, m.clientX))
    panel.value?.fit()
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    localStorage.setItem('habitat.railWidth', String(railW.value))
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// En narrow el detalle es overlay; se abre solo en selección explícita del usuario (selectTick).
const mobileOpen = ref(false)
watch(() => store.selectTick, () => { if (isNarrow.value) mobileOpen.value = true })
function closeOverlay() { mobileOpen.value = false }

function refit() { nextTick(() => requestAnimationFrame(() => panel.value?.fit())) }
watch(isNarrow, refit)
function onResize() { refit() }
function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && isNarrow.value && mobileOpen.value) closeOverlay() }
let mqOrient: MediaQueryList | null = null
onMounted(() => {
  window.addEventListener('resize', onResize)
  document.addEventListener('keydown', onKey)
  mqOrient = window.matchMedia('(orientation: portrait)')
  mqOrient.addEventListener('change', refit)
})
onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  document.removeEventListener('keydown', onKey)
  mqOrient?.removeEventListener('change', refit)
})
</script>

<template>
  <div class="hlayout" :class="isNarrow ? 'narrow' : 'wide'" :style="{ '--rail-w': railW + 'px' }">
    <SessionRail class="hrail crt" />
    <div v-if="!isNarrow" class="hdiv" @mousedown="startResize" aria-hidden="true"></div>
    <div v-if="isNarrow" class="scrim" :class="{ open: mobileOpen }" @click="closeOverlay"></div>
    <div class="hpanelhost" :class="{ open: isNarrow ? mobileOpen : true }">
      <DetailPanel ref="panel" />
    </div>
  </div>
</template>
