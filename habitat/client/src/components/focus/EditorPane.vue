<script setup lang="ts">
import { ref, computed } from 'vue'
import { X } from 'lucide-vue-next'
import { useTerminal } from '../../composables/useTerminal'
import { useTermKeys } from '../../composables/useTermKeys'
import TermKeys from '../TermKeys.vue'

// Terminal del editor (tmux <sesión>-edit con nvim). Cerrar no mata nvim.
const props = defineProps<{ sessionId: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const termEl = ref<HTMLElement | null>(null)
const { sendKey } = useTerminal(termEl, computed(() => props.sessionId), { role: 'edit' })
const { enabled: termKeysEnabled } = useTermKeys()
</script>

<template>
  <div class="absolute inset-0 z-20 flex flex-col overflow-hidden rounded-[calc(var(--radius)+4px)] border border-border bg-terminal-bg">
    <header class="flex min-h-10 items-center gap-2 border-b border-border bg-surface px-3 py-1.5">
      <span class="font-mono text-xs text-muted">✎ Editor · nvim</span>
      <TermKeys v-if="termKeysEnabled" dense @press="sendKey" />
      <span class="flex-1" />
      <button data-test="editor-close" type="button" title="Cerrar (nvim sigue vivo)" @click="emit('close')"
        class="inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-[var(--radius)] border-0 bg-transparent p-1 text-muted hover:bg-surface-raised hover:text-text">
        <X class="size-4" />
      </button>
    </header>
    <div ref="termEl" class="min-h-0 flex-1" />
  </div>
</template>
