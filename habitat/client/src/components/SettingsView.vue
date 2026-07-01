<script setup lang="ts">
import { useSettings } from '../composables/useSettings'
import type { PermissionMode } from '../types'
import ProjectsManager from './ProjectsManager.vue'
import { useTermKeys } from '../composables/useTermKeys'

const { permissionMode, error, saving, save } = useSettings()
const { enabled: termKeys, toggle: toggleTermKeys } = useTermKeys()

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
    <div class="row">
      <label for="termkeys">Teclas en pantalla (flechas / Esc / Tab)</label>
      <label class="toggle">
        <input id="termkeys" type="checkbox" :checked="termKeys" @change="toggleTermKeys" />
        <span>{{ termKeys ? 'Activado' : 'Desactivado' }}</span>
      </label>
    </div>
    <p class="desc">Muestra una fila de teclas táctiles en la terminal y el editor. Útil en tablets/teléfonos sin flechas físicas.</p>
    <p class="err" v-if="error">{{ error }}</p>
    <p class="credit">Sprites: Ninja Adventure — Pixel-Boy / AAA · CC0</p>
  </section>
  <ProjectsManager />
</template>

<style scoped>
.settings { max-width: 560px; padding: clamp(18px, 3.5vw, 38px); }
.settings h2 { font-family: var(--font-lore); margin: 0 0 18px; }
.row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.row label { font-family: var(--font-system); font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--color-dim); }
.row select { font-family: var(--font-system); font-size: 13px; padding: 8px 10px; background: var(--color-bg); color: var(--color-ink); border: 2px solid var(--color-edge); border-radius: 6px; }
.row select:focus-visible { outline: 2px solid var(--color-brass); }
.toggle { display: flex; align-items: center; gap: 8px; font-family: var(--font-system); font-size: 13px; color: var(--color-ink); }
.toggle input { width: 18px; height: 18px; accent-color: var(--color-brass); }
.desc { color: var(--color-dim); font-size: 12px; margin: 4px 0 0; }
.err { color: var(--color-crimson); font-size: 12px; }
.credit { margin-top: 28px; color: var(--color-faint); font-family: var(--font-machine); font-size: 11px; }
</style>
