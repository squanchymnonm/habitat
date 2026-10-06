<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from '../composables/useAuth'

const { login } = useAuth()
const user = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  error.value = ''
  busy.value = true
  try {
    const ok = await login(user.value, password.value)
    if (!ok) error.value = 'Usuario o contraseña incorrectos.'
  } catch {
    error.value = 'No se pudo conectar.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex min-h-full items-center justify-center bg-background p-4">
    <form class="flex w-full max-w-sm flex-col gap-4 rounded-[calc(var(--radius)+4px)] border border-border bg-surface p-6" @submit.prevent="submit">
      <div class="flex flex-col gap-1 text-center">
        <h1 class="m-0 font-display text-3xl font-bold text-accent">Hábitat</h1>
        <p class="m-0 text-sm text-muted">monitor de sesiones · Claude Code</p>
      </div>
      <label class="flex flex-col gap-1 text-sm text-muted">Usuario
        <input v-model="user" placeholder="Usuario" autocomplete="username" autofocus
          class="min-h-10 rounded-[var(--radius)] border border-border bg-background px-3 font-[inherit] text-sm text-text" />
      </label>
      <label class="flex flex-col gap-1 text-sm text-muted">Contraseña
        <input v-model="password" type="password" placeholder="Contraseña" autocomplete="current-password"
          class="min-h-10 rounded-[var(--radius)] border border-border bg-background px-3 font-[inherit] text-sm text-text" />
      </label>
      <button :disabled="busy" type="submit"
        class="min-h-10 cursor-pointer rounded-[var(--radius)] border-0 bg-accent px-4 font-[inherit] text-sm font-semibold text-accent-foreground disabled:opacity-60">
        {{ busy ? 'Entrando…' : 'Entrar' }}
      </button>
      <p v-if="error" class="m-0 rounded-[var(--radius)] border border-danger/40 bg-danger/10 px-2 py-1 text-sm text-danger"><span aria-hidden="true">! </span>{{ error }}</p>
    </form>
  </div>
</template>
