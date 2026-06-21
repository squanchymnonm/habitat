<script setup lang="ts">
import { onMounted } from 'vue'
import { useSessions } from './stores/sessions'
import { startSocket } from './composables/useSocket'
import SessionGrid from './components/SessionGrid.vue'
import SessionDrawer from './components/SessionDrawer.vue'
import SpawnMenu from './components/SpawnMenu.vue'

const store = useSessions()
onMounted(startSocket)
</script>

<template>
  <header>
    <div class="brand"><b>EL MONO<span class="dot">.</span></b><small>HÁBITAT · SERVER</small></div>
    <div class="count">
      <span><b>{{ store.list.length }}</b> SESIONES</span>
      <span class="need"><b>{{ store.needCount }}</b> TE NECESITAN</span>
    </div>
    <SpawnMenu />
  </header>
  <main><SessionGrid /></main>
  <footer>SPRITES: NINJA ADVENTURE — PIXEL-BOY / AAA — CC0</footer>
  <SessionDrawer />
</template>
