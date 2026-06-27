<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted, computed } from 'vue'
import { useSessions } from '../stores/sessions'
import { useViewport } from '../composables/useViewport'
import { useCompactPods } from '../composables/useCompactPods'
import SessionRail from './SessionRail.vue'
import DetailPanel from './DetailPanel.vue'

const store = useSessions()
const { isNarrow } = useViewport()
const { compact } = useCompactPods()
const panel = ref<InstanceType<typeof DetailPanel> | null>(null)

// Ancho del rail (px), persistido. En modo compacto usamos una clave y un
// mínimo más chicos (tablet landscape) sin pisar el ancho del modo normal.
const NORMAL = { key: 'habitat.railWidth', min: 280, max: 640, def: 340 }
const COMPACT = { key: 'habitat.railWidthCompact', min: 180, max: 360, def: 210 }
const cfg = computed(() => (compact.value ? COMPACT : NORMAL))

function loadW(c: { key: string; min: number; max: number; def: number }) {
  return Math.min(c.max, Math.max(c.min, Number(localStorage.getItem(c.key)) || c.def))
}
const railWNormal = ref(loadW(NORMAL))
const railWCompact = ref(loadW(COMPACT))
const railW = computed(() => (compact.value ? railWCompact.value : railWNormal.value))

function startResize(e: MouseEvent) {
  e.preventDefault()
  const c = cfg.value
  const target = compact.value ? railWCompact : railWNormal
  const onMove = (m: MouseEvent) => {
    target.value = Math.min(c.max, Math.max(c.min, m.clientX))
    panel.value?.fit()
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    localStorage.setItem(c.key, String(target.value))
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
watch(compact, refit)
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
