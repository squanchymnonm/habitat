<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { startSocket } from './composables/useSocket'
import { useTabAlert } from './composables/useTabAlert'
import { useAuth } from './composables/useAuth'
import LoginView from './components/LoginView.vue'
import AppShell from './components/shell/AppShell.vue'

const { authed, checkAuth } = useAuth()
onMounted(checkAuth)
watch(authed, (v) => { if (v === true) startSocket() })
useTabAlert()
</script>

<template>
  <LoginView v-if="authed === false" />
  <AppShell v-else-if="authed === true" />
</template>
