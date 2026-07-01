# Teclas en pantalla para la terminal (tablet) — Design

Fecha: 2026-07-01
Branch: sora

## Problema

En Android el teclado en pantalla (Gboard) no tiene flechas ↑/↓/←/→, ni Esc ni
Tab. Los menús de opciones que muestra Claude Code en la terminal se navegan con
flechas y se confirman/cancelan con Enter/Esc, así que **en la tablet no se pueden
navegar**. Lo mismo pasa en el editor (nvim), que necesita flechas y Esc.

## Objetivo

Una fila de botones en pantalla (`↑ ↓ ← → Enter Esc Tab`) que manden la tecla al
pty, disponible en la terminal principal (`DetailPanel`) y en el editor
(`EditorTerminal`), activable/desactivable desde Settings.

## Mecanismo (qué bytes se mandan)

Las teclas se mandan al pty reusando el envío por WebSocket que ya tiene
`useTerminal` (mismo canal que `insert()`).

Detalle fino: **las flechas cambian de secuencia según el modo del terminal**. Si la
app activó *application cursor keys* (DECCKM) —común en TUIs de pantalla completa—,
espera `\x1bOA`; si no, `\x1b[A`. Mandar la secuencia equivocada hace que la flecha
no funcione en algunas apps. xterm expone ese estado en
`term.modes.applicationCursorKeysMode`, así que se elige la secuencia en runtime,
igual que un teclado real:

- `↑`/`↓`/`→`/`←` → `\x1bO{A,B,C,D}` si DECCKM está activo; si no `\x1b[{A,B,C,D}`.
- `Enter` → `\r` · `Esc` → `\x1b` · `Tab` → `\t` (no dependen del modo).

## Visibilidad y toggle

El strip es una preferencia **por-dispositivo** (se quiere en la tablet, no en la PC),
así que se persiste en localStorage (patrón de `useCompactPods`), no en los settings
server-backed (`useSettings`), que sincronizarían el estado a todos los dispositivos.
Igual se expone el control en la pantalla **SETTINGS**.

- Nuevo composable `useTermKeys` (singleton con localStorage, clave
  `habitat.termKeys`): expone `enabled: Ref<boolean>` y `toggle()`.
- **Default inteligente:** si no hay valor guardado, arranca en
  `matchMedia('(pointer: coarse)').matches` → ON en táctil, OFF en desktop. Funciona
  solo en la tablet sin configurar nada, pero queda override manual desde Settings y
  persiste. La detección táctil es solo el *default*, no una regla fija.

## Arquitectura y componentes

- `useTerminal.ts`:
  - `type SpecialKey = 'up' | 'down' | 'left' | 'right' | 'enter' | 'esc' | 'tab'`
    (exportado).
  - `keySeq(key: SpecialKey, appCursorKeys: boolean): string` — función pura,
    exportada, testeable (tabla de arriba).
  - `sendKey(key: SpecialKey)` — lee `term.modes.applicationCursorKeysMode` y manda
    `keySeq(...)` por el WS. Se agrega a lo que devuelve el composable. No-op si el WS
    no está abierto (igual que `insert()`).
- `useTermKeys.ts` (nuevo):
  - `readInitialEnabled(stored: string | null, coarse: boolean): boolean` — función
    pura, exportada: si `stored` es `'1'`/`'0'` gana; si es `null`, devuelve `coarse`.
  - `enabled` (ref singleton) + `toggle()` que persiste `'1'|'0'` en localStorage.
    Guard `typeof localStorage`/`matchMedia` para importar en node (tests).
- `TermKeys.vue` (nuevo) — componente presentacional: la fila de botones. Emite
  `press(key: SpecialKey)`. Los botones hacen `@pointerdown.prevent` (o
  `@mousedown.prevent`/`@touchstart.prevent`) para **no robar el foco** del terminal,
  así el comportamiento es estable esté el teclado de Android abierto o cerrado.
- `DetailPanel.vue` — captura `sendKey` de `useTerminal`, renderiza
  `<TermKeys v-if="enabled" @press="sendKey" />` en la zona de la `term-bar`.
- `EditorTerminal.vue` — captura `sendKey`, agrega una barra chica que contiene
  `<TermKeys v-if="enabled" @press="sendKey" />`.
- `SettingsView.vue` — nueva fila con el toggle cableado a `useTermKeys`.

## Testing

- `useTerminal.test.ts`: `keySeq` para las 7 teclas; flechas en ambos modos DECCKM
  (`\x1bOA` vs `\x1b[A`); Enter/Esc/Tab constantes.
- `useTermKeys.test.ts`: `readInitialEnabled` — `'1'`→true, `'0'`→false, `null`+coarse
  true→true, `null`+coarse false→false.
- Verificación manual en la tablet: las flechas navegan los menús de Claude Code y
  funcionan en nvim (valida la detección de DECCKM en dispositivo); el toggle de
  Settings muestra/oculta el strip y persiste.

## Alcance

- ✅ Strip `↑ ↓ ← → Enter Esc Tab` en terminal principal y editor.
- ✅ Toggle en Settings (localStorage, default por detección táctil).
- ❌ Sin auto-repetición al mantener apretado.
- ❌ Sin combos Ctrl ni personalización de qué teclas (posibles extras futuros).

## Archivos afectados

- `habitat/client/src/composables/useTerminal.ts` — `SpecialKey`, `keySeq`, `sendKey`.
- `habitat/client/src/composables/useTermKeys.ts` — nuevo.
- `habitat/client/src/components/TermKeys.vue` — nuevo.
- `habitat/client/src/components/DetailPanel.vue` — montar el strip.
- `habitat/client/src/components/EditorTerminal.vue` — barra + strip.
- `habitat/client/src/components/SettingsView.vue` — fila del toggle.
- Tests: `useTerminal.test.ts` (ampliar), `useTermKeys.test.ts` (nuevo).
