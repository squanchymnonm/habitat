<script setup lang="ts">
import type { ProjectConfigDraft } from '../../../composables/useProjectConfigDraft'

// "Guardar configuración" del borrador compartido por Relacionados, Infra y .env.
const props = defineProps<{ draft: ProjectConfigDraft }>()
const { save, saving, configOk, configError } = props.draft
</script>

<template>
  <div class="flex flex-col gap-2 border-0 border-t border-border pt-3">
    <div>
      <button type="button" data-test="save-config" :disabled="saving" @click="save"
        class="min-h-10 cursor-pointer rounded-[var(--radius)] border-0 bg-accent px-3 font-[inherit] text-sm font-semibold text-accent-foreground disabled:opacity-50">
        Guardar configuración
      </button>
    </div>
    <p v-if="configOk" aria-live="polite" class="m-0 text-sm text-muted">configuración guardada</p>
    <p v-if="configError" role="alert" class="m-0 text-sm text-danger">{{ configError }}</p>
  </div>
</template>
