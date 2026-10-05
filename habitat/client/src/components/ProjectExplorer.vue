<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import ProjectFiles from './ProjectFiles.vue'
import GitTool from './tools/git/GitTool.vue'

const props = withDefaults(defineProps<{ id: string; tab?: 'files' | 'git' }>(), { tab: 'files' })
const emit = defineEmits<{ (e: 'close'): void; (e: 'opened'): void }>()

const path = ref('')
const tab = ref<'files' | 'git'>(props.tab)
const files = ref<InstanceType<typeof ProjectFiles> | null>(null)
const git = ref<InstanceType<typeof GitTool> | null>(null)

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="pe-overlay">
    <header class="pe-head">
      <span class="pe-title">🗂 Proyecto</span>
      <nav class="pe-crumbs">
        <button class="pe-crumb" @click="path = ''">{{ files?.listing?.root || '~' }}</button>
        <template v-for="c in files?.listing?.breadcrumbs || []" :key="c.rel">
          <span class="pe-sep">/</span>
          <button class="pe-crumb" @click="path = c.rel">{{ c.name }}</button>
        </template>
      </nav>
      <button class="pe-x" @click="emit('close')" title="Cerrar">✕</button>
    </header>

    <div v-if="git?.repoLabel" class="pe-chip">
      repo: <b>{{ git.repoLabel.name }}</b>
      · ⌥ <b>{{ git.repoLabel.branch }}</b>
      · ↑{{ git.repoLabel.ahead }} ↓{{ git.repoLabel.behind }}
    </div>

    <nav class="pe-tabs">
      <button :class="{ on: tab === 'files' }" @click="tab = 'files'">Archivos</button>
      <button :class="{ on: tab === 'git' }" @click="tab = 'git'">Git</button>
    </nav>

    <div class="pe-body">
      <ProjectFiles v-show="tab === 'files'" ref="files" :id="props.id" :path="path"
        @navigate="(rel) => (path = rel)" @opened="emit('opened')" />
      <GitTool v-if="tab === 'git'" ref="git" :session-id="props.id" :path="path" />
    </div>
  </div>
</template>

<style scoped>
.pe-overlay { position: absolute; inset: 0; background: var(--color-base, #1a1410); color: var(--color-ink, #e8dcc0); display: flex; flex-direction: column; z-index: 5; }
.pe-head { display: flex; align-items: center; gap: .6rem; padding: .5rem .75rem; border-bottom: 1px solid var(--color-line, #3a2e22); }
.pe-title { font-weight: 700; }
.pe-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; flex: 1; overflow: hidden; }
.pe-crumb { background: none; border: none; color: var(--color-brass, #c79a4b); cursor: pointer; font-family: ui-monospace, monospace; }
.pe-sep { color: var(--color-line, #3a2e22); }
.pe-x { cursor: pointer; background: var(--color-raise, #2a2018); color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); padding: .15rem .5rem; }
.pe-chip { padding: .25rem .75rem; font-size: .8rem; opacity: .9; border-bottom: 1px solid var(--color-line, #3a2e22); }
.pe-tabs { display: flex; gap: .25rem; padding: .4rem .75rem 0; }
.pe-tabs button { flex: 1; padding: .4rem; min-height: 44px; background: transparent; color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); cursor: pointer; }
.pe-tabs button.on { background: var(--color-brass, #c79a4b); color: #1a1410; font-weight: 700; }
.pe-body { flex: 1; display: flex; flex-direction: column; min-height: 0; }
</style>
