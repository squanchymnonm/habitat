<script setup lang="ts">
import type { ProjectConfigDraft } from '../../../composables/useProjectConfigDraft'
import ConfigSaveBar from './ConfigSaveBar.vue'

const props = defineProps<{ draft: ProjectConfigDraft }>()
const { infraRepo, infraPath, infraUp, infraDown, repoOptions, repoLabel } = props.draft

const input = 'min-h-10 rounded-[var(--radius)] border border-border bg-background px-3 font-[inherit] text-sm text-text'
const label = 'flex flex-col gap-1 text-sm text-text'
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="m-0 text-sm text-muted">Docker compose que cada sesión puede levantar en su worktree.</p>
    <div class="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3">
      <label :class="label">Dónde está
        <select v-model="infraRepo" data-test="infra-repo" :class="[input, 'cursor-pointer']">
          <option value="">ninguna</option>
          <option v-for="r in repoOptions" :key="r" :value="r">{{ repoLabel(r) }}</option>
        </select>
      </label>
      <template v-if="infraRepo">
        <label :class="label">Subcarpeta <input v-model="infraPath" data-test="infra-path" placeholder="(raíz)" :class="input" /></label>
        <label :class="label">Levantar <input v-model="infraUp" placeholder="docker compose up -d" :class="input" /></label>
        <label :class="label">Bajar <input v-model="infraDown" placeholder="docker compose down" :class="input" /></label>
      </template>
    </div>
    <ConfigSaveBar :draft="draft" />
  </div>
</template>
