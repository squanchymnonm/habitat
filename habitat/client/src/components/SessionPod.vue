<script setup lang="ts">
import { computed } from 'vue'
import { useSessions } from '../stores/sessions'
import { useProjects } from '../composables/useProjects'
import { useCompactPods } from '../composables/useCompactPods'
import { STATUS_LABEL, type Session } from '../types'
import { ago, faceFor, staminaHue } from '../sprites'
import { send } from '../composables/useSocket'
import MiniArena from './MiniArena.vue'

const props = defineProps<{ session: Session }>()
const store = useSessions()
const { colorForProject } = useProjects()
const { compact } = useCompactPods()
const selected = computed(() => store.selectedId === props.session.id)
const tint = computed(() => {
  const c = colorForProject(props.session.project)
  return c ? { background: `color-mix(in srgb, ${c} 14%, var(--surface))` } : {}
})

const stam = computed(() => Math.max(0, Math.min(100, props.session.stamina ?? 100)))
const stamStyle = computed(() => {
  const h = staminaHue(stam.value)
  return { background: `hsl(${h} 70% 45%)`, boxShadow: `0 0 6px hsl(${h} 70% 45% / .7)` }
})

function select() {
  store.select(props.session.id)
}

const dismissable = computed(
  () => props.session.status === 'waiting' || props.session.status === 'error',
)
function dismiss() {
  if (dismissable.value) send({ type: 'dismiss', id: props.session.id })
}
</script>

<template>
  <div
    class="pod"
    :class="[session.status, { selected, compact }]"
    :style="tint"
    tabindex="0"
    role="button"
    :aria-pressed="selected"
    @click="select"
    @keydown.enter.prevent="select"
    @keydown.space.prevent="select"
  >
    <div class="ring"></div>

    <template v-if="compact">
      <img class="face-mini" :src="faceFor(session.name, session.char)" alt="" />
      <div class="meta">
        <div class="name">{{ session.name }} <span
  class="chip"
  :class="[session.status, { dismissable }]"
  :title="dismissable ? 'marcar como quieta' : ''"
  @click.stop="dismiss"
>{{ STATUS_LABEL[session.status] }}</span></div>
        <div class="repo">{{ session.project }} <span class="br" v-if="session.branch">⌥ {{ session.branch }}</span></div>
      </div>
      <div class="stam">
        <span class="stam-dot" :style="stamStyle" :title="'STAMINA ' + Math.round(stam) + '%'"></span>
        <span class="stam-pct">{{ Math.round(stam) }}%</span>
      </div>
    </template>

    <template v-else>
      <MiniArena :session="session" :height="56" />
      <div class="meta">
        <div class="name">{{ session.name }} <span class="chip" :class="session.status">{{ STATUS_LABEL[session.status] }}</span></div>
        <div class="repo">{{ session.project }} <span class="br" v-if="session.branch">⌥ {{ session.branch }}</span></div>
        <div class="action">{{ session.action }}</div>
        <div class="since">ACTIVA HACE {{ ago(session.since) }}</div>
      </div>
    </template>
  </div>
</template>
