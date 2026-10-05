import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { applyStoredTheme } from './composables/useTheme'
import './style.css'
import './styles/theme.css'

applyStoredTheme()
createApp(App).use(createPinia()).mount('#app')
