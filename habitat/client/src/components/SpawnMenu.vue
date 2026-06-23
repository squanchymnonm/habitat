<script setup lang="ts">
import { ref } from 'vue'
import { useProjects } from '../composables/useProjects'
import { CHARACTERS, faceFor } from '../sprites'

const { canSpawn, projects, error, spawn } = useProjects()
const open = ref(false)
const step = ref<'proj' | 'detail'>('proj')
const pickedDir = ref('')
const busy = ref(false)
const name = ref('')
const pickedChar = ref<string | undefined>(undefined)

function reset() {
  step.value = 'proj'
  pickedDir.value = ''
  name.value = ''
  pickedChar.value = undefined
}
function toggle() {
  open.value = !open.value
  reset()
}
function pickProject(dir: string) {
  pickedDir.value = dir
  step.value = 'detail'
}
function back() {
  reset()
}
function selectChar(c: string) {
  pickedChar.value = pickedChar.value === c ? undefined : c
}
async function create() {
  if (!pickedDir.value) return
  busy.value = true
  const ok = await spawn(pickedDir.value, name.value.trim(), pickedChar.value)
  busy.value = false
  if (ok) {
    open.value = false
    reset()
  }
}
</script>

<template>
  <div class="spawn" v-if="canSpawn">
    <button class="ctl" @click="toggle" :disabled="busy">+ NUEVA SESIÓN</button>
    <div class="spawn-menu" v-if="open">
      <!-- Paso 1: elegir proyecto -->
      <template v-if="step === 'proj'">
        <button
          v-for="p in projects"
          :key="p.dir"
          class="ctl spawn-item"
          :disabled="busy"
          @click="pickProject(p.dir)"
        >
          {{ p.name }}
        </button>
      </template>

      <!-- Paso 2: nombre + sprite -->
      <template v-else>
        <button class="ctl spawn-back" :disabled="busy" @click="back">← volver</button>
        <input
          class="spawn-input spawn-name"
          v-model="name"
          :disabled="busy"
          placeholder="nombre (vacío = al azar)"
          @keyup.enter="create"
        />
        <div class="spawn-chars">
          <button
            v-for="c in CHARACTERS"
            :key="c"
            class="spawn-char"
            :class="{ sel: pickedChar === c }"
            :disabled="busy"
            :title="c"
            @click="selectChar(c)"
          >
            <img :src="faceFor('', c)" alt="" />
          </button>
          <button class="ctl spawn-auto" :class="{ sel: !pickedChar }" :disabled="busy" @click="pickedChar = undefined">
            Auto
          </button>
        </div>
        <button class="ctl spawn-create" :disabled="busy" @click="create">Crear</button>
      </template>

      <div class="spawn-err" v-if="error">{{ error }}</div>
    </div>
  </div>
</template>

<style scoped>
.spawn-chars {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-top: 6px;
}
.spawn-char {
  background: transparent;
  border: 2px solid #3a3a4a;
  border-radius: 6px;
  padding: 3px;
  cursor: pointer;
}
.spawn-char:hover {
  border-color: #e7c14a;
}
.spawn-char img {
  width: 32px;
  height: 32px;
  image-rendering: pixelated;
  display: block;
}
.spawn-auto {
  grid-column: span 4;
}
.spawn-name {
  width: 100%;
  margin-top: 6px;
  box-sizing: border-box;
}
.spawn-char.sel { border-color: #e7c14a; }
.spawn-auto.sel { border-color: #e7c14a; }
.spawn-create { margin-top: 6px; width: 100%; }
</style>
