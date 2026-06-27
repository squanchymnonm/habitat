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
  <div class="login">
    <form class="card" @submit.prevent="submit">
      <h1 class="wordmark">Hábita<span class="em">t</span></h1>
      <p class="sub">monitor de sesiones · Claude Code</p>
      <input v-model="user" placeholder="Usuario" autocomplete="username" autofocus />
      <input v-model="password" type="password" placeholder="Contraseña" autocomplete="current-password" />
      <button :disabled="busy" type="submit">{{ busy ? '…' : 'Entrar' }}</button>
      <p v-if="error" class="err">{{ error }}</p>
    </form>
  </div>
</template>

<style scoped>
.login{ display:flex; align-items:center; justify-content:center; min-height:100dvh; padding:24px; }
.card{ display:flex; flex-direction:column; gap:12px; padding:30px; min-width:300px; max-width:360px; width:100%;
  background:linear-gradient(180deg, var(--color-surface-2), var(--color-surface));
  border:1px solid var(--color-edge); border-radius:18px; box-shadow:var(--shadow-sh2); }
.wordmark{ font-family:var(--font-lore); font-weight:560; font-size:34px; text-align:center; margin:0; letter-spacing:-.01em; color:var(--color-ink); }
.wordmark .em{ color:var(--color-brass); text-shadow:0 0 22px rgba(224,169,75,.45); }
.sub{ text-align:center; margin:-4px 0 8px; color:var(--color-faint); font-size:12px; letter-spacing:.02em; }
.card input{ padding:11px 13px; font:inherit; color:var(--color-ink); background:var(--color-bg);
  border:1px solid var(--color-edge); border-radius:10px; }
.card input:focus-visible{ outline:2px solid var(--color-brass); outline-offset:1px; border-color:var(--color-brass-2); }
.card button{ padding:11px; font:inherit; font-weight:600; cursor:pointer; color:#1B1308; border:1px solid #F2C97A; border-radius:10px;
  background:linear-gradient(180deg,#F0BE63,var(--color-brass-2)); box-shadow:0 1px 0 rgba(255,255,255,.3) inset; }
.card button:disabled{ opacity:.6; cursor:default; }
.card button:hover:not(:disabled){ filter:brightness(1.06); }
.err{ color:var(--color-crimson); margin:0; text-align:center; font-size:13px; }
</style>
