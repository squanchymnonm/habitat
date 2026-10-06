<script setup lang="ts">
import { useLayoutMode } from '../../composables/useLayoutMode'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import NewSessionForm from './NewSessionForm.vue'

// Nueva sesión: en celular, Sheet inferior; si no, Dialog. El contenido (pasos
// proyecto → nombre/personaje → crear) vive en NewSessionForm.
defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()
const { mode } = useLayoutMode()

function onOpenChange(v: boolean) { emit('update:open', v) }
</script>

<template>
  <Sheet v-if="mode === 'phone'" :open="open" @update:open="onOpenChange">
    <SheetContent side="bottom" data-test="ns-sheet" class="max-h-[85dvh] overflow-y-auto">
      <SheetHeader>
        <SheetTitle>Nueva sesión</SheetTitle>
        <SheetDescription>Elegí el proyecto y el personaje</SheetDescription>
      </SheetHeader>
      <NewSessionForm v-if="open" @done="onOpenChange(false)" />
    </SheetContent>
  </Sheet>

  <Dialog v-else :open="open" @update:open="onOpenChange">
    <DialogContent class="max-h-[85dvh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Nueva sesión</DialogTitle>
        <DialogDescription>Elegí el proyecto y el personaje</DialogDescription>
      </DialogHeader>
      <NewSessionForm v-if="open" @done="onOpenChange(false)" />
    </DialogContent>
  </Dialog>
</template>
