<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProjects } from '../../composables/useProjects'
import ConfirmDialog from '../focus/ConfirmDialog.vue'
import type { Session } from '../../types'

const props = defineProps<{ session: Session }>()
const { infraUp, dockerDown } = useProjects()

const LABEL = { up: 'arriba', partial: 'parcial', off: 'apagado' } as const
const DOT: Record<string, string> = { up: 'bg-state-done', partial: 'bg-state-working', off: 'bg-state-idle' }
const state = computed(() => props.session.infra?.state ?? 'off')
const ports = computed(() => Object.entries(props.session.infra?.ports ?? {}))
const busy = ref<'' | 'up' | 'down'>('')
const error = ref('')
const confirmDown = ref(false)
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
  busy.value = 'down'
  error.value = ''
  const r = await dockerDown(props.session.id)
  busy.value = ''
  if (!r.ok) error.value = r.message
}
</script>

<template>
  <div class="h-full overflow-y-auto p-4">
    <div class="flex flex-wrap items-center gap-2">
      <i class="size-2.5 shrink-0 rounded-full" :class="DOT[state]"></i>
      <b class="text-text">Infra</b>
      <span data-test="infra-state" class="text-sm text-muted">{{ LABEL[state] }}</span>
      <span class="font-mono text-xs text-muted">{{ session.infra?.stack }}</span>
    </div>
    <div v-if="ports.length" class="mt-2 flex flex-wrap gap-2">
      <a
        v-for="[name, p] in ports"
        :key="name"
        :href="`http://${location.hostname}:${p}`"
        target="_blank"
        rel="noopener"
        data-test="infra-port"
        class="inline-flex min-h-10 items-center rounded-[var(--radius)] bg-surface-raised px-2 py-1 font-mono text-xs text-accent no-underline hover:underline"
      >{{ name }} :{{ p }}</a>
    </div>
    <div class="mt-3 flex gap-2">
      <button
        type="button"
        data-test="infra-up"
        :disabled="!!busy"
        class="min-h-10 cursor-pointer rounded-[var(--radius)] border-0 bg-surface-raised px-3 py-1.5 font-[inherit] text-sm text-text hover:text-accent disabled:opacity-50"
        @click="up"
      >{{ busy === 'up' ? 'Levantando…' : 'Levantar' }}</button>
      <button
        type="button"
        data-test="infra-down"
        :disabled="!!busy || state === 'off'"
        class="min-h-10 cursor-pointer rounded-[var(--radius)] border-0 bg-surface-raised px-3 py-1.5 font-[inherit] text-sm text-text hover:text-accent disabled:opacity-50"
        @click="confirmDown = true"
      >{{ busy === 'down' ? 'Bajando…' : 'Bajar' }}</button>
    </div>
    <p v-if="error" class="m-0 mt-2 text-sm text-danger">{{ error }}</p>

    <ConfirmDialog
      v-model:open="confirmDown"
      title="¿Bajar la infra de esta sesión?"
      description="Los volúmenes con datos quedan."
      confirm-label="Bajar"
      danger
      @confirm="down"
    />
  </div>
</template>
