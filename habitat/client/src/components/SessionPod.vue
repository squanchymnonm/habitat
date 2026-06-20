<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useSessions } from '../stores/sessions'
import { STATUS_LABEL, type Session, type FightResult } from '../types'
import { heroIdle, monsterSprite, bossSprite, fmt, ago } from '../sprites'
import Sprite from './Sprite.vue'

const props = defineProps<{ session: Session }>()
const store = useSessions()

const monster = computed(() => props.session.monster ?? null)
const monsterUrl = computed(() =>
  monster.value ? (monster.value.isBoss ? bossSprite(monster.value.label) : monsterSprite(monster.value.type)) : '',
)
const stam = computed(() => Math.max(0, Math.min(100, props.session.stamina ?? 100)))
const stamColor = computed(() => (stam.value > 50 ? 'var(--green)' : stam.value > 20 ? 'var(--gold)' : 'var(--red)'))
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
    <div class="stage" :class="{ needs: session.status === 'waiting' }">
      <div class="pcount" v-if="counter">{{ counter }}</div>
      <div class="bubble" v-if="session.status === 'waiting'">¡te necesita!</div>
      <div class="gfloor"></div>
      <Sprite
        class="fighter phero"
        :class="{ flinch }"
        :src="heroIdle(session.name)"
        :height="88"
        mode="static"
        :frame="monster ? 3 : 0"
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
        <div class="ttl">★ VENCIDO ★</div>
        <div class="mn">{{ loot.monster }}</div>
        <div class="stat">HP <b>{{ fmt(loot.hp) }}</b> · {{ loot.hits }} golpes</div>
        <div class="lootline">LOOT: <span>{{ loot.loot.join(', ') }}</span></div>
      </div>
    </div>
    <div class="pstam"><i :style="{ width: stam + '%', background: stamColor }"></i><span class="lbl">STAMINA {{ stam }}%</span></div>
    <div class="meta">
      <div class="name">{{ session.name }} <span class="chip" :class="session.status">{{ STATUS_LABEL[session.status] }}</span></div>
      <div class="repo">{{ session.project }} <span class="br">⌥ {{ session.branch }}</span></div>
      <div class="action">{{ session.action }}</div>
      <div class="since">ACTIVA HACE {{ ago(session.since) }}</div>
    </div>
  </div>
</template>
