<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useLayoutMode } from '../../composables/useLayoutMode'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import NewSessionForm from './NewSessionForm.vue'

// Nueva sesión: en celular, Sheet inferior; si no, Dialog. El contenido (pasos
// proyecto → nombre/personaje → crear) vive en NewSessionForm.
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()
const { mode } = useLayoutMode()

function onOpenChange(v: boolean) { emit('update:open', v) }

// Nombre del proyecto elegido (si hay), para el subtítulo del header; NewSessionForm es
// quien sabe cuál es (y se destruye/recrea con `open`, así que acá sólo reflejamos).
const projectName = ref<string | null>(null)
watch(() => props.open, (v) => { if (!v) projectName.value = null })
const description = computed(() => projectName.value ?? 'Elegí el proyecto')
</script>

<template>
  <Sheet v-if="mode === 'phone'" :open="open" @update:open="onOpenChange">
    <SheetContent side="bottom" data-test="ns-sheet" class="max-h-[85dvh] overflow-y-auto">
      <SheetHeader>
        <SheetTitle>Nueva sesión</SheetTitle>
        <SheetDescription data-test="ns-description">{{ description }}</SheetDescription>
      </SheetHeader>
      <!-- SheetContent no trae padding propio (sólo el header lo tiene): sin este div el
           cuerpo toca los bordes de la pantalla. pb- suma el inset seguro de abajo. -->
      <div data-test="ns-sheet-body" class="px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
        <NewSessionForm v-if="open" @done="onOpenChange(false)" @project-change="projectName = $event" />
      </div>
    </SheetContent>
  </Sheet>

  <Dialog v-else :open="open" @update:open="onOpenChange">
    <DialogContent class="max-h-[85dvh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Nueva sesión</DialogTitle>
        <DialogDescription data-test="ns-description">{{ description }}</DialogDescription>
      </DialogHeader>
      <NewSessionForm v-if="open" @done="onOpenChange(false)" @project-change="projectName = $event" />
    </DialogContent>
  </Dialog>
</template>
