<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useSessions } from '../stores/sessions'
import { useProjects } from '../composables/useProjects'
import { STATUS_LABEL, type Session, type Status, type FightResult } from '../types'
import { heroIdle, heroAnim, monsterSprite, bossSprite, fmt, ago } from '../sprites'
import Sprite from './Sprite.vue'
import StaminaOrb from './StaminaOrb.vue'

const props = defineProps<{ session: Session }>()
const store = useSessions()
const { canSpawn, kill } = useProjects()
function requestClose() {
  if (confirm(`¿Cerrar la sesión "${props.session.name}"? Se perderá el trabajo en curso.`)) {
    kill(props.session.id)
  }
}

// Emote (globo de diálogo) que comunica el estado del personaje.
const EMOTE: Partial<Record<Status, number>> = {
  waiting: 22, // "!" rojo — necesita tu atención
  working: 20, // "..." — pensando/trabajando
  done: 29, // estrella — dungeon cleared
  error: 26, // corazón roto — algo falló
  offline: 30, // cruz — caída
}
const emote = computed(() => EMOTE[props.session.status] ?? null)
const emoteUrl = computed(() => (emote.value ? `assets/emote/${emote.value}.png` : ''))

const monster = computed(() => props.session.monster ?? null)
const monsterUrl = computed(() =>
  monster.value ? (monster.value.isBoss ? bossSprite(monster.value.label) : monsterSprite(monster.value.type)) : '',
)
const stam = computed(() => Math.max(0, Math.min(100, props.session.stamina ?? 100)))
const counter = computed(() => {
  const q = props.session.quest
  return q && q.total ? `${q.done + (monster.value ? 1 : 0)}/${q.total}` : ''
})

// número de daño flotante cuando sube combat.tokens
const floats = ref<{ key: number; text: string; big: boolean }[]>([])
let fkey = 0
let lastTokens = props.session.combat?.tokens ?? 0
watch(
  () => props.session.combat?.tokens ?? 0,
  (tok) => {
    const dmg = props.session.combat?.lastDamage
    if (tok > lastTokens && dmg) {
      const key = ++fkey
      floats.value.push({ key, text: fmt(dmg), big: !!monster.value?.isBoss })
      setTimeout(() => (floats.value = floats.value.filter((f) => f.key !== key)), 850)
    }
    lastTokens = tok
  },
)

// flinch del héroe en error
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

// overlay de loot al vencer (fightResult)
const lootShown = ref(false)
const dying = ref(false)
const loot = ref<FightResult | null>(null)
watch(
  () => store.lastFight,
  (lf) => {
    if (lf && lf.id === props.session.id) {
      loot.value = lf.result
      lootShown.value = true
      dying.value = true
      setTimeout(() => {
        lootShown.value = false
        dying.value = false
      }, 2600)
    }
  },
)

function select() {
  store.select(props.session.id)
}
</script>

<template>
  <div class="pod" :class="session.status" tabindex="0" role="button" @click="select" @keydown.enter="select">
    <div class="ring"></div>
    <div class="badge ok">✓</div>
    <div class="badge err">!</div>
    <button v-if="canSpawn" class="killx" aria-label="cerrar sesión" @click.stop="requestClose">×</button>
    <div class="stage">
      <div class="pcount" v-if="counter">{{ counter }}</div>
      <div class="stamina-slot"><StaminaOrb :value="stam" /></div>
      <div class="gfloor"></div>
      <div
        v-if="emoteUrl"
        class="pemote"
        :class="{ alert: session.status === 'waiting' }"
        :style="{ backgroundImage: `url(${emoteUrl})` }"
      ></div>
      <Sprite
        v-if="monster"
        class="fighter phero"
        :class="{ flinch }"
        :src="heroIdle(session.name, session.char)"
        :height="88"
        mode="static"
        :frame="3"
      />
      <Sprite
        v-else
        class="fighter phero"
        :class="{ flinch, dim: session.status === 'offline' }"
        :key="session.status"
        :src="heroAnim(session.name, session.char, session.status)"
        :height="88"
        mode="strip"
        :duration="900"
      />
      <Sprite
        v-if="monster"
        :key="monsterUrl"
        class="fighter pmon"
        :class="{ boss: monster.isBoss, dying }"
        :src="monsterUrl"
        :height="monster.isBoss ? 124 : 88"
        :mode="monster.isBoss ? 'strip' : 'grid'"
        :dir="2"
      />
      <div class="pmonname" v-if="monster">{{ monster.label }}{{ monster.isBoss ? '  (BOSS)' : '' }}</div>
      <div v-for="d in floats" :key="d.key" class="pdmg" :class="{ big: d.big }" :style="{ right: '16%', top: '34px' }">
        -{{ d.text }}
      </div>
      <div class="ploot" :class="{ show: lootShown }" v-if="loot">
        <div class="chest"></div>
        <div class="ttl">★ VENCIDO ★</div>
        <div class="mn">{{ loot.monster }}</div>
        <div class="stat">HP <b>{{ fmt(loot.hp) }}</b> · {{ loot.hits }} golpes</div>
        <div class="lootline">LOOT: <span>{{ loot.loot.join(', ') }}</span></div>
      </div>
    </div>
    <div class="meta">
      <div class="name">{{ session.name }} <span class="chip" :class="session.status">{{ STATUS_LABEL[session.status] }}</span></div>
      <div class="repo">{{ session.project }} <span class="br" v-if="session.branch">⌥ {{ session.branch }}</span></div>
      <div class="action">{{ session.action }}</div>
      <div class="since">ACTIVA HACE {{ ago(session.since) }}</div>
    </div>
  </div>
</template>

<style scoped>
.stamina-slot {
  position: absolute;
  top: 6px;
  right: 8px;
  z-index: 3;
}
.pemote {
  position: absolute;
  left: 6%;
  top: 26px;
  width: 34px;
  height: 32px;
  background-repeat: no-repeat;
  background-size: 34px 32px;
  image-rendering: pixelated;
  z-index: 4;
}
.pemote.alert {
  animation: emoteBounce 0.7s steps(2) infinite;
}
@keyframes emoteBounce {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-6px);
  }
}
.killx {
  position: absolute;
  top: 6px;
  left: 8px;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  background: #5a1f1f;
  border: 1px solid #a44;
  color: #f9c;
  font-size: 13px;
  line-height: 16px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s;
  z-index: 5;
}
.pod:hover .killx,
.pod:focus-within .killx {
  opacity: 1;
}
.chest {
  width: 64px;
  height: 28px;
  margin-bottom: 4px;
  background: url('/assets/ui/chest.png') no-repeat center;
  background-size: 64px 28px;
  image-rendering: pixelated;
}
.phero.dim {
  filter: grayscale(1) brightness(0.6);
}
</style>
