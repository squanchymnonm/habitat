<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSessions } from '../stores/sessions'
import { STATUS_LABEL, type FightResult } from '../types'
import { faceFor, ago, fmt } from '../sprites'
import { useTerminal } from '../composables/useTerminal'
import { useProjects } from '../composables/useProjects'

const store = useSessions()
const { canSpawn, kill } = useProjects()
const selectedId = computed(() => store.selected?.id ?? null)
const termEl = ref<HTMLElement | null>(null)
const { fit } = useTerminal(termEl, selectedId)

function closeSession() {
  const s = store.selected
  if (!s) return
  if (confirm(`¿Cerrar la sesión "${s.name}"? Se perderá el trabajo en curso.`)) kill(s.id)
}

// Overlay de loot al vencer — solo para la sesión enfocada.
const lootShown = ref(false)
const loot = ref<FightResult | null>(null)
watch(
  () => store.lastFight,
  (lf) => {
    if (lf && lf.id === store.selected?.id) {
      loot.value = lf.result
      lootShown.value = true
      setTimeout(() => (lootShown.value = false), 2600)
    }
  },
)

defineExpose({ fit })
</script>

<template>
  <div class="dpanel">
    <template v-if="store.selected">
      <div class="dhead crt">
        <img class="face" :src="faceFor(store.selected.name, store.selected.char)" alt="" />
        <div class="dinfo">
          <div class="dname">
            {{ store.selected.name }}
            <span class="chip" :class="store.selected.status">{{ STATUS_LABEL[store.selected.status] }}</span>
          </div>
          <div class="repo">{{ store.selected.project }} <span class="br" v-if="store.selected.branch">⌥ {{ store.selected.branch }}</span></div>
          <div class="action">{{ store.selected.action }}</div>
          <div class="since">ACTIVA HACE {{ ago(store.selected.since) }}</div>
        </div>
        <button v-if="canSpawn" class="killsession" @click="closeSession">✕ CERRAR</button>
      </div>
      <div ref="termEl" class="term" aria-label="terminal de la sesión"></div>
      <div class="dloot" :class="{ show: lootShown }" v-if="loot">
        <div class="ttl">★ VENCIDO ★</div>
        <div class="mn">{{ loot.monster }}</div>
        <div class="stat">HP <b>{{ fmt(loot.hp) }}</b> · {{ loot.hits }} golpes</div>
        <div class="lootline">LOOT: <span>{{ loot.loot.join(', ') }}</span></div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.killsession {
  align-self: flex-start; background: #5a1f1f; border: 1px solid #a44; color: #f9c;
  font-family: var(--f-ui); font-size: 11px; padding: 6px 10px; border-radius: 6px; cursor: pointer; white-space: nowrap;
}
.killsession:hover { background: #7a2a2a; }
</style>
