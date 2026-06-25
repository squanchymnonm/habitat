<script setup lang="ts">
import { computed } from 'vue'
import { useSessions } from '../stores/sessions'
import { useProjects } from '../composables/useProjects'
import { STATUS_LABEL, type Session } from '../types'
import { ago } from '../sprites'
import MiniArena from './MiniArena.vue'

const props = defineProps<{ session: Session }>()
const store = useSessions()
const { colorForProject } = useProjects()
const selected = computed(() => store.selectedId === props.session.id)
const tint = computed(() => {
  const c = colorForProject(props.session.project)
  return c ? { background: `color-mix(in srgb, ${c} 14%, var(--surface))` } : {}
})

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
    <MiniArena :session="session" :height="56" />
    <div class="meta">
      <div class="name">{{ session.name }} <span class="chip" :class="session.status">{{ STATUS_LABEL[session.status] }}</span></div>
      <div class="repo">{{ session.project }} <span class="br" v-if="session.branch">⌥ {{ session.branch }}</span></div>
      <div class="action">{{ session.action }}</div>
      <div class="since">ACTIVA HACE {{ ago(session.since) }}</div>
    </div>
  </div>
</template>

