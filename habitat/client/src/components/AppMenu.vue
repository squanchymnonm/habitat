<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useCompactPods } from '../composables/useCompactPods'

type View = 'sessions' | 'settings'
defineProps<{ view: View }>()
const emit = defineEmits<{ 'update:view': [v: View] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const { logout } = useAuth()
const { compact, toggleCompact } = useCompactPods()

function pickView(v: View) { emit('update:view', v); open.value = false }
function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') open.value = false }
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="app-menu-root" ref="root">
    <button class="hamburger ctl" @click="open = !open" :aria-expanded="open" aria-label="Menú">☰</button>
    <div class="app-menu" v-if="open">
      <div class="brand"><b>EL MONO<span class="dot">.</span></b><small>HÁBITAT · SERVER</small></div>
      <button class="ctl" :class="{ active: view === 'sessions' }" @click="pickView('sessions')">Sesiones</button>
      <button class="ctl" :class="{ active: view === 'settings' }" @click="pickView('settings')">⚙ Settings</button>
      <button class="ctl" :class="{ active: compact }" @click="toggleCompact" title="Pods compactos">▭ Compacto</button>
      <button class="ctl" @click="logout">Salir</button>
    </div>
  </div>
</template>

<style scoped>
.app-menu .ctl.active { background: var(--gold); color: #2a1c0a; }
.app-menu .brand { margin-bottom: 4px; }
</style>
