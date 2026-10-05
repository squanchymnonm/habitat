<script setup lang="ts">
import { useUsage } from '../../composables/useUsage'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const { usage, mana, resetLabel } = useUsage()
</script>

<template>
  <TooltipProvider v-if="usage">
    <Tooltip>
      <TooltipTrigger as-child>
        <span class="flex shrink-0 items-center gap-2 text-xs text-muted" aria-label="Maná: uso de Claude restante">
          <span class="hidden sm:inline">Maná</span>
          <span class="h-1.5 w-20 overflow-hidden rounded-full bg-surface-raised">
            <i data-test="mana-fill" class="block h-full bg-mana" :style="{ width: (mana ?? 0) + '%' }" />
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>Maná {{ mana ?? 0 }}% · próximo ciclo en {{ resetLabel }}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
