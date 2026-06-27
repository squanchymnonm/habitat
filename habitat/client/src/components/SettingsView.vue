<script setup lang="ts">
import { useSettings } from '../composables/useSettings'
import type { PermissionMode } from '../types'
import ProjectsManager from './ProjectsManager.vue'

const { permissionMode, error, saving, save } = useSettings()

const MODES: { value: PermissionMode; label: string; desc: string }[] = [
  { value: 'default', label: 'Default', desc: 'Pregunta antes de cada acción (comportamiento normal).' },
  { value: 'acceptEdits', label: 'Auto-accept edits', desc: 'Auto-aprueba ediciones de archivos; pregunta por bash y acciones sensibles.' },
  { value: 'plan', label: 'Plan', desc: 'Arranca en modo plan: investiga y propone sin tocar nada.' },
  { value: 'bypassPermissions', label: 'Bypass', desc: 'Aprueba TODO sin preguntar. Usalo con cuidado.' },
]

function onChange(e: Event) {
  save((e.target as HTMLSelectElement).value as PermissionMode)
}
</script>

<template>
  <section class="settings">
    <h2>SETTINGS</h2>
    <div class="row">
      <label for="pmode">Permission mode de sesiones nuevas</label>
      <select id="pmode" :value="permissionMode" :disabled="saving" @change="onChange">
        <option v-for="m in MODES" :key="m.value" :value="m.value">{{ m.label }}</option>
      </select>
    </div>
    <p class="desc">{{ MODES.find((m) => m.value === permissionMode)?.desc }}</p>
    <p class="err" v-if="error">{{ error }}</p>
  </section>
  <ProjectsManager />
</template>

<style scoped>
.settings { max-width: 560px; padding: clamp(18px, 3.5vw, 38px); padding-top: 52px; }
.settings h2 { font-family: var(--f-logo); margin: 0 0 18px; }
.row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.row label { font-family: var(--f-ui); font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--dim); }
.row select { font-family: var(--f-ui); font-size: 13px; padding: 8px 10px; background: #1a1a24; color: var(--ink); border: 2px solid #3a3a4a; border-radius: 6px; }
.desc { color: var(--dim); font-size: 12px; margin: 4px 0 0; }
.err { color: #e06; font-size: 12px; }
</style>
