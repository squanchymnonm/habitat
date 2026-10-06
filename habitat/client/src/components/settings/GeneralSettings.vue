<script setup lang="ts">
import { computed } from 'vue'
import { useSettings } from '../../composables/useSettings'
import type { PermissionMode } from '../../types'

const { permissionMode, error, saving, save } = useSettings()
const MODES: { value: PermissionMode; label: string; desc: string }[] = [
  { value: 'default', label: 'Default', desc: 'Pregunta antes de cada acción (comportamiento normal).' },
  { value: 'acceptEdits', label: 'Auto-accept edits', desc: 'Auto-aprueba ediciones de archivos; pregunta por bash y acciones sensibles.' },
  { value: 'plan', label: 'Plan', desc: 'Arranca en modo plan: investiga y propone sin tocar nada.' },
  { value: 'bypassPermissions', label: 'Bypass', desc: 'Aprueba TODO sin preguntar. Usalo con cuidado.' },
]
const desc = computed(() => MODES.find((m) => m.value === permissionMode.value)?.desc ?? '')
</script>

<template>
  <section class="flex max-w-xl flex-col gap-2">
    <label for="pmode" class="text-sm font-semibold text-text">Permission mode de las sesiones nuevas</label>
    <select id="pmode" data-test="pmode" :value="permissionMode" :disabled="saving"
      class="min-h-10 rounded-[var(--radius)] border border-border bg-background px-3 font-[inherit] text-sm text-text"
      @change="save(($event.target as HTMLSelectElement).value as PermissionMode)">
      <option v-for="m in MODES" :key="m.value" :value="m.value">{{ m.label }}</option>
    </select>
    <p class="m-0 text-sm text-muted">{{ desc }}</p>
    <p v-if="error" class="m-0 text-sm text-danger">{{ error }}</p>
  </section>
</template>
