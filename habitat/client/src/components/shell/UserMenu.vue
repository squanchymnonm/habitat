<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Settings, LogOut, Minus, Plus, CircleUser } from 'lucide-vue-next'
import { useAuth } from '../../composables/useAuth'
import { useZoom } from '../../composables/useZoom'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const router = useRouter()
const { logout } = useAuth()
// El zoom vive acá hasta que Apariencia exista (PR 4).
const { zoomPct, zoomIn, zoomOut, resetZoom, canZoomIn, canZoomOut } = useZoom()
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger class="cursor-pointer rounded-[var(--radius)] border-0 bg-transparent p-2 font-[inherit] text-muted hover:bg-surface-raised hover:text-text" aria-label="Menú">
      <CircleUser class="size-5" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-52">
      <DropdownMenuItem @select="router.push('/settings/general')"><Settings class="size-4" /> Ajustes</DropdownMenuItem>
      <div class="flex items-center justify-between px-2 py-1.5 text-sm">
        <span class="text-muted">Zoom</span>
        <span class="flex items-center gap-1">
          <button class="cursor-pointer rounded border-0 bg-transparent p-1 font-[inherit] text-inherit hover:bg-surface-raised disabled:cursor-default disabled:opacity-40" :disabled="!canZoomOut" aria-label="Alejar" @click="zoomOut"><Minus class="size-3.5" /></button>
          <button class="w-12 cursor-pointer border-0 bg-transparent text-center font-[inherit] text-inherit tabular-nums" title="Volver a 100%" @click="resetZoom">{{ zoomPct }}%</button>
          <button class="cursor-pointer rounded border-0 bg-transparent p-1 font-[inherit] text-inherit hover:bg-surface-raised disabled:cursor-default disabled:opacity-40" :disabled="!canZoomIn" aria-label="Acercar" @click="zoomIn"><Plus class="size-3.5" /></button>
        </span>
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem @select="logout()"><LogOut class="size-4" /> Salir</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
