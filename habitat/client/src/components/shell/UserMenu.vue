<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Settings, LogOut, CircleUser } from 'lucide-vue-next'
import { useAuth } from '../../composables/useAuth'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const router = useRouter()
const { logout } = useAuth()
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger class="shrink-0 cursor-pointer rounded-[var(--radius)] border-0 bg-transparent p-2 font-[inherit] text-muted hover:bg-surface-raised hover:text-text" aria-label="Menú">
      <CircleUser class="size-5" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-52">
      <DropdownMenuItem @select="router.push('/settings/general')"><Settings class="size-4" /> Ajustes</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem @select="logout()"><LogOut class="size-4" /> Salir</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
