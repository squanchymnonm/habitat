import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/theme.css'
import { applyStoredTheme } from './composables/useTheme'
import { installViewportHeight } from './composables/useViewport'
import { createHabitatRouter, syncSelectionWithRoute } from './router'
import { useSessions } from './stores/sessions'

applyStoredTheme()
installViewportHeight()
const pinia = createPinia()
const router = createHabitatRouter()
const app = createApp(App).use(pinia).use(router)
syncSelectionWithRoute(router, useSessions(pinia))
app.mount('#app')
