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
    <button class="hamburger" @click="open = !open" :aria-expanded="open" aria-label="Menú">☰</button>
    <span class="wordmark">Hábita<span class="em">t</span></span>
    <div class="app-menu" v-if="open">
      <button class="mi" :class="{ active: view === 'sessions' }" @click="pickView('sessions')">Sesiones</button>
      <button class="mi" :class="{ active: view === 'settings' }" @click="pickView('settings')">⚙ Ajustes</button>
      <button class="mi" :class="{ active: compact }" @click="toggleCompact" title="Pods compactos">▭ Compacto</button>
      <button class="mi" @click="logout">Salir</button>
    </div>
  </div>
</template>

<style scoped>
.app-menu-root{ position:relative; display:flex; align-items:center; gap:12px; }
.hamburger{ display:grid; place-items:center; width:38px; height:38px; font-size:16px; cursor:pointer;
  background:var(--color-surface-2); color:var(--color-ink-2); border:1px solid var(--color-edge); border-radius:9px; }
.hamburger:hover{ border-color:var(--color-brass-2); color:var(--color-brass); }
.hamburger:focus-visible{ outline:2px solid var(--color-brass); outline-offset:2px; }
.wordmark{ font-family:var(--font-lore); font-weight:560; font-size:22px; letter-spacing:-.01em; color:var(--color-ink); }
.wordmark .em{ color:var(--color-brass); text-shadow:0 0 18px rgba(224,169,75,.4); }
.app-menu{ position:absolute; top:calc(100% + 8px); left:0; z-index:10; min-width:200px;
  display:flex; flex-direction:column; gap:6px; padding:10px;
  background:linear-gradient(180deg,#2c2012,#190f07); border:1px solid var(--color-edge);
  border-radius:12px; box-shadow:var(--shadow-sh2); }
.mi{ text-align:left; padding:9px 11px; border-radius:8px; font-size:13px; cursor:pointer;
  background:var(--color-surface-2); color:var(--color-ink); border:1px solid var(--color-edge); }
.mi:hover{ border-color:var(--color-brass-2); color:var(--color-brass); }
.mi.active{ background:var(--color-brass); color:#2a1c0a; border-color:var(--color-brass); }
</style>
