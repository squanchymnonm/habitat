<script setup lang="ts">
import { ref } from 'vue'
import { send } from '../composables/useSocket'
import type { Session } from '../types'

const props = defineProps<{ session: Session }>()
const text = ref('')
const sent = ref<string[]>([])

function submit() {
  const t = text.value.trim()
  if (!t) return
  send({ type: 'chat', id: props.session.id, text: t })
  sent.value.push(t)
  text.value = ''
}
</script>

<template>
  <div class="chatlog">
    <div v-for="(m, i) in sent" :key="i" class="msg-out">{{ m }}</div>
  </div>
  <form class="chat" @submit.prevent="submit">
    <input v-model="text" :placeholder="'Escribir a ' + session.name + '…'" />
    <button type="submit">Enviar</button>
  </form>
  <div class="phase2">
    El backend del chat (send-keys) llega en la fase 2.<br />
    Lo que escribís se envía por WS y queda registrado acá.
  </div>
</template>

<style scoped>
/* El chat es una caja de diálogo RPG (pergamino con marco 9-slice). */
.chatlog {
  flex: 1;
  overflow: auto;
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-end;
  padding: 16px;
  border: 16px solid transparent;
  border-image: url('/assets/ui/dialogsimple.png') 14 fill stretch;
  image-rendering: pixelated;
  min-height: 120px;
}
.msg-out {
  background: rgba(60, 40, 20, 0.08);
  padding: 6px 12px;
  font-family: var(--f-body);
  font-size: 19px;
  color: #3a2a18;
  max-width: 85%;
}
</style>
