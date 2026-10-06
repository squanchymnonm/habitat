<script setup lang="ts">
import { LogOut } from 'lucide-vue-next'
import { useAuth } from '../../composables/useAuth'

const { user, logout } = useAuth()
</script>

<template>
  <section class="flex max-w-xl flex-col gap-3">
    <p class="m-0 text-sm text-muted">Usuario</p>
    <p data-test="account-user" class="m-0 text-base font-semibold text-text">{{ user ?? 'Entraste con token' }}</p>
    <button data-test="logout" type="button" @click="logout()"
      class="inline-flex min-h-10 w-fit cursor-pointer items-center gap-2 rounded-[var(--radius)] border-0 bg-surface-raised px-4 font-[inherit] text-sm text-text hover:text-danger">
      <LogOut class="size-4" />Salir
    </button>
  </section>
</template>
