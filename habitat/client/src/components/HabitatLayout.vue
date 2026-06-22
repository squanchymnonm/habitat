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

// En narrow el detalle es overlay; se abre al elegir un pod (no en la auto-selección inicial).
const mobileOpen = ref(false)
let firstSelect = true
watch(
  () => store.selectedId,
  (id) => {
    if (firstSelect) { firstSelect = false; return }
    if (isNarrow.value) mobileOpen.value = !!id
  },
)
function closeOverlay() { mobileOpen.value = false }

function refit() { nextTick(() => requestAnimationFrame(() => panel.value?.fit())) }
watch(isNarrow, refit)
function onResize() { refit() }
function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && isNarrow.value && mobileOpen.value) closeOverlay() }
onMounted(() => { window.addEventListener('resize', onResize); document.addEventListener('keydown', onKey) })
onUnmounted(() => { window.removeEventListener('resize', onResize); document.removeEventListener('keydown', onKey) })
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
