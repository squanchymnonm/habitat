<script setup lang="ts">
import { PanelRightClose } from 'lucide-vue-next'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'

// Terminal a la izquierda (slot) y la herramienta fijada a la derecha. El ancho
// (en %) lo persiste useFocusTools.
defineProps<{ size: number; label: string }>()
const emit = defineEmits<{ (e: 'resize', size: number): void; (e: 'unpin'): void }>()
function onLayout(sizes: number[]) { if (sizes[1] != null) emit('resize', sizes[1]) }
</script>

<template>
  <ResizablePanelGroup data-test="pinned-panel" direction="horizontal" class="h-full min-h-0" @layout="onLayout">
    <ResizablePanel :default-size="100 - size" :min-size="25" class="min-w-0"><slot name="left" /></ResizablePanel>
    <ResizableHandle with-handle class="mx-1 bg-border" />
    <ResizablePanel :default-size="size" :min-size="15" class="min-w-0">
      <section class="flex h-full min-h-0 flex-col overflow-hidden rounded-[calc(var(--radius)+4px)] border border-border bg-surface">
        <header class="flex min-h-10 items-center gap-2 border-b border-border px-3 py-1.5">
          <b class="flex-1 text-sm text-text">{{ label }}</b>
          <button data-test="unpin-tool" type="button" title="Desfijar (Esc)" @click="emit('unpin')"
            class="inline-flex min-h-10 cursor-pointer items-center gap-1 rounded-[var(--radius)] border-0 bg-transparent px-2 py-1 font-[inherit] text-xs text-muted hover:bg-surface-raised hover:text-text">
            <PanelRightClose class="size-4" />Desfijar
          </button>
        </header>
        <div class="min-h-0 flex-1"><slot /></div>
      </section>
    </ResizablePanel>
  </ResizablePanelGroup>
</template>
