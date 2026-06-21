<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useSessions } from '../stores/sessions'
import { STATUS_LABEL } from '../types'
import { faceFor, ago } from '../sprites'
import { useTerminal } from '../composables/useTerminal'

const store = useSessions()
const selectedId = computed(() => store.selected?.id ?? null)
const termEl = ref<HTMLElement | null>(null)
const { fit } = useTerminal(termEl, selectedId)

function close() {
  store.select(null)
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && !store.selected) return
}
onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => document.removeEventListener('keydown', onKey))
defineExpose({ fit })
</script>

<template>
  <div class="scrim" :class="{ open: store.selected }" @click="close"></div>
  <aside class="drawer" :class="{ open: store.selected }" :aria-hidden="!store.selected">
    <template v-if="store.selected">
      <div class="dhead">
        <img class="face" :src="faceFor(store.selected.name)" alt="" />
        <div class="dinfo">
          <div class="dname">
            {{ store.selected.name }}
            <span class="chip" :class="store.selected.status">{{ STATUS_LABEL[store.selected.status] }}</span>
          </div>
          <div class="repo">{{ store.selected.project }} <span class="br" v-if="store.selected.branch">⌥ {{ store.selected.branch }}</span></div>
        </div>
        <button class="closex" aria-label="cerrar" @click="close">×</button>
      </div>
      <div class="dmeta">
        <div class="action">{{ store.selected.action }}</div>
        <div class="since">ACTIVA HACE {{ ago(store.selected.since) }}</div>
      </div>
      <div ref="termEl" class="term" aria-label="terminal de la sesión"></div>
    </template>
  </aside>
</template>
