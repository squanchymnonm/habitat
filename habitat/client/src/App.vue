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
    <div class="forge-veil" aria-hidden="true"></div>
    <header class="topbar">
      <AppMenu v-model:view="view" />
      <div class="topbar-hud">
        <span class="hud-chip"><b>{{ store.list.length }}</b> sesiones</span>
        <span class="hud-chip need" v-if="store.needCount"><span class="need-pulse"></span> {{ store.needCount }} te necesitan</span>
        <UsageHud />
        <SpawnMenu />
      </div>
    </header>
    <HabitatLayout v-if="view === 'sessions'" />
    <SettingsView v-else />
  </template>
</template>

<style>
.sky-ambient{ position:fixed; inset:0; z-index:-2; pointer-events:none; opacity:.9; transition:background .6s linear; }
.forge-veil{ position:fixed; inset:0; z-index:-1; pointer-events:none;
  background:
    radial-gradient(820px 460px at 92% -6%, rgba(232,119,58,.18), transparent 60%),
    radial-gradient(680px 520px at 6% 110%, rgba(154,58,30,.14), transparent 55%); }
.topbar{ position:sticky; top:0; z-index:20; display:flex; align-items:center; gap:18px;
  padding:13px clamp(16px,2.4vw,30px);
  background:linear-gradient(180deg, rgba(28,22,15,.92), rgba(20,16,11,.82));
  backdrop-filter:blur(10px); border-bottom:1px solid var(--color-edge); }
.topbar-hud{ display:flex; align-items:center; gap:10px; margin-left:auto; flex-wrap:wrap; }
.hud-chip{ display:inline-flex; align-items:center; gap:7px; padding:7px 12px; border-radius:999px;
  background:var(--color-surface); border:1px solid var(--color-edge); color:var(--color-dim); font-size:13px; }
.hud-chip b{ color:var(--color-ink); font-variant-numeric:tabular-nums; }
.hud-chip.need{ background:linear-gradient(180deg, rgba(242,201,76,.16), rgba(242,201,76,.07));
  border-color:rgba(242,201,76,.4); color:var(--color-amber); font-weight:600; }
.need-pulse{ width:7px; height:7px; border-radius:50%; background:var(--color-amber);
  box-shadow:0 0 0 0 rgba(242,201,76,.6); animation:needpulse 1.6s infinite; }
@keyframes needpulse{ 0%{box-shadow:0 0 0 0 rgba(242,201,76,.55)} 70%{box-shadow:0 0 0 7px rgba(242,201,76,0)} 100%{box-shadow:0 0 0 0 rgba(242,201,76,0)} }
@media (prefers-reduced-motion:reduce){ .need-pulse{ animation:none } }
</style>
