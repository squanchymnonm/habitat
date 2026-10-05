<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProjects } from '../composables/useProjects'
import type { Session } from '../types'

const props = defineProps<{ session: Session }>()
const { infraUp, dockerDown } = useProjects()

const LABEL = { up: 'arriba', partial: 'parcial', off: 'apagado' } as const
const state = computed(() => props.session.infra?.state ?? 'off')
const ports = computed(() => Object.entries(props.session.infra?.ports ?? {}))
const busy = ref<'' | 'up' | 'down'>('')
const error = ref('')
// `location` no está en el scope del template; las variables top-level de script setup sí.
const location = window.location

async function up() {
  busy.value = 'up'
  error.value = ''
  const r = await infraUp(props.session.id)
  busy.value = ''
  if (!r.ok) error.value = r.message
}
async function down() {
  // happy-dom (entorno de test) no implementa window.confirm; en ese caso se sigue de largo.
  if (typeof window.confirm === 'function' && !window.confirm('¿Bajar la infra de esta sesión? Los volúmenes con datos quedan.')) return
  busy.value = 'down'
  error.value = ''
  const r = await dockerDown(props.session.id)
  busy.value = ''
  if (!r.ok) error.value = r.message
}
</script>

<template>
  <div class="infra">
    <div class="head">
      <span class="dot" :class="state"></span>
      <b>Infra</b>
      <span data-test="infra-state" class="state">{{ LABEL[state] }}</span>
      <span class="stack">{{ session.infra?.stack }}</span>
    </div>
    <div class="ports" v-if="ports.length">
      <a v-for="[name, p] in ports" :key="name" :href="`http://${location.hostname}:${p}`" target="_blank" rel="noopener">{{ name }} :{{ p }}</a>
    </div>
    <div class="actions">
      <button class="tool" data-test="infra-up" :disabled="!!busy" @click="up">{{ busy === 'up' ? 'Levantando…' : 'Levantar' }}</button>
      <button class="tool" data-test="infra-down" :disabled="!!busy || state === 'off'" @click="down">{{ busy === 'down' ? 'Bajando…' : 'Bajar' }}</button>
    </div>
    <p class="err" v-if="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.infra { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border: 1px solid var(--color-edge); border-radius: 10px; background: var(--color-surface-2); }
.head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.state { color: var(--color-dim); font-size: 12px; }
.stack { color: var(--color-dim); font-size: 11px; font-family: var(--font-machine); }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--color-dim); }
.dot.up { background: #4caf50; }
.dot.partial { background: var(--color-brass); }
.ports { display: flex; gap: 10px; flex-wrap: wrap; font-family: var(--font-machine); font-size: 12px; }
.ports a { color: var(--color-brass); }
.actions { display: flex; gap: 6px; }
.tool { font: inherit; font-size: 12px; padding: 6px 10px; background: var(--color-surface); color: var(--color-ink); border: 1px solid var(--color-edge); border-radius: 8px; cursor: pointer; }
.tool:disabled { opacity: .6; cursor: default; }
.err { color: var(--color-crimson); font-size: 12px; margin: 0; overflow-wrap: anywhere; }
</style>
