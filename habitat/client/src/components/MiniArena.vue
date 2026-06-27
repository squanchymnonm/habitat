<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Session, Status } from '../types'
import { heroSprite, heroPoseFor, POSE_RENDER, monsterSprite, bossSprite, fmt } from '../sprites'
import GameSprite from './GameSprite.vue'
import { useSessions } from '../stores/sessions'
import { send } from '../composables/useSocket'

const props = withDefaults(defineProps<{ session: Session; height?: number }>(), { height: 56 })

const store = useSessions()
// pose transitoria: saltito al ganar
const celebrating = ref(false)

// Emote (globo) que comunica el estado del personaje.
const EMOTE: Partial<Record<Status, number>> = {
  waiting: 22, working: 20, done: 29, error: 26, offline: 30,
}
const emote = computed(() => EMOTE[props.session.status] ?? null)
const emoteUrl = computed(() => (emote.value ? `assets/emote/${emote.value}.png` : ''))
// El globo es clickeable solo cuando la sesión pide atención: descarta la alerta a 'quieta'.
const dismissable = computed(
  () => props.session.status === 'waiting' || props.session.status === 'error',
)
function dismiss() {
  if (dismissable.value) send({ type: 'dismiss', id: props.session.id })
}

const monster = computed(() => props.session.monster ?? null)
const monsterUrl = computed(() =>
  monster.value ? (monster.value.isBoss ? bossSprite(monster.value.label) : monsterSprite(monster.value.type)) : '',
)
const monH = computed(() => Math.round(props.height * (monster.value?.isBoss ? 1.25 : 1)))
const stam = computed(() => Math.max(0, Math.min(100, props.session.stamina ?? 100)))
const stamColor = computed(() => (stam.value > 50 ? 'green' : stam.value > 20 ? 'yellow' : 'red'))

// Número de daño flotante + golpe del héroe cuando sube combat.tokens.
const floats = ref<{ key: number; text: string; big: boolean }[]>([])
let fkey = 0
let lastTokens = props.session.combat?.tokens ?? 0
// attacking: true durante el golpe (frame 1 de anim_combat); fuera de eso el héroe queda en idle.
const attacking = ref(false)
let atkTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => props.session.combat?.tokens ?? 0,
  (tok) => {
    const dmg = props.session.combat?.lastDamage
    if (tok > lastTokens && dmg) {
      const key = ++fkey
      floats.value.push({ key, text: fmt(dmg), big: !!monster.value?.isBoss })
      setTimeout(() => (floats.value = floats.value.filter((f) => f.key !== key)), 850)
      attacking.value = true
      if (atkTimer) clearTimeout(atkTimer)
      atkTimer = setTimeout(() => (attacking.value = false), 300)
    }
    lastTokens = tok
  },
)

// Flinch del héroe en error.
const flinch = ref(false)
watch(
  () => props.session.status,
  (st) => {
    if (st === 'error') {
      flinch.value = true
      setTimeout(() => (flinch.value = false), 700)
    }
  },
)

// Saltito de victoria cuando esta sesión vence a su monstruo.
watch(
  () => store.lastFight,
  (lf) => {
    if (lf && lf.id === props.session.id) {
      celebrating.value = true
      setTimeout(() => (celebrating.value = false), 1200)
    }
  },
)

// pose final del héroe: precedencia estado+combate (ver sprites.heroPoseFor)
const pose = computed(() =>
  heroPoseFor({
    status: props.session.status,
    inCombat: !!monster.value,
    celebrating: celebrating.value,
  }),
)
const render = computed(() => POSE_RENDER[pose.value])
const heroSrc = computed(() => heroSprite(props.session.name, props.session.char, pose.value))
// En combate: frame 1 (golpe) mientras attacking, si no frame 0 (idle a la derecha).
const heroFrame = computed(() =>
  pose.value === 'combat' && attacking.value ? 1 : render.value.frame ?? 0,
)
</script>

<template>
  <div class="mini" :style="{ height: height + 'px' }">
    <div
      v-if="emoteUrl"
      class="pemote"
      :class="{ alert: session.status === 'waiting', dismissable }"
      :style="{ backgroundImage: `url(${emoteUrl})` }"
      :title="dismissable ? 'marcar como quieta' : ''"
      @click.stop="dismiss"
    ></div>
    <GameSprite
      class="fighter phero"
      :class="{ flinch }"
      :src="heroSrc"
      :height="height"
      :mode="render.mode"
      :frame="heroFrame"
      :duration="render.duration ?? 900"
    />
    <GameSprite
      v-if="monster"
      :key="monsterUrl"
      class="fighter pmon"
      :class="{ boss: monster.isBoss }"
      :src="monsterUrl"
      :height="monH"
      :mode="monster.isBoss ? 'strip' : 'grid'"
      :dir="2"
    />
    <div v-for="d in floats" :key="d.key" class="pdmg" :class="{ big: d.big }">-{{ d.text }}</div>
    <div class="stamina-bar" :title="'STAMINA ' + Math.round(stam) + '%'">
      <div class="stamina-track">
        <div class="stamina-fill" :class="stamColor" :style="{ width: stam + '%' }"></div>
      </div>
      <span class="stamina-pct">{{ Math.round(stam) }}%</span>
    </div>
  </div>
</template>

<style scoped>
.mini {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 6px;
  padding: 0 4px 11px;
}
.fighter { image-rendering: pixelated; background-repeat: no-repeat; }
.pmon { align-self: flex-end; }
.stamina-bar { position:absolute; left:4px; right:4px; bottom:1px; height:9px; display:flex; align-items:center; gap:4px; z-index:3; pointer-events:none; }
.stamina-track { flex:1; height:6px; border:1px solid var(--color-line); background:#0b0805; border-radius:3px; overflow:hidden; box-shadow:inset 0 0 0 1px rgba(0,0,0,.5); }
.stamina-fill { height:100%; transition:width .4s steps(8); }
.stamina-fill.green { background:linear-gradient(90deg,#6f9e44,var(--color-moss)); }
.stamina-fill.yellow { background:linear-gradient(90deg,#b8902a,var(--color-brass)); }
.stamina-fill.red { background:linear-gradient(90deg,#8a2f24,var(--color-crimson)); }
.stamina-pct { flex:0 0 auto; font-family:var(--font-machine); font-size:9px; line-height:1; color:var(--color-dim); }
.pemote {
  position: absolute; left: 0; top: -4px; width: 26px; height: 24px;
  background-repeat: no-repeat; background-size: 26px 24px; image-rendering: pixelated; z-index: 4;
}
.pemote.alert { animation: emoteBounce 0.7s steps(2) infinite; }
.pemote.dismissable { cursor: pointer; }
@keyframes emoteBounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
.pdmg { position:absolute; right:18%; top:0; font-family:var(--font-machine); font-weight:600; font-size:12px; color:var(--color-amber); text-shadow:0 1px 3px #000; pointer-events:none; white-space:nowrap; animation:bdmgfloat .85s ease-out forwards; }
.pdmg.big { font-size:15px; color:#fff; }
.phero.flinch { animation: bflinch 0.3s steps(2) 2; }
</style>
