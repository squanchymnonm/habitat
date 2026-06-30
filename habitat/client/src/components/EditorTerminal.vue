<script setup lang="ts">
import { ref } from 'vue'
import { useTerminal } from '../composables/useTerminal'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const termEl = ref<HTMLElement | null>(null)
const idRef = ref<string>(props.id)
useTerminal(termEl, idRef, { role: 'edit' })
</script>

<template>
  <div class="ed-overlay">
    <header class="ed-head">
      <span class="ed-title">✎ Editor — nvim</span>
      <button class="ed-x" @click="emit('close')" title="Cerrar (nvim sigue vivo)">✕</button>
    </header>
    <div ref="termEl" class="ed-term"></div>
  </div>
</template>

<style scoped>
.ed-overlay { position: absolute; inset: 0; background: var(--color-base, #1a1410); display: flex; flex-direction: column; z-index: 7; }
.ed-head { display: flex; align-items: center; justify-content: space-between; padding: .4rem .7rem; border-bottom: 1px solid var(--color-line, #3a2e22); color: var(--color-ink, #e8dcc0); }
.ed-title { font-weight: 700; }
.ed-x { cursor: pointer; background: var(--color-raise, #2a2018); color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); padding: .15rem .5rem; }
.ed-term { flex: 1; min-height: 0; padding: 4px; }
</style>
