<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useSessions } from './stores/sessions'
import { startSocket } from './composables/useSocket'
import HabitatLayout from './components/HabitatLayout.vue'
import SpawnMenu from './components/SpawnMenu.vue'
import SettingsView from './components/SettingsView.vue'

const store = useSessions()
const view = ref<'sessions' | 'settings'>('sessions')
onMounted(startSocket)
</script>

<template>
  <header>
    <div class="brand"><b>EL MONO<span class="dot">.</span></b><small>HÁBITAT · SERVER</small></div>
    <div class="count">
      <span><b>{{ store.list.length }}</b> SESIONES</span>
      <span class="need"><b>{{ store.needCount }}</b> TE NECESITAN</span>
    </div>
    <nav class="views">
      <button class="ctl" :class="{ active: view === 'sessions' }" @click="view = 'sessions'">Sesiones</button>
      <button class="ctl" :class="{ active: view === 'settings' }" @click="view = 'settings'">⚙ Settings</button>
    </nav>
    <SpawnMenu />
  </header>
  <HabitatLayout v-if="view === 'sessions'" />
  <SettingsView v-else />
  <footer>SPRITES: NINJA ADVENTURE — PIXEL-BOY / AAA — CC0</footer>
</template>

<style scoped>
.views { display: flex; gap: 6px; }
.views .ctl.active { background: var(--gold); color: #2a1c0a; }
</style>
