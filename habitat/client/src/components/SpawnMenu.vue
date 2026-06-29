<script setup lang="ts">
import { ref, computed } from 'vue'
import { useProjects } from '../composables/useProjects'
import { CHARACTERS, faceFor } from '../sprites'

const { canSpawn, projects, error, spawn } = useProjects()
const open = ref(false)
const step = ref<'proj' | 'detail'>('proj')
const pickedDir = ref('')
const pickedChars = ref<string[]>([])
const allowedChars = computed(() => (pickedChars.value.length ? pickedChars.value : CHARACTERS))
const busy = ref(false)
const name = ref('')
const pickedChar = ref<string | undefined>(undefined)

function reset() {
  step.value = 'proj'
  pickedDir.value = ''
  pickedChars.value = []
  name.value = ''
  pickedChar.value = undefined
}
function toggle() {
  open.value = !open.value
  reset()
}
function pickProject(dir: string) {
  pickedDir.value = dir
  pickedChars.value = projects.value.find((p) => p.dir === dir)?.chars ?? []
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
    <button class="spawn-add" @click="toggle" :disabled="busy" title="Nueva sesión" aria-label="Nueva sesión">+</button>
    <div class="spawn-menu" v-if="open">
      <!-- Paso 1: elegir proyecto -->
      <template v-if="step === 'proj'">
        <button
          v-for="p in projects"
          :key="p.dir"
          class="sbtn spawn-item"
          :disabled="busy"
          @click="pickProject(p.dir)"
        >
          <span class="proj-dot" :style="{ background: p.color }"></span>{{ p.name }}
        </button>
      </template>

      <!-- Paso 2: nombre + sprite -->
      <template v-else>
        <button class="sbtn spawn-back" :disabled="busy" @click="back">← volver</button>
        <input
          class="spawn-input spawn-name"
          v-model="name"
          :disabled="busy"
          placeholder="nombre (vacío = al azar)"
          @keyup.enter="create"
        />
        <div class="spawn-chars">
          <button
            v-for="c in allowedChars"
            :key="c"
            class="spawn-char"
            :class="{ sel: pickedChar === c }"
            :disabled="busy"
            :title="c"
            @click="selectChar(c)"
          >
            <img :src="faceFor('', c)" alt="" />
          </button>
          <button class="sbtn spawn-auto" :class="{ sel: !pickedChar }" :disabled="busy" @click="pickedChar = undefined">
            Auto
          </button>
        </div>
        <button class="sbtn spawn-create" :disabled="busy" @click="create">Crear</button>
      </template>

      <div class="spawn-err" v-if="error">{{ error }}</div>
    </div>
  </div>
</template>

<style scoped>
/* ── Wrapper ── */
.spawn {
  position: relative;
}

/* ── Trigger button ── */
.spawn-add {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 2px solid #7a1414;
  border-radius: 50%;
  background: var(--color-crimson);
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.spawn-add:hover:not(:disabled) {
  filter: brightness(1.15);
}
.spawn-add:disabled {
  opacity: 0.5;
  cursor: default;
}

/* ── Dropdown panel ── */
.spawn-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 10;
  background: var(--color-surface);
  border: 1px solid var(--color-edge);
  border-radius: 14px;
  box-shadow: var(--shadow-sh2);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 200px;
}

/* ── Premium menu button ── */
.sbtn {
  font: inherit;
  font-size: 13px;
  text-align: left;
  padding: 9px 11px;
  background: var(--color-surface-2);
  color: var(--color-ink);
  border: 1px solid var(--color-edge);
  border-radius: 8px;
  cursor: pointer;
}
.sbtn:hover:not(:disabled) {
  border-color: var(--color-brass);
  color: var(--color-brass);
}
.sbtn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-brass);
}
.sbtn:disabled {
  opacity: 0.6;
  cursor: default;
}

/* ── Input ── */
.spawn-input {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 11px;
  background: var(--color-bg);
  border: 1px solid var(--color-edge);
  border-radius: 8px;
  color: var(--color-ink);
  font: inherit;
}
.spawn-input:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-brass);
}

/* ── Error ── */
.spawn-err {
  color: var(--color-crimson);
  font-family: var(--font-system);
  font-size: 13px;
  padding: 4px 2px;
}

/* ── Character grid ── */
.spawn-chars {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-top: 6px;
}
.spawn-char {
  background: transparent;
  border: 2px solid var(--color-edge);
  border-radius: 6px;
  padding: 3px;
  cursor: pointer;
}
.spawn-char:hover:not(:disabled) {
  border-color: var(--color-brass-2);
}
.spawn-char.sel {
  border-color: var(--color-brass-2);
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
.spawn-auto.sel {
  border-color: var(--color-brass);
  color: var(--color-brass);
}

/* ── Misc ── */
.proj-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  margin-right: 6px;
  vertical-align: middle;
}
.spawn-name {
  margin-top: 6px;
}
.spawn-create {
  margin-top: 6px;
  width: 100%;
}
</style>
