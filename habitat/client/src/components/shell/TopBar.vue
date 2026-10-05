<script setup lang="ts">
import SessionSummary from './SessionSummary.vue'
import ManaMeter from './ManaMeter.vue'
import UserMenu from './UserMenu.vue'
import SpawnMenu from '../SpawnMenu.vue'
</script>

<template>
  <header class="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3 pt-[env(safe-area-inset-top,0px)] sm:gap-4 sm:px-4">
    <RouterLink to="/" class="font-display text-lg font-bold text-accent">Hábitat</RouterLink>
    <SessionSummary />
    <span class="flex-1" />
    <ManaMeter />
    <SpawnMenu />
    <UserMenu />
  </header>
</template>
