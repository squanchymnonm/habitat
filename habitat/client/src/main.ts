import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/theme.css'
import { applyStoredTheme } from './composables/useTheme'
import { createHabitatRouter, syncSelectionWithRoute } from './router'
import { useSessions } from './stores/sessions'

applyStoredTheme()
const pinia = createPinia()
const router = createHabitatRouter()
const app = createApp(App).use(pinia).use(router)
syncSelectionWithRoute(router, useSessions(pinia))
app.mount('#app')
