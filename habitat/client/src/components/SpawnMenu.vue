<script setup lang="ts">
import { ref } from 'vue'
import { useProjects } from '../composables/useProjects'

const { canSpawn, projects, error, spawn } = useProjects()
const open = ref(false)
const busy = ref(false)

async function pick(dir: string) {
  busy.value = true
  const ok = await spawn(dir)
  busy.value = false
  if (ok) open.value = false
}
</script>

<template>
  <div class="spawn" v-if="canSpawn">
    <button class="ctl" @click="open = !open" :disabled="busy">+ NUEVA SESIÓN</button>
    <div class="spawn-menu" v-if="open">
      <button
        v-for="p in projects"
        :key="p.dir"
        class="ctl spawn-item"
        :disabled="busy"
        @click="pick(p.dir)"
      >
        {{ p.name }}
      </button>
      <div class="spawn-err" v-if="error">{{ error }}</div>
    </div>
  </div>
</template>
