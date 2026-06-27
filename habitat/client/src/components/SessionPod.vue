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
  return c ? { background: `color-mix(in srgb, ${c} 14%, var(--color-surface))` } : {}
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
    <div class="stripe" aria-hidden="true"></div>

    <template v-if="compact">
      <img class="face-mini" :src="faceFor(session.name, session.char)" alt="" />
      <div class="meta">
        <div class="name">
          {{ session.name }}
          <span
            class="chip"
            :class="[session.status, { dismissable }]"
            :title="dismissable ? 'marcar como quieta' : ''"
            @click.stop="dismiss"
          >{{ STATUS_LABEL[session.status] }}</span>
        </div>
        <div class="repo">{{ session.project }} <span class="br" v-if="session.branch">⌥ {{ session.branch }}</span></div>
      </div>
      <div class="stam">
        <span class="stam-dot" :style="stamStyle" :title="'STAMINA ' + Math.round(stam) + '%'"></span>
        <span class="stam-pct">{{ Math.round(stam) }}%</span>
      </div>
    </template>

    <template v-else>
      <div class="niche" :class="{ boss: session.monster?.isBoss }">
        <MiniArena :session="session" :height="56" />
      </div>
      <div class="meta">
        <div class="name">{{ session.name }} <span class="chip" :class="session.status">{{ STATUS_LABEL[session.status] }}</span></div>
        <div class="repo">{{ session.project }} <span class="br" v-if="session.branch">⌥ {{ session.branch }}</span></div>
        <div class="action">{{ session.action }}</div>
        <div class="since">activa hace {{ ago(session.since) }}</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ── Pod card ─────────────────────────────────────────────────────────────── */
.pod {
  position: relative;
  border-radius: var(--radius-card, 14px);
  background: linear-gradient(180deg, var(--color-surface-2), var(--color-surface));
  border: 1px solid var(--color-edge);
  box-shadow: var(--shadow-sh1);
  cursor: pointer;
  overflow: hidden;
  transition: transform .12s, border-color .12s, box-shadow .12s;
}

.pod:hover {
  transform: translateY(-2px);
  border-color: var(--color-edge-soft);
  box-shadow: var(--shadow-sh2);
}

.pod:focus-visible {
  outline: 2px solid var(--color-brass);
  outline-offset: 2px;
}

.pod.selected {
  border-color: var(--color-brass-2);
  box-shadow: var(--shadow-sh2), var(--shadow-glow-brass);
}

.pod.working {
  box-shadow: var(--shadow-sh1), 0 0 30px -16px rgba(232,119,58,.7);
}

/* ── State stripe ─────────────────────────────────────────────────────────── */
.pod .stripe {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--color-faint);
  z-index: 5;
}

.pod.working .stripe {
  background: linear-gradient(180deg, var(--color-ember), #b8531f);
}

.pod.waiting .stripe {
  background: linear-gradient(180deg, var(--color-amber), #b89017);
}

.pod.done .stripe {
  background: linear-gradient(180deg, var(--color-moss), #5f8a39);
}

.pod.error .stripe {
  background: linear-gradient(180deg, var(--color-crimson), #8c2e24);
}

.pod.idle .stripe,
.pod.offline .stripe {
  background: var(--color-faint);
  opacity: .45;
}

/* ── Duel niche ───────────────────────────────────────────────────────────── */
.pod .niche {
  position: relative;
  height: 96px;
  margin: 3px 3px 0;
  border-radius: 11px 11px 4px 4px;
  background:
    radial-gradient(120px 80px at 30% 122%, rgba(232,119,58,.2), transparent 70%),
    radial-gradient(140px 90px at 78% 132%, rgba(224,169,75,.1), transparent 70%),
    linear-gradient(180deg, #100B06, #1a130b);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.04),
    inset 0 12px 28px -10px rgba(0,0,0,.9),
    inset 0 -2px 6px rgba(0,0,0,.6);
  overflow: hidden;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  padding: 0 22px 16px;
}

.pod .niche.boss {
  background:
    radial-gradient(140px 90px at 70% 132%, rgba(209,75,60,.22), transparent 70%),
    linear-gradient(180deg, #120a07, #1c0f0a);
}

/* ── Meta block ───────────────────────────────────────────────────────────── */
.pod .meta {
  padding: 11px 15px 14px;
}

.pod .name {
  font-family: var(--font-lore);
  font-weight: 560;
  font-size: 17px;
  letter-spacing: -.01em;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.pod .repo {
  margin-top: 7px;
  font-family: var(--font-machine);
  font-size: 12.5px;
  color: var(--color-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pod .repo .br {
  color: var(--color-brass);
}

.pod .action {
  margin-top: 6px;
  font-family: var(--font-system);
  font-size: 13.5px;
  color: var(--color-ink-2);
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.pod.waiting .action {
  color: var(--color-amber);
}

.pod .since {
  margin-top: 9px;
  font-family: var(--font-machine);
  font-size: 10.5px;
  letter-spacing: .04em;
  color: var(--color-faint);
  text-transform: uppercase;
}

/* ── Status chip ──────────────────────────────────────────────────────────── */
.pod .chip {
  margin-left: auto;
  font-family: var(--font-system);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: .07em;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid;
}

.pod .chip.working {
  color: var(--color-ember);
  background: rgba(232,119,58,.12);
  border-color: rgba(232,119,58,.4);
}

.pod .chip.waiting {
  color: #1b1407;
  background: var(--color-amber);
  border-color: var(--color-amber);
}

.pod .chip.done {
  color: var(--color-moss);
  background: rgba(143,184,92,.12);
  border-color: rgba(143,184,92,.4);
}

.pod .chip.idle {
  color: var(--color-dim);
  background: rgba(174,153,122,.1);
  border-color: var(--color-edge);
}

.pod .chip.error {
  color: var(--color-crimson);
  background: rgba(209,75,60,.12);
  border-color: rgba(209,75,60,.4);
}

.pod .chip.offline {
  color: var(--color-dim);
  background: rgba(174,153,122,.1);
  border-color: var(--color-edge);
  opacity: .65;
}

.pod .chip.dismissable {
  cursor: pointer;
}

/* ── Compact variant ──────────────────────────────────────────────────────── */
.pod.compact {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
}

.pod.compact .stripe {
  /* stripe still present as absolute left bar */
}

.pod.compact .face-mini {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  image-rendering: pixelated;
  border-radius: 6px;
  border: 1px solid var(--color-edge);
  background: var(--color-surface-2);
  object-fit: cover;
}

.pod.compact .meta {
  margin-top: 0;
  flex: 1;
  min-width: 0;
  padding: 0;
}

.pod.compact .name {
  font-size: 13px;
}

.pod.compact .repo {
  margin-top: 2px;
  font-size: 12px;
}

.pod.compact .stam {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 5px;
}

.pod.compact .stam-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.pod.compact .stam-pct {
  font-family: var(--font-machine);
  font-size: 10px;
  color: var(--color-dim);
}
</style>
