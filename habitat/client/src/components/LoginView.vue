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
      <h1>HÁBITAT</h1>
      <input v-model="user" placeholder="Usuario" autocomplete="username" autofocus />
      <input v-model="password" type="password" placeholder="Contraseña" autocomplete="current-password" />
      <button :disabled="busy" type="submit">{{ busy ? '…' : 'Entrar' }}</button>
      <p v-if="error" class="err">{{ error }}</p>
    </form>
  </div>
</template>

<style scoped>
.login { display: flex; align-items: center; justify-content: center; min-height: 70vh; }
.card { display: flex; flex-direction: column; gap: 10px; padding: 24px; min-width: 260px; border: 1px solid var(--gold, #caa14a); border-radius: 8px; }
.card h1 { text-align: center; margin: 0 0 8px; letter-spacing: 2px; }
.card input, .card button { padding: 10px; font: inherit; }
.card button { background: var(--gold, #caa14a); color: #2a1c0a; border: none; cursor: pointer; }
.err { color: #d66; margin: 0; text-align: center; }
</style>
