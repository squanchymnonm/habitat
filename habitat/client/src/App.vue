<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useSessions } from './stores/sessions'
import { startSocket } from './composables/useSocket'
import { useTabAlert } from './composables/useTabAlert'
import { useAuth } from './composables/useAuth'
import { useUsage } from './composables/useUsage'
import { skyGradient } from './composables/useDayNight'
import HabitatLayout from './components/HabitatLayout.vue'
import AppMenu from './components/AppMenu.vue'
import SpawnMenu from './components/SpawnMenu.vue'
import SettingsView from './components/SettingsView.vue'
import LoginView from './components/LoginView.vue'
import UsageHud from './components/UsageHud.vue'

const store = useSessions()
const view = ref<'sessions' | 'settings'>('sessions')
const { authed, checkAuth } = useAuth()
const { cyclePos } = useUsage()
const skyBg = computed(() => skyGradient(cyclePos.value))

onMounted(checkAuth)
watch(authed, (v) => { if (v === true) startSocket() })
useTabAlert()
</script>

<template>
  <LoginView v-if="authed === false" />
  <template v-else-if="authed === true">
    <div class="sky-ambient" :style="skyBg ? { background: skyBg } : {}" aria-hidden="true"></div>
    <AppMenu v-model:view="view" />
    <div class="hud-stack">
      <div class="stats-hud">
        <span><b>{{ store.list.length }}</b> SESIONES</span>
        <SpawnMenu />
        <span class="need"><b>{{ store.needCount }}</b> TE NECESITAN</span>
      </div>
      <UsageHud />
    </div>
    <HabitatLayout v-if="view === 'sessions'" />
    <SettingsView v-else />
    <footer>SPRITES: NINJA ADVENTURE — PIXEL-BOY / AAA — CC0</footer>
  </template>
</template>
