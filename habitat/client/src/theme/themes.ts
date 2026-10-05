// Registro de temas. Cada tema define los MISMOS tokens; los componentes sólo usan roles.
// Para sumar un tema: agregar una entrada acá y su bloque [data-theme] en tokens.css.
export type ThemeId = 'forja' | 'pizarra' | 'taberna'
export const TOKENS = [
  'background', 'surface', 'surface-raised', 'border', 'text', 'text-muted', 'accent', 'accent-foreground',
  'terminal-bg', 'terminal-fg', 'state-working', 'state-waiting', 'state-done', 'state-idle', 'state-error',
  'mana', 'stamina-ok', 'stamina-low', 'danger',
] as const
export type TokenName = (typeof TOKENS)[number]
export interface ThemeDef { id: ThemeId; name: string; swatch: [string, string, string]; colors: Record<TokenName, string> }

export const DEFAULT_THEME: ThemeId = 'forja'

export const THEMES: ThemeDef[] = [
  { id: 'forja', name: 'Forja refinada', swatch: ['#17140f', '#2a2419', '#e8a94b'], colors: {
    background: '#17140f', surface: '#1d1912', 'surface-raised': '#2a2419', border: '#2e281e', text: '#ece3d3', 'text-muted': '#a89c86',
    accent: '#e8a94b', 'accent-foreground': '#1a1408', 'terminal-bg': '#0f0d09', 'terminal-fg': '#d9cdb5',
    'state-working': '#e8a94b', 'state-waiting': '#e5604f', 'state-done': '#7fb069', 'state-idle': '#6b6253', 'state-error': '#d14b3c',
    mana: '#6fa3e0', 'stamina-ok': '#7fb069', 'stamina-low': '#e5604f', danger: '#e5604f' } },
  { id: 'pizarra', name: 'Pizarra pixel', swatch: ['#101319', '#1d2433', '#7aa2ff'], colors: {
    background: '#101319', surface: '#141821', 'surface-raised': '#1d2433', border: '#222838', text: '#dde3ee', 'text-muted': '#8f9ab0',
    accent: '#7aa2ff', 'accent-foreground': '#0b1020', 'terminal-bg': '#0a0c10', 'terminal-fg': '#c8d3e6',
    'state-working': '#ffb454', 'state-waiting': '#ff6b6b', 'state-done': '#5fd38d', 'state-idle': '#5b6478', 'state-error': '#ff4d5e',
    mana: '#7aa2ff', 'stamina-ok': '#5fd38d', 'stamina-low': '#ff6b6b', danger: '#ff6b6b' } },
  { id: 'taberna', name: 'Noche de taberna', swatch: ['#1a1626', '#2d2644', '#c4a7ff'], colors: {
    background: '#1a1626', surface: '#211c31', 'surface-raised': '#2d2644', border: '#2f2845', text: '#e9e4f5', 'text-muted': '#a89fc4',
    accent: '#c4a7ff', 'accent-foreground': '#1a1030', 'terminal-bg': '#110e1a', 'terminal-fg': '#d8d0ee',
    'state-working': '#ffc26b', 'state-waiting': '#ff7a90', 'state-done': '#6ee7b7', 'state-idle': '#6b6390', 'state-error': '#ff5c7a',
    mana: '#7cc4ff', 'stamina-ok': '#6ee7b7', 'stamina-low': '#ff7a90', danger: '#ff7a90' } },
]
