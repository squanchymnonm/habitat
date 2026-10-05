<script setup lang="ts">
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

// Confirmación de acciones que pierden trabajo o bajan servicios.
defineProps<{ open: boolean; title: string; description?: string; confirmLabel: string; danger?: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void; (e: 'confirm'): void }>()
function ok() { emit('confirm'); emit('update:open', false) }
</script>

<template>
  <Dialog :open="open" @update:open="(v: boolean) => emit('update:open', v)">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription v-if="description" class="whitespace-pre-line">{{ description }}</DialogDescription>
      </DialogHeader>
      <DialogFooter class="gap-2">
        <button type="button" data-test="confirm-cancel" @click="emit('update:open', false)"
          class="cursor-pointer rounded-[var(--radius)] border border-border bg-transparent px-3 py-1.5 font-[inherit] text-sm text-text hover:bg-surface-raised">
          Cancelar
        </button>
        <button type="button" data-test="confirm-ok" @click="ok"
          :class="cn('cursor-pointer rounded-[var(--radius)] border-0 px-3 py-1.5 font-[inherit] text-sm font-semibold',
            danger ? 'bg-danger text-background' : 'bg-accent text-accent-foreground')">
          {{ confirmLabel }}
        </button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
