<script setup lang="ts">
import { computed } from 'vue'
import { useSessions } from '../stores/sessions'
import { useProjects } from '../composables/useProjects'
import { STATUS_LABEL, type Session } from '../types'
import { ago } from '../sprites'
import MiniArena from './MiniArena.vue'

const props = defineProps<{ session: Session }>()
const store = useSessions()
const { canSpawn, kill, colorForProject } = useProjects()
const selected = computed(() => store.selectedId === props.session.id)
const tint = computed(() => {
  const c = colorForProject(props.session.project)
  return c ? { background: `color-mix(in srgb, ${c} 14%, var(--surface))` } : {}
})

function requestClose() {
  if (confirm(`¿Cerrar la sesión "${props.session.name}"? Se perderá el trabajo en curso.`)) {
    kill(props.session.id)
  }
}
function select() {
  store.select(props.session.id)
}
</script>

<template>
  <div
    class="pod"
    :class="[session.status, { selected }]"
    :style="tint"
    tabindex="0"
    role="button"
    :aria-pressed="selected"
    @click="select"
    @keydown.enter="select"
  >
    <div class="ring"></div>
    <button v-if="canSpawn" class="killx" aria-label="cerrar sesión" @click.stop="requestClose">×</button>
    <MiniArena :session="session" :height="56" />
    <div class="meta">
      <div class="name">{{ session.name }} <span class="chip" :class="session.status">{{ STATUS_LABEL[session.status] }}</span></div>
      <div class="repo">{{ session.project }} <span class="br" v-if="session.branch">⌥ {{ session.branch }}</span></div>
      <div class="action">{{ session.action }}</div>
      <div class="since">ACTIVA HACE {{ ago(session.since) }}</div>
    </div>
  </div>
</template>

<style scoped>
.killx {
  position: absolute; top: 6px; left: 8px; width: 20px; height: 20px; border-radius: 5px;
  background: #5a1f1f; border: 1px solid #a44; color: #f9c; font-size: 13px; line-height: 16px;
  cursor: pointer; opacity: 0; transition: opacity 0.12s; z-index: 5;
}
.pod:hover .killx, .pod:focus-within .killx { opacity: 1; }
</style>
