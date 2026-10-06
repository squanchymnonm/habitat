<script setup lang="ts">
import { computed } from 'vue'
import { Minus, Plus } from 'lucide-vue-next'
import ThemePicker from './ThemePicker.vue'
import { useZoom } from '../../composables/useZoom'
import { useTermKeys } from '../../composables/useTermKeys'
import { useLayoutMode } from '../../composables/useLayoutMode'
import { Switch } from '@/components/ui/switch'

const { zoomPct, zoomIn, zoomOut, resetZoom, canZoomIn, canZoomOut } = useZoom()
const { enabled: termKeys, toggle: toggleTermKeys } = useTermKeys()
const { allCollapsed, setCollapsedAll } = useLayoutMode()
const termKeysModel = computed({ get: () => termKeys.value, set: (v: boolean) => { if (v !== termKeys.value) toggleTermKeys() } })
const navModel = computed({ get: () => allCollapsed.value, set: (v: boolean) => setCollapsedAll(v) })
const iconBtn = 'inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-[var(--radius)] border-0 bg-surface-raised font-[inherit] text-text hover:text-accent disabled:cursor-default disabled:opacity-40'
</script>

<template>
  <div class="flex flex-col gap-6">
    <section class="flex flex-col gap-3">
      <h2 class="m-0 text-base font-semibold text-text">Tema</h2>
      <ThemePicker />
    </section>
    <section class="flex flex-col gap-3">
      <h2 class="m-0 text-base font-semibold text-text">Zoom</h2>
      <div class="flex items-center gap-2">
        <button data-test="zoom-out" type="button" :class="iconBtn" :disabled="!canZoomOut" aria-label="Alejar" @click="zoomOut"><Minus class="size-4" /></button>
        <button data-test="zoom-reset" type="button" title="Volver a 100%" @click="resetZoom"
          class="min-h-10 w-16 cursor-pointer rounded-[var(--radius)] border-0 bg-transparent font-[inherit] text-sm tabular-nums text-text">{{ zoomPct }}%</button>
        <button data-test="zoom-in" type="button" :class="iconBtn" :disabled="!canZoomIn" aria-label="Acercar" @click="zoomIn"><Plus class="size-4" /></button>
      </div>
    </section>
    <section class="flex flex-col gap-1">
      <label class="flex min-h-10 cursor-pointer items-center justify-between gap-4">
        <span class="flex flex-col">
          <span class="text-sm font-semibold text-text">Teclas en pantalla</span>
          <span class="text-xs text-muted">Flechas, Esc y Tab en la terminal y el editor. Útil en tablets y celulares sin teclado físico.</span>
        </span>
        <Switch v-model="termKeysModel" data-test="termkeys-switch" />
      </label>
      <label class="flex min-h-10 cursor-pointer items-center justify-between gap-4">
        <span class="flex flex-col">
          <span class="text-sm font-semibold text-text">Barra de sesiones colapsada por defecto</span>
          <span class="text-xs text-muted">Sólo avatares con la luz de estado, en horizontal y en vertical.</span>
        </span>
        <Switch v-model="navModel" data-test="nav-collapsed-switch" />
      </label>
    </section>
    <p class="m-0 font-mono text-xs text-muted">Sprites: Ninja Adventure — Pixel-Boy / AAA · CC0</p>
  </div>
</template>
