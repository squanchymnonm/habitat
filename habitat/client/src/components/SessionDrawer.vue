<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useSessions } from '../stores/sessions'
import { STATUS_LABEL } from '../types'
import { faceFor, ago } from '../sprites'
import { usePreview } from '../composables/usePreview'
import ChatPanel from './ChatPanel.vue'

const store = useSessions()
const selectedId = computed(() => store.selected?.id ?? null)
const { lines: preview, loading: previewLoading } = usePreview(selectedId)
function close() {
  store.select(null)
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}
onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => document.removeEventListener('keydown', onKey))
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
          <div class="repo">{{ store.selected.project }} <span class="br">⌥ {{ store.selected.branch }}</span></div>
        </div>
        <button class="closex" aria-label="cerrar" @click="close">×</button>
      </div>
      <div class="dmeta">
        <div class="action">{{ store.selected.action }}</div>
        <div class="since">ACTIVA HACE {{ ago(store.selected.since) }}</div>
      </div>
      <pre class="term" aria-label="terminal de la sesión">{{ preview || (previewLoading ? '…' : '(sin tmux)') }}</pre>
      <ChatPanel :session="store.selected" />
    </template>
  </aside>
</template>
