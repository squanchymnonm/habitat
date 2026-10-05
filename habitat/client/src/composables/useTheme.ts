import { ref } from 'vue'
import { THEMES, DEFAULT_THEME, type ThemeId } from '../theme/themes'

// Tema activo, global y por dispositivo (localStorage). Se aplica como data-theme en <html>.
const KEY = 'habitat.theme'
const valid = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v)

function read(): ThemeId {
  try {
    const v = localStorage.getItem(KEY)
    return valid(v) ? v : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

const theme = ref<ThemeId>(DEFAULT_THEME)

function apply(id: ThemeId) {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = id
}

export function applyStoredTheme() {
  theme.value = read()
  apply(theme.value)
}

export function useTheme() {
  function setTheme(id: ThemeId) {
    if (!valid(id)) return
    theme.value = id
    apply(id)
    try { localStorage.setItem(KEY, id) } catch { /* sin storage: queda sólo en memoria */ }
  }
  return { theme, themes: THEMES, setTheme }
}
