# Rediseño de Habitat — PR 1: base, temas y navegación — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Habitat corre sobre la base nueva: shadcn-vue, tres temas intercambiables por tokens, vue-router, y un shell (`AppShell`) con barra superior y navegación de sesiones adaptativa (barra izquierda o pestañas arriba, ambas colapsables a avatar y luz). El combate queda eliminado del server y del cliente. El panel de foco sigue siendo el `DetailPanel` actual dentro del shell nuevo.

**Architecture:** Los tokens semánticos se definen como variables CSS por tema (`[data-theme]` en `<html>`) y se exponen a Tailwind v4 con `@theme inline`. `useTheme` y `useLayoutMode` son composables globales con persistencia en `localStorage`. El router (hash) se sincroniza con la selección del store `sessions`. La navegación se compone de `SessionNav` (decide el modo), `SessionSidebar`/`SessionTabs` (presentación) y `SessionAvatar` (sprite y luz). La lógica de datos no cambia: stores y composables existentes.

**Tech Stack:** Vue 3.5, Pinia, vue-router 4, shadcn-vue (Reka UI), Tailwind v4 (`@tailwindcss/vite`), Fontsource, vitest + happy-dom + @vue/test-utils. Server: Node 20 ESM + `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-05-habitat-redesign-design.md`

## Global Constraints

- Los componentes nuevos usan **solo tokens semánticos** (`bg-surface`, `text-muted`, `border-border`, `bg-accent`, `text-state-waiting`, etc.), nunca colores literales. Se permite CSS scoped solo para lo que Tailwind no cubre (`image-rendering: pixelated`).
- Temas: ids `forja` (por defecto), `pizarra` y `taberna`, con los valores de la tabla del spec §1. La clave en `localStorage` es `habitat.theme`.
- `useLayoutMode`: modos `'landscape' | 'portrait' | 'phone'`. Es `phone` si `min(ancho, alto) < 600`; `landscape` si `ancho > alto` y `ancho >= 900`; si no, `portrait`. El colapsado se guarda en `habitat.nav.collapsed.<modo>`.
- Rutas en hash: `#/`, `#/s/:id`, `#/board`, `#/settings/:section?`.
- Todo acceso a `localStorage` va en try/catch y es seguro en tests.
- Textos de UI y comentarios en español rioplatense, con la densidad de comentarios del código existente.
- No cambia el contrato HTTP/WS, salvo que desaparece el mensaje `fightResult`.
- La quest de todos (`session.quest`), el Quest Book (`_questbook`) y la stamina se conservan.
- Preflight de Tailwind: sigue **desactivado** en este PR (se activa en el PR 4).

## Rulings sobre el spec

- **Fuentes:** se usan paquetes **Fontsource** (`@fontsource-variable/inter`, etc.) importados desde CSS, en vez de copiar woff2 a mano a `public/fonts/`. Vite los empaqueta en el build, así que siguen siendo self-hosted (sin CDN), que es el requisito del spec.
- **Modo phone:** el spec decía "ancho menor a 600 px"; se usa `min(ancho, alto) < 600`, igual que el `isNarrowViewport` actual, para que un celular acostado también sea phone.
- **`#/board` en este PR:** redirige a `#/`, porque el tablero llega en el PR 3. El botón tablero/foco de la barra superior aparece en el PR 3.
- **Zoom y "Salir":** van temporalmente en el menú de usuario de la `TopBar`. El zoom pasa a Apariencia en el PR 4.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `habitat/server/state.js`, `hooks-logic.js`, `index.js`, `questbook.js` (mod) | eliminar combate |
| `habitat/client/src/types.ts`, `stores/sessions.ts`, `composables/useSocket.ts` (mod) | eliminar combate |
| `habitat/client/components.json`, `src/lib/utils.ts`, `src/components/ui/**` (nuevos) | shadcn-vue |
| `habitat/client/src/theme/themes.ts`, `src/theme/tokens.css`, `src/theme/contrast.ts` (nuevos) | registro de temas, variables, contraste |
| `habitat/client/src/composables/useTheme.ts`, `useLayoutMode.ts` (nuevos) | tema activo y modo de layout |
| `habitat/client/src/router.ts` (nuevo) | rutas y sincronización con la selección |
| `habitat/client/src/components/shell/AppShell.vue`, `TopBar.vue`, `ManaMeter.vue`, `SessionSummary.vue`, `UserMenu.vue` (nuevos) | shell |
| `habitat/client/src/components/sessions/SessionAvatar.vue`, `SessionNav.vue`, `SessionSidebar.vue`, `SessionTabs.vue` (nuevos) | navegación de sesiones |
| `habitat/client/src/views/FocusRoute.vue`, `SettingsRoute.vue` (nuevos) | vistas de ruta (envuelven `DetailPanel` y `SettingsView` en este PR) |
| Se eliminan | `HabitatLayout.vue`, `AppMenu.vue`, `UsageHud.vue`, `SessionRail.vue`, `SessionPod.vue`, `MiniArena.vue`, `useCompactPods.ts`, `useViewport.ts` (si queda sin uso), `useDayNight.ts` (si queda sin uso) y sus tests |

Comandos:
- Server: `cd habitat && node --test server/<f>.test.js`; suite completa con `cd habitat && npm test`.
- Cliente: `cd habitat/client && npx vitest run <ruta>`; suite completa con `npx vitest run`; typecheck y build con `npm run build`.

Branch: `feat/habitat-redesign`, que ya existe con el spec. Antes de arrancar: `git fetch origin && git merge origin/main`.

---

### Task 1: Eliminar el combate del server

**Files:**
- Modify: `habitat/server/state.js`, `habitat/server/hooks-logic.js`, `habitat/server/index.js`, `habitat/server/questbook.js`
- Modify (tests): `habitat/server/state.test.js`, `habitat/server/hooks-logic.test.js`, `habitat/server/questbook.test.js`, `habitat/server/index.test.js` (los que referencien combate)

**Interfaces:**
- Produces:
  - `applyEvent(store, payload, deps)` devuelve `{ session, removed?, rekey? }`, sin `fightResult`.
  - La sesión deja de tener `monster`, `combat`, `_touched` y `_lastTotal`.
  - Nuevo campo interno `_activeQuest: string | null`, con el label del todo `in_progress`, que reemplaza a `monster.label` para el Quest Book.
  - `completeQuest(book, questId)` sin stats de combate.

- [ ] **Step 1: Tests que fallan**

En `habitat/server/hooks-logic.test.js`, agregar al final, con los imports existentes del archivo (`applyEvent`, `createStore`, `newSession`):

```js
test('sin combate: un PostToolUse no crea monstruo ni stats de combate', () => {
  const store = createStore();
  applyEvent(store, { session_id: 's1', cwd: '/home/u/p', hook_event_name: 'SessionStart' }, { now: () => 1 });
  const { session } = applyEvent(store, {
    session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/x' },
  }, { now: () => 2, readUsage: () => ({ totalTokens: 500 }) });
  assert.equal(session.status, 'working');
  assert.equal('monster' in session, false);
  assert.equal('combat' in session, false);
  assert.equal('_touched' in session, false);
});

test('sin combate: applyEvent no devuelve fightResult y TodoWrite sigue armando la quest', () => {
  const store = createStore();
  const r = applyEvent(store, {
    session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }] },
  }, { now: () => 1 });
  assert.equal('fightResult' in r, false);
  assert.deepEqual(r.session.quest, { total: 2, done: 1 });
  assert.equal(r.session._activeQuest, 'b');
});

test('sin combate: completar un todo marca la quest en el Quest Book sin stats', () => {
  const store = createStore();
  const ev = (todos) => applyEvent(store, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'TodoWrite', tool_input: { todos } }, { now: () => 1 });
  ev([{ content: 'a', status: 'in_progress' }]);
  const { session } = ev([{ content: 'a', status: 'completed' }]);
  const q = session._questbook.quests.find((x) => x.id === 'a');
  assert.ok(q);
  assert.equal(q.monster ?? null, null);
});
```

En `habitat/server/state.test.js`:

```js
test('reviveSession descarta campos de combate persistidos', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'habitat-state-'));
  const p = join(dir, 's.json');
  writeFileSync(p, JSON.stringify([{ id: 's1', name: 'x', monster: { type: 'm', label: 'l' }, combat: { hits: 1, tokens: 2 }, _touched: ['/a'], _lastTotal: 9 }]));
  try {
    const store = createStore({ persistPath: p });
    const s = store.get('s1');
    for (const k of ['monster', 'combat', '_touched', '_lastTotal']) assert.equal(k in s, false, k);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

(Verificar que `createStore` esté importado en `state.test.js`; si no, sumarlo al import de `./state.js`).

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd habitat && node --test server/hooks-logic.test.js server/state.test.js 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: fallan los 4 tests nuevos.

- [ ] **Step 3: Implementar**

`habitat/server/state.js`:
- Eliminar `hashType`, `monsterFromTodos`, `randomMonster` y sus exports.
- En `newSession`, eliminar `monster: null`, `combat: { hits: 0, tokens: 0 }` y `_lastTotal: 0`.
- Reemplazar `serializeSession`/`reviveSession` por:
```js
// Campos del combate (eliminado): se descartan al cargar estado viejo y no se vuelven a escribir.
const DROPPED = ['monster', 'combat', '_touched', '_lastTotal'];

function serializeSession(s) {
  return { ...s };
}

function reviveSession(s) {
  for (const k of DROPPED) delete s[k];
  return s;
}
```

`habitat/server/hooks-logic.js`:
- El import de `./state.js` queda como `import { newSession, questFromTodos } from './state.js';`.
- `ensure()`: sacar `s._touched = new Set();` y `if (!s._touched) s._touched = new Set();`.
- Eliminar `ensureMonster`.
- Rekey (`/clear`, ~L95-113): sacar `prev.monster`, `prev.combat`, `prev._lastTotal` y `prev._touched`; el `return` queda `{ session: prev, rekey: { from: oldId, to: prev.id } }`.
- Los `return { session: null, fightResult: null }` y `{ session: null, fightResult: null, removed: null }` quedan `{ session: null }` y `{ session: null, removed: null }`.
- Sacar `let fightResult = null;` del switch principal y el `return` queda `{ session: s, removed }`.
- `SessionStart`: sacar `s.monster = null;`.
- `UserPromptSubmit`: eliminar el bloque `if (s.monster?.source !== 'todo') { … }` entero.
- `Stop`: eliminar el bloque `if (s.monster && s.monster.source === 'turn') { … }` entero.
- `SessionEnd`: sacar `s.monster = null;`.
- `PreToolUse`/`PostToolUse`: `if (payload.tool_name === 'TodoWrite') handleTodoWrite(s, payload, now, deps); else handleHit(s, payload, deps);`
- Reemplazar `handleTodoWrite` por:
```js
// Label del todo en curso (in_progress), o null. Es el id de la quest activa del Quest Book.
function activeTodoLabel(todos) {
  const t = todos.find((x) => x.status === 'in_progress');
  return t ? (t.content || t.activeForm || '') : null;
}

function handleTodoWrite(s, payload, now, deps) {
  const todos = (payload.tool_input && payload.tool_input.todos) || [];
  const prevDone = s.quest ? s.quest.done : 0;
  const prevActive = s._activeQuest || null;
  s.quest = questFromTodos(todos);

  // Quest Book: acumular quests (no borra las que salen del plan).
  upsertQuests(s._questbook, todos, { originPrompt: s._currentPrompt, now: now() });

  // ¿se completó un todo? (subió done) -> la quest que estaba en curso quedó cumplida
  if (s.quest.done > prevDone && prevActive) completeQuest(s._questbook, prevActive);

  const next = activeTodoLabel(todos);
  s._activeQuest = next;
  // Quest Book: capturar el resumen de Claude cuando una quest entra en curso.
  // Solo leemos el transcript si la quest todavía no tiene resumen (setClaudeSummary
  // es write-once: leer de nuevo sería trabajo descartado).
  if (next && deps && deps.readLastAssistantText) {
    const q = s._questbook.quests.find((x) => x.id === next);
    if (q && !q.claudeSummary) {
      setClaudeSummary(s._questbook, next, deps.readLastAssistantText(payload.transcript_path));
    }
  }
  setStatus(s, 'working', 'planificando', now);
}
```
- Reemplazar `handleHit` por:
```js
function handleHit(s, payload, deps) {
  const { now } = deps;
  setStatus(s, 'working', payload.tool_name || 'trabajando', now);
  s._resting = false;
}
```
  Antes, verificar si `readUsage` o `EDIT_TOOLS` siguen usándose en otro lugar del archivo. Si `EDIT_TOOLS` queda sin uso, eliminarlo. `readUsage` puede seguir en `deps` de otros eventos; no tocar su firma.

`habitat/server/questbook.js`: `completeQuest(book, questId, { monster = null, damage = 0, hits = 0 } = {})` pasa a `completeQuest(book, questId)`. Eliminar las asignaciones `q.monster = monster;` (y las de daño y golpes si existen). Dejar el campo `monster: null` en las quests nuevas solo si otro código lo lee; si no, eliminarlo también (el cliente lo trata como opcional).

`habitat/server/index.js` (~L262-274): `const { session, removed, rekey } = applyEvent(...)` y eliminar la línea `if (fightResult) hub.broadcast({ type: 'fightResult', ...fightResult });`.

Tests existentes: `grep -n "monster\|combat\|fightResult\|_touched\|randomMonster\|monsterFromTodos\|hashType\|lastDamage" server/*.test.js`. Eliminar los tests que verifican comportamiento de combate y ajustar los que solo lo mencionan de paso (por ejemplo, asserts de `fightResult: null`). El test de `questbook.test.js` que llama `completeQuest(b, 'a', { monster: 'a', damage: 1234, hits: 7 })` pasa a `completeQuest(b, 'a')` y deja de asertar `monster`.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `cd habitat && npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add habitat/server
git commit -m "refactor(habitat): eliminar el combate del server"
```

---

### Task 2: Eliminar el combate del cliente

**Files:**
- Modify: `habitat/client/src/types.ts`, `habitat/client/src/stores/sessions.ts`, `habitat/client/src/composables/useSocket.ts`, `habitat/client/src/components/DetailPanel.vue`, `habitat/client/src/sprites.ts`
- Modify (tests): los que referencien `fight`, `lastFight`, `monster`, `combat`, `MiniArena`, `heroPoseFor`, `monsterSprite`, `bossSprite`
- Delete: `habitat/client/src/components/MiniArena.vue`. `SessionPod.vue` lo importa; ese componente se elimina en la Task 8, así que en esta tarea se quita de `SessionPod` el bloque `<div class="niche">…<MiniArena/></div>` y su import.

**Interfaces:**
- Produces: `Session` sin `monster`/`combat`; el store sin `fight`/`lastFight`; `ServerMessage` sin `fightResult`.

- [ ] **Step 1: Test que falla**

En `habitat/client/src/stores/sessions.test.ts`, agregar:

```ts
it('el store ya no expone combate', () => {
  setActivePinia(createPinia())
  const s = useSessions() as unknown as Record<string, unknown>
  expect('fight' in s).toBe(false)
  expect('lastFight' in s).toBe(false)
})
```

(Usar los imports que ya tenga el archivo para `setActivePinia`, `createPinia` y `useSessions`; agregarlos si faltan).

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd habitat/client && npx vitest run src/stores/sessions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

- `types.ts`:
  - eliminar `Monster`, `Combat` y `FightResult`;
  - en `Session`, quitar `monster?` y `combat?`;
  - en `ServerMessage`, quitar `| { type: 'fightResult'; … }`;
  - en el tipo de quest del Quest Book (~L118), dejar `monster?: string | null` como opcional, porque el estado viejo todavía puede traerlo.
- `stores/sessions.ts`: quitar el import de `FightResult`, `lastFight`, `seq`, `fight()` y sus entradas en el `return`.
- `useSocket.ts`: quitar la línea de `fightResult`.
- `DetailPanel.vue`:
  - eliminar el bloque "Overlay de loot" del script (`lootShown`, `loot` y el `watch` de `store.lastFight`), el `<div class="loot">…</div>` del template y su CSS (`.loot*`);
  - quitar `FightResult` y, si queda sin uso, `fmt` de los imports.
- `sprites.ts`:
  - eliminar `monsterSprite`, `bossSprite`, `MONSTERS` y los `BOSSES`/hash que solo usen esas funciones;
  - eliminar `Pose`, `POSE_RENDER`, `heroSprite`, `heroPoseFor` y `HeroPoseInput` si solo los usa `MiniArena` (verificar con grep);
  - conservar `CHARACTERS`, `charFor`, `heroIdle`, `faceFor`, `fmt`, `ago` y `staminaHue`.
- Eliminar `components/MiniArena.vue` y quitar su uso en `SessionPod.vue`.
- Tests:
  - `grep -rn "fight\|lastFight\|monster\|combat\|MiniArena\|heroPoseFor\|monsterSprite\|bossSprite\|POSE_RENDER" src --include=*.test.ts`;
  - eliminar los tests de funciones borradas y ajustar los fixtures que pasen `monster`/`combat`.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `cd habitat/client && npx vitest run && npm run build 2>&1 | tail -2`
Expected: tests en verde y build OK.

- [ ] **Step 5: Commit**

```bash
git add -A habitat/client/src
git commit -m "refactor(habitat): eliminar el combate del cliente"
```

---

### Task 3: shadcn-vue, alias `@`, fuentes y tokens de tema

**Files:**
- Modify: `habitat/client/package.json` (deps), `habitat/client/vite.config.ts`, `habitat/client/tsconfig.json`, `habitat/client/src/main.ts`, `habitat/client/src/styles/theme.css`
- Create: `habitat/client/components.json`, `habitat/client/src/lib/utils.ts`, `habitat/client/src/theme/tokens.css`, `habitat/client/src/theme/themes.ts`, `habitat/client/src/theme/contrast.ts`, `habitat/client/src/theme/contrast.test.ts`, `habitat/client/src/components/ui/**` (generados)

**Interfaces:**
- Produces:
  - alias `@` → `src`;
  - `cn(...inputs)` en `@/lib/utils`;
  - componentes en `@/components/ui/{button,badge,tooltip,dropdown-menu,separator,scroll-area}`;
  - clases de Tailwind: `bg-background`, `bg-surface`, `bg-surface-raised`, `border-border`, `text-text`, `text-muted`, `bg-accent`, `text-accent-foreground`, `bg-terminal-bg`, `text-terminal-fg`, `{bg,text}-state-{working,waiting,done,idle,error}`, `bg-mana`, `bg-stamina-ok`, `bg-stamina-low`, `text-danger`, `font-ui`, `font-mono`, `font-display`, `rounded-[var(--radius)]`;
  - `THEMES: ThemeDef[]` (`{ id: ThemeId; name: string; swatch: [string, string, string]; colors: Record<TokenName, string> }`), `type ThemeId = 'forja' | 'pizarra' | 'taberna'`, `DEFAULT_THEME = 'forja'`;
  - `contrastRatio(hexA, hexB): number` en `@/theme/contrast`.

- [ ] **Step 1: Dependencias y alias**

```bash
cd habitat/client
npm install vue-router@4 reka-ui class-variance-authority clsx tailwind-merge lucide-vue-next @vueuse/core \
  @fontsource-variable/inter @fontsource-variable/space-grotesk @fontsource-variable/jetbrains-mono \
  @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono @fontsource/press-start-2p
npm install -D @types/node
```

`vite.config.ts`: agregar `import { fileURLToPath, URL } from 'node:url'` y en `defineConfig` sumar
`resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },`.

`tsconfig.json`, en `compilerOptions`: `"baseUrl": ".", "paths": { "@/*": ["./src/*"] }`.

`components.json` (nuevo):
```json
{
  "$schema": "https://shadcn-vue.com/schema.json",
  "style": "new-york",
  "typescript": true,
  "tailwind": { "config": "", "css": "src/styles/theme.css", "baseColor": "neutral", "cssVariables": true, "prefix": "" },
  "aliases": { "components": "@/components", "composables": "@/composables", "utils": "@/lib/utils", "ui": "@/components/ui", "lib": "@/lib" },
  "iconLibrary": "lucide"
}
```

`src/lib/utils.ts` (nuevo):
```ts
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

Generar los componentes base:
```bash
npx shadcn-vue@latest add button badge tooltip dropdown-menu separator scroll-area --yes
```
Si el CLI intenta modificar `src/styles/theme.css` agregando variables propias (`--primary`, `--card`, etc.), revertir esos cambios en ese archivo: los tokens son los nuestros (Step 2). Después de generar, reemplazar en `src/components/ui/**` las clases de colores de shadcn por nuestros tokens:

| shadcn | nuestro |
|---|---|
| `bg-primary` / `text-primary-foreground` | `bg-accent` / `text-accent-foreground` |
| `bg-secondary`, `bg-muted`, `bg-accent` (hover) | `bg-surface-raised` |
| `text-muted-foreground` | `text-muted` |
| `bg-popover`, `bg-card`, `bg-background` | `bg-surface` (popover/card) o `bg-background` |
| `text-popover-foreground`, `text-card-foreground`, `text-foreground` | `text-text` |
| `border-input`, `border` (color por defecto) | `border-border` |
| `bg-destructive` / `text-destructive` | `bg-danger` / `text-danger` |
| `ring-ring`, `ring-offset-background` | `ring-accent`, `ring-offset-background` |

Verificar con `grep -rnE "primary|secondary|muted-foreground|popover|destructive|ring-ring|card-foreground" src/components/ui` que no quede ninguna.

- [ ] **Step 2: Tokens y temas**

`src/theme/themes.ts` (nuevo). Valores del spec §1; `radius` en px; `radiusPill` solo en taberna:
```ts
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
```

`src/theme/tokens.css` (nuevo). Cada bloque repite los valores de `themes.ts`; el test de contraste verifica que coincidan:
```css
/* Fuentes self-hosted (Fontsource, empaquetadas por Vite: sin CDN). */
@import '@fontsource-variable/inter';
@import '@fontsource-variable/space-grotesk';
@import '@fontsource-variable/jetbrains-mono';
@import '@fontsource/ibm-plex-sans/400.css';
@import '@fontsource/ibm-plex-sans/600.css';
@import '@fontsource/ibm-plex-mono/400.css';
@import '@fontsource/press-start-2p/400.css';

/* Tokens semánticos por tema. Los valores deben coincidir con theme/themes.ts. */
:root, [data-theme='forja'] {
  --background:#17140f; --surface:#1d1912; --surface-raised:#2a2419; --border:#2e281e; --text:#ece3d3; --text-muted:#a89c86;
  --accent:#e8a94b; --accent-foreground:#1a1408; --terminal-bg:#0f0d09; --terminal-fg:#d9cdb5;
  --state-working:#e8a94b; --state-waiting:#e5604f; --state-done:#7fb069; --state-idle:#6b6253; --state-error:#d14b3c;
  --mana:#6fa3e0; --stamina-ok:#7fb069; --stamina-low:#e5604f; --danger:#e5604f;
  --font-ui:'Inter Variable', system-ui, sans-serif; --font-mono:'JetBrains Mono Variable', ui-monospace, monospace;
  --font-display:'Space Grotesk Variable', 'Inter Variable', sans-serif;
  --radius:8px; --radius-pill:8px;
}
[data-theme='pizarra'] {
  --background:#101319; --surface:#141821; --surface-raised:#1d2433; --border:#222838; --text:#dde3ee; --text-muted:#8f9ab0;
  --accent:#7aa2ff; --accent-foreground:#0b1020; --terminal-bg:#0a0c10; --terminal-fg:#c8d3e6;
  --state-working:#ffb454; --state-waiting:#ff6b6b; --state-done:#5fd38d; --state-idle:#5b6478; --state-error:#ff4d5e;
  --mana:#7aa2ff; --stamina-ok:#5fd38d; --stamina-low:#ff6b6b; --danger:#ff6b6b;
  --font-ui:'IBM Plex Sans', system-ui, sans-serif; --font-mono:'IBM Plex Mono', ui-monospace, monospace;
  --font-display:'Press Start 2P', monospace;
  --radius:4px; --radius-pill:4px;
}
[data-theme='taberna'] {
  --background:#1a1626; --surface:#211c31; --surface-raised:#2d2644; --border:#2f2845; --text:#e9e4f5; --text-muted:#a89fc4;
  --accent:#c4a7ff; --accent-foreground:#1a1030; --terminal-bg:#110e1a; --terminal-fg:#d8d0ee;
  --state-working:#ffc26b; --state-waiting:#ff7a90; --state-done:#6ee7b7; --state-idle:#6b6390; --state-error:#ff5c7a;
  --mana:#7cc4ff; --stamina-ok:#6ee7b7; --stamina-low:#ff7a90; --danger:#ff7a90;
  --font-ui:'Inter Variable', system-ui, sans-serif; --font-mono:'JetBrains Mono Variable', ui-monospace, monospace;
  --font-display:'Space Grotesk Variable', 'Inter Variable', sans-serif;
  --radius:10px; --radius-pill:999px;
}
```

`src/styles/theme.css`:
- reemplazar el bloque `@font-face` de Fraunces, Hanken y JetBrains, y el `@theme{…}` viejo, por `@import '../theme/tokens.css';`;
- agregar el puente a Tailwind:
```css
@theme inline {
  --color-background: var(--background); --color-surface: var(--surface); --color-surface-raised: var(--surface-raised);
  --color-border: var(--border); --color-text: var(--text); --color-muted: var(--text-muted);
  --color-accent: var(--accent); --color-accent-foreground: var(--accent-foreground);
  --color-terminal-bg: var(--terminal-bg); --color-terminal-fg: var(--terminal-fg);
  --color-state-working: var(--state-working); --color-state-waiting: var(--state-waiting); --color-state-done: var(--state-done);
  --color-state-idle: var(--state-idle); --color-state-error: var(--state-error);
  --color-mana: var(--mana); --color-stamina-ok: var(--stamina-ok); --color-stamina-low: var(--stamina-low); --color-danger: var(--danger);
  --font-ui: var(--font-ui); --font-mono: var(--font-mono); --font-display: var(--font-display);
}
```

Las variables viejas (`--color-brass`, `--color-ink`, `--color-surface-2`, `--font-lore`, `--radius-card`, etc.) **siguen usándose** en los componentes legacy hasta los PRs 2 a 4. Para no romperlos, agregar en `theme.css` un bloque de alias legacy sobre los tokens nuevos:
```css
/* Alias legacy: los componentes viejos siguen pidiendo estas variables hasta su migración (PR 2–4). */
:root {
  --color-bg: var(--background); --color-surface: var(--surface); --color-surface-2: var(--surface-raised); --color-raise: var(--surface-raised);
  --color-line: var(--terminal-bg); --color-edge: var(--border); --color-edge-soft: var(--border);
  --color-ink: var(--text); --color-ink-2: var(--text); --color-dim: var(--text-muted); --color-faint: var(--text-muted);
  --color-brass: var(--accent); --color-brass-2: var(--accent); --color-ember: var(--state-working); --color-amber: var(--state-working);
  --color-moss: var(--state-done); --color-crimson: var(--state-error); --color-mana: var(--mana);
  --font-lore: var(--font-display); --font-system: var(--font-ui); --font-machine: var(--font-mono);
  --radius-sm: var(--radius); --radius-card: calc(var(--radius) + 4px); --radius-medallion: calc(var(--radius) + 8px);
  --shadow-sh1: 0 1px 2px rgba(0,0,0,.35); --shadow-sh2: 0 8px 28px rgba(0,0,0,.45); --shadow-glow-brass: 0 0 0 1px var(--accent);
}
```
Ojo: `--color-surface` legacy y `--color-surface` del puente de Tailwind tienen el mismo nombre y el mismo valor (`var(--surface)`), así que no hay conflicto. Dejar el bloque `@theme inline` **después** del alias.

El `body` del `@layer base` queda: `body{ font-family:var(--font-ui); color:var(--text); background:var(--background); }`.

`src/theme/contrast.ts` (nuevo):
```ts
// Contraste WCAG 2.x entre dos colores hex (#rrggbb).
function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
```

- [ ] **Step 3: Test de contraste y de coincidencia con el CSS**

`src/theme/contrast.test.ts` (nuevo):
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { THEMES, TOKENS } from './themes'
import { contrastRatio } from './contrast'

const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8')

describe('temas', () => {
  it('contrastRatio: blanco/negro = 21', () => {
    expect(Math.round(contrastRatio('#ffffff', '#000000'))).toBe(21)
  })

  for (const t of THEMES) {
    describe(t.id, () => {
      const c = t.colors
      it('texto AA (4.5:1)', () => {
        expect(contrastRatio(c.text, c.background)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(c.text, c.surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(c.text, c['surface-raised'])).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(c['text-muted'], c.surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(c['accent-foreground'], c.accent)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(c['terminal-fg'], c['terminal-bg'])).toBeGreaterThanOrEqual(4.5)
      })
      it('UI y estados (3:1 contra surface)', () => {
        for (const k of ['accent', 'state-working', 'state-waiting', 'state-done', 'state-error', 'mana'] as const) {
          expect(contrastRatio(c[k], c.surface), k).toBeGreaterThanOrEqual(3)
        }
      })
      it('tokens.css define los mismos valores', () => {
        const sel = t.id === 'forja' ? ":root, [data-theme='forja']" : `[data-theme='${t.id}']`
        const block = css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)))
        for (const k of TOKENS) expect(block.toLowerCase(), k).toContain(`--${k}:${c[k].toLowerCase()}`)
      })
    })
  }
})
```

`state-idle` se excluye del 3:1 a propósito, porque es un estado atenuado. Si algún par falla, **ajustar el valor en `themes.ts` y en `tokens.css`** (oscureciendo o aclarando lo mínimo) hasta pasar, y anotar el cambio en el reporte. No bajar el umbral.

- [ ] **Step 4: Correr**

Run: `cd habitat/client && npx vitest run src/theme && npx vitest run && npm run build 2>&1 | tail -2`
Expected: todo en verde y build OK. La app legacy se sigue viendo, ahora con la paleta forja a través de los alias.

- [ ] **Step 5: Commit**

```bash
git add -A habitat/client
git commit -m "feat(habitat): base de shadcn-vue, tokens semánticos y tres temas"
```

---

### Task 4: `useTheme` y `useLayoutMode`

**Files:**
- Create: `habitat/client/src/composables/useTheme.ts`, `useTheme.test.ts`, `useLayoutMode.ts`, `useLayoutMode.test.ts`
- Modify: `habitat/client/src/main.ts` (aplicar el tema antes de montar)

**Interfaces:**
- Produces:
  - `useTheme(): { theme: Ref<ThemeId>, themes: ThemeDef[], setTheme(id: ThemeId): void }` y `applyStoredTheme(): void`;
  - `layoutModeFor(w: number, h: number): LayoutMode`;
  - `useLayoutMode(): { mode: Ref<LayoutMode>, collapsed: ComputedRef<boolean>, toggleCollapsed(): void, setCollapsed(v: boolean): void }`, con `type LayoutMode = 'landscape' | 'portrait' | 'phone'`.

- [ ] **Step 1: Tests que fallan**

`useTheme.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); vi.resetModules() })

describe('useTheme', () => {
  it('default forja y aplica data-theme', async () => {
    const { useTheme, applyStoredTheme } = await import('./useTheme')
    applyStoredTheme()
    expect(useTheme().theme.value).toBe('forja')
    expect(document.documentElement.dataset.theme).toBe('forja')
  })
  it('setTheme persiste y aplica', async () => {
    const { useTheme } = await import('./useTheme')
    useTheme().setTheme('taberna')
    expect(localStorage.getItem('habitat.theme')).toBe('taberna')
    expect(document.documentElement.dataset.theme).toBe('taberna')
  })
  it('lee el guardado e ignora ids inválidos', async () => {
    localStorage.setItem('habitat.theme', 'pizarra')
    let m = await import('./useTheme'); m.applyStoredTheme()
    expect(m.useTheme().theme.value).toBe('pizarra')
    vi.resetModules(); localStorage.setItem('habitat.theme', 'nope')
    m = await import('./useTheme'); m.applyStoredTheme()
    expect(m.useTheme().theme.value).toBe('forja')
  })
  it('sobrevive a un localStorage que lanza', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    const { useTheme, applyStoredTheme } = await import('./useTheme')
    expect(() => applyStoredTheme()).not.toThrow()
    expect(useTheme().theme.value).toBe('forja')
    spy.mockRestore()
  })
})
```

`useLayoutMode.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { layoutModeFor } from './useLayoutMode'

describe('layoutModeFor', () => {
  it('phone si el lado menor < 600', () => {
    expect(layoutModeFor(400, 860)).toBe('phone')
    expect(layoutModeFor(860, 400)).toBe('phone')
  })
  it('landscape si ancho > alto y ancho >= 900', () => {
    expect(layoutModeFor(1440, 900)).toBe('landscape')
    expect(layoutModeFor(1180, 820)).toBe('landscape')
  })
  it('portrait en el resto', () => {
    expect(layoutModeFor(820, 1180)).toBe('portrait')
    expect(layoutModeFor(880, 700)).toBe('portrait')
  })
})

describe('useLayoutMode colapsado por modo', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules() })
  it('persiste por modo', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
    const { useLayoutMode } = await import('./useLayoutMode')
    const l = useLayoutMode()
    expect(l.mode.value).toBe('landscape')
    expect(l.collapsed.value).toBe(false)
    l.toggleCollapsed()
    expect(l.collapsed.value).toBe(true)
    expect(localStorage.getItem('habitat.nav.collapsed.landscape')).toBe('1')
    expect(localStorage.getItem('habitat.nav.collapsed.portrait')).toBeNull()
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd habitat/client && npx vitest run src/composables/useTheme.test.ts src/composables/useLayoutMode.test.ts`
Expected: FAIL (no existen los módulos).

- [ ] **Step 3: Implementar**

`useTheme.ts`:
```ts
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
```

`useLayoutMode.ts`:
```ts
import { ref, computed } from 'vue'

// Modo de layout según el tamaño de la ventana. phone: el lado menor no llega a 600
// (celular, también acostado). landscape: más ancho que alto y al menos 900 de ancho
// (barra de sesiones a la izquierda). portrait: el resto (pestañas arriba).
export type LayoutMode = 'landscape' | 'portrait' | 'phone'

export function layoutModeFor(w: number, h: number): LayoutMode {
  if (Math.min(w, h) < 600) return 'phone'
  if (w > h && w >= 900) return 'landscape'
  return 'portrait'
}

const KEY = (m: LayoutMode) => `habitat.nav.collapsed.${m}`
function readCollapsed(m: LayoutMode): boolean {
  try { return localStorage.getItem(KEY(m)) === '1' } catch { return false }
}

const size = () => (typeof window === 'undefined' ? [1440, 900] : [window.innerWidth, window.innerHeight])
const mode = ref<LayoutMode>(layoutModeFor(...(size() as [number, number])))
const collapsedByMode = ref<Record<LayoutMode, boolean>>({
  landscape: readCollapsed('landscape'), portrait: readCollapsed('portrait'), phone: false,
})

let listening = false
function listen() {
  if (listening || typeof window === 'undefined') return
  listening = true
  // resize cubre también la rotación en tablets.
  window.addEventListener('resize', () => { mode.value = layoutModeFor(window.innerWidth, window.innerHeight) })
}

export function useLayoutMode() {
  listen()
  const collapsed = computed(() => collapsedByMode.value[mode.value])
  function setCollapsed(v: boolean) {
    if (mode.value === 'phone') return
    collapsedByMode.value = { ...collapsedByMode.value, [mode.value]: v }
    try { localStorage.setItem(KEY(mode.value), v ? '1' : '0') } catch { /* sin storage */ }
  }
  function toggleCollapsed() { setCollapsed(!collapsed.value) }
  return { mode, collapsed, setCollapsed, toggleCollapsed }
}
```

`main.ts`: importar `applyStoredTheme` desde `./composables/useTheme` y llamarlo antes de `createApp(...)`.

- [ ] **Step 4: Correr**

Run: `cd habitat/client && npx vitest run src/composables/useTheme.test.ts src/composables/useLayoutMode.test.ts && npm run build 2>&1 | tail -1`
Expected: PASS y build OK.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src
git commit -m "feat(habitat): useTheme y useLayoutMode"
```

---

### Task 5: Router y sincronización con la selección

**Files:**
- Create: `habitat/client/src/router.ts`, `habitat/client/src/router.test.ts`, `habitat/client/src/views/FocusRoute.vue`, `habitat/client/src/views/SettingsRoute.vue`

**Interfaces:**
- Consumes: el store `useSessions` (`list`, `selectedId`, `select`).
- Produces:
  - `createHabitatRouter(history?: RouterHistory): Router`, con rutas `/` (name `focus`), `/s/:id` (name `session`), `/board` (redirige a `/`), `/settings/:section?` (name `settings`) y `/:pathMatch(.*)*` (redirige a `/`);
  - `syncSelectionWithRoute(router, store): void`.

- [ ] **Step 1: Test que falla**

`router.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import { createHabitatRouter, syncSelectionWithRoute } from './router'
import { useSessions } from './stores/sessions'

const sess = (id: string) => ({ id, name: id, project: 'p', branch: '', status: 'idle', action: '', since: 0, stamina: 100 }) as any

beforeEach(() => setActivePinia(createPinia()))

describe('router', () => {
  it('/s/:id selecciona la sesión', async () => {
    const store = useSessions(); store.setAll([sess('a'), sess('b')])
    const router = createHabitatRouter(createMemoryHistory()); syncSelectionWithRoute(router, store)
    await router.push('/s/b'); await router.isReady()
    expect(store.selectedId).toBe('b')
  })
  it('seleccionar en el store actualiza la ruta', async () => {
    const store = useSessions(); store.setAll([sess('a'), sess('b')])
    const router = createHabitatRouter(createMemoryHistory()); syncSelectionWithRoute(router, store)
    await router.push('/'); await router.isReady()
    store.select('b'); await new Promise((r) => setTimeout(r, 0))
    expect(router.currentRoute.value.fullPath).toBe('/s/b')
  })
  it('id inexistente redirige a /', async () => {
    const store = useSessions(); store.setAll([sess('a')])
    const router = createHabitatRouter(createMemoryHistory()); syncSelectionWithRoute(router, store)
    await router.push('/s/zzz'); await router.isReady(); await new Promise((r) => setTimeout(r, 0))
    expect(router.currentRoute.value.path).toBe('/')
  })
  it('/board redirige a / (el tablero llega en el PR 3)', async () => {
    const router = createHabitatRouter(createMemoryHistory())
    await router.push('/board'); await router.isReady()
    expect(router.currentRoute.value.path).toBe('/')
  })
  it('settings acepta sección', async () => {
    const router = createHabitatRouter(createMemoryHistory())
    await router.push('/settings/appearance'); await router.isReady()
    expect(router.currentRoute.value.name).toBe('settings')
    expect(router.currentRoute.value.params.section).toBe('appearance')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd habitat/client && npx vitest run src/router.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`router.ts`:
```ts
import { createRouter, createWebHashHistory, type Router, type RouterHistory } from 'vue-router'
import { watch } from 'vue'
import type { useSessions } from './stores/sessions'

// Hash history: funciona detrás de Tailscale/LAN sin tocar el server (no hay rutas server-side).
export function createHabitatRouter(history: RouterHistory = createWebHashHistory()): Router {
  return createRouter({
    history,
    routes: [
      { path: '/', name: 'focus', component: () => import('./views/FocusRoute.vue') },
      { path: '/s/:id', name: 'session', component: () => import('./views/FocusRoute.vue') },
      { path: '/board', redirect: '/' }, // el tablero llega en el PR 3
      { path: '/settings/:section?', name: 'settings', component: () => import('./views/SettingsRoute.vue') },
      { path: '/:pathMatch(.*)*', redirect: '/' },
    ],
  })
}

// Selección del store <-> ruta, en ambos sentidos. Sólo actúa en las rutas de foco:
// estar en ajustes no cambia la selección ni la URL.
export function syncSelectionWithRoute(router: Router, store: ReturnType<typeof useSessions>) {
  const fromRoute = () => {
    const r = router.currentRoute.value
    if (r.name !== 'session') return
    const id = String(r.params.id)
    if (store.list.some((s) => s.id === id)) {
      if (store.selectedId !== id) store.select(id)
    } else if (store.list.length) {
      router.replace('/') // id inexistente (sesión cerrada, link viejo)
    }
  }
  watch(() => router.currentRoute.value.fullPath, fromRoute, { immediate: true })
  // La lista puede llegar después que la ruta (snapshot del WS): reintentar.
  watch(() => store.list.map((s) => s.id).join(','), fromRoute)
  watch(() => store.selectedId, (id) => {
    const r = router.currentRoute.value
    if (r.name !== 'focus' && r.name !== 'session') return
    const target = id ? `/s/${id}` : '/'
    if (r.fullPath !== target) router.replace(target)
  })
}
```

`views/FocusRoute.vue`: envuelve el `DetailPanel` actual y re-fitea la terminal cuando cambia el tamaño de su contenedor (la barra que colapsa no dispara `resize` del window):
```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useZoom } from '../composables/useZoom'
import DetailPanel from '../components/DetailPanel.vue'

const host = ref<HTMLElement | null>(null)
const panel = ref<InstanceType<typeof DetailPanel> | null>(null)
const { zoom } = useZoom()
const refit = () => nextTick(() => requestAnimationFrame(() => panel.value?.fit()))
let ro: ResizeObserver | null = null
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && host.value) { ro = new ResizeObserver(refit); ro.observe(host.value) }
})
onUnmounted(() => ro?.disconnect())
// Cambiar el zoom del root no dispara resize: re-fitear a mano.
watch(zoom, refit)
</script>

<template>
  <div ref="host" class="h-full min-h-0 min-w-0">
    <DetailPanel ref="panel" />
  </div>
</template>
```

`views/SettingsRoute.vue` (transitorio hasta el PR 4):
```vue
<script setup lang="ts">
import SettingsView from '../components/SettingsView.vue'
</script>

<template>
  <div class="h-full overflow-auto"><SettingsView /></div>
</template>
```

- [ ] **Step 4: Correr**

Run: `cd habitat/client && npx vitest run src/router.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src
git commit -m "feat(habitat): router con hash y sincronización con la sesión seleccionada"
```

---

### Task 6: `SessionAvatar` y `SessionNav` (barra lateral y pestañas)

**Files:**
- Create: `habitat/client/src/components/sessions/SessionAvatar.vue`, `SessionSidebar.vue`, `SessionTabs.vue`, `SessionNav.vue`, `SessionNav.test.ts`, `SessionAvatar.test.ts`
- Modify: `habitat/client/src/types.ts` (helper `STATE_TOKEN`)

**Interfaces:**
- Consumes: `useSessions` (`list`, `selectedId`, `select`, `reorder`), `postOrder` (`composables/useSessionOrder`), `send` (`composables/useSocket`), `useLayoutMode`, `faceFor` (`sprites`), `STATUS_LABEL`, `useProjects().colorForProject`.
- Produces:
  - `<SessionAvatar :session size?="sm|md" />`: sprite con la luz de estado. Al hacer clic en la luz, si la sesión está `waiting` o `error`, se descarta la alerta.
  - `<SessionNav />`: decide entre `SessionSidebar` (landscape), `SessionTabs` (portrait) y nada (phone; la lista de celular llega en el PR 3, así que en phone se usa `SessionTabs`).
  - `STATE_TOKEN: Record<Status, 'working'|'waiting'|'done'|'idle'|'error'>` en `types.ts` (`offline` → `idle`).

- [ ] **Step 1: Tests que fallan**

`SessionAvatar.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import SessionAvatar from './SessionAvatar.vue'

vi.mock('../../composables/useSocket', () => ({ send: vi.fn() }))
import { send } from '../../composables/useSocket'

const sess = (status: string) => ({ id: 's1', name: 'ezio', project: 'p', branch: 'b', status, action: '', since: 0, stamina: 80 }) as any
afterEach(() => vi.clearAllMocks())

describe('SessionAvatar', () => {
  it('luz con el token del estado', () => {
    setActivePinia(createPinia())
    const w = mount(SessionAvatar, { props: { session: sess('waiting') } })
    expect(w.get('[data-test="state-light"]').classes()).toContain('bg-state-waiting')
    const w2 = mount(SessionAvatar, { props: { session: sess('offline') } })
    expect(w2.get('[data-test="state-light"]').classes()).toContain('bg-state-idle')
  })
  it('tocar la luz descarta "te necesita" y no propaga el click', async () => {
    setActivePinia(createPinia())
    const parent = vi.fn()
    const w = mount({ components: { SessionAvatar }, template: '<div @click="p"><SessionAvatar :session="s" /></div>', setup: () => ({ s: sess('waiting'), p: parent }) })
    await w.get('[data-test="state-light"]').trigger('click')
    expect(send).toHaveBeenCalledWith({ type: 'dismiss', id: 's1' })
    expect(parent).not.toHaveBeenCalled()
  })
  it('en otros estados la luz no descarta', async () => {
    setActivePinia(createPinia())
    const w = mount(SessionAvatar, { props: { session: sess('working') } })
    await w.get('[data-test="state-light"]').trigger('click')
    expect(send).not.toHaveBeenCalled()
  })
})
```

`SessionNav.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('../../composables/useSocket', () => ({ send: vi.fn() }))
vi.mock('../../composables/useSessionOrder', () => ({ postOrder: vi.fn(async () => true) }))

const sess = (id: string, status = 'idle') => ({ id, name: id, project: 'proj', branch: 'main', status, action: 'a', since: 0, stamina: 80 }) as any

async function mountNav(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true })
  vi.resetModules()
  const { useSessions } = await import('../../stores/sessions')
  const SessionNav = (await import('./SessionNav.vue')).default
  setActivePinia(createPinia())
  const store = useSessions()
  store.setAll([sess('ezio', 'working'), sess('yoshi', 'waiting')])
  return { w: mount(SessionNav, { global: { stubs: { teleport: true } } }), store }
}

beforeEach(() => localStorage.clear())

describe('SessionNav', () => {
  it('landscape: barra lateral con nombre y proyecto', async () => {
    const { w } = await mountNav(1440, 900)
    expect(w.find('[data-test="session-sidebar"]').exists()).toBe(true)
    expect(w.text()).toContain('ezio')
    expect(w.text()).toContain('proj')
  })
  it('portrait: pestañas arriba', async () => {
    const { w } = await mountNav(820, 1180)
    expect(w.find('[data-test="session-tabs"]').exists()).toBe(true)
  })
  it('colapsar deja sólo avatares (sin nombres) y se recuerda', async () => {
    const { w } = await mountNav(1440, 900)
    await w.get('[data-test="nav-collapse"]').trigger('click')
    expect(w.find('[data-test="session-sidebar"]').classes()).toContain('collapsed')
    expect(w.findAll('[data-test="session-name"]').length).toBe(0)
    expect(localStorage.getItem('habitat.nav.collapsed.landscape')).toBe('1')
  })
  it('click en una sesión la selecciona', async () => {
    const { w, store } = await mountNav(1440, 900)
    await w.findAll('[data-test="session-item"]')[1].trigger('click')
    expect(store.selectedId).toBe('yoshi')
  })
  it('la seleccionada queda marcada', async () => {
    const { w, store } = await mountNav(1440, 900)
    store.select('ezio'); await w.vm.$nextTick()
    expect(w.findAll('[data-test="session-item"]')[0].attributes('aria-current')).toBe('true')
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd habitat/client && npx vitest run src/components/sessions`
Expected: FAIL (no existen).

- [ ] **Step 3: Implementar**

`types.ts`, debajo de `STATUS_LABEL`:
```ts
// Token de color (--state-*) para cada estado. offline se ve como quieta (atenuada).
export const STATE_TOKEN: Record<Status, 'working' | 'waiting' | 'done' | 'idle' | 'error'> = {
  idle: 'idle', working: 'working', waiting: 'waiting', done: 'done', error: 'error', offline: 'idle',
}
```

`SessionAvatar.vue`:
```vue
<script setup lang="ts">
import { computed } from 'vue'
import { faceFor } from '../../sprites'
import { send } from '../../composables/useSocket'
import { STATE_TOKEN, STATUS_LABEL, type Session } from '../../types'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{ session: Session; size?: 'sm' | 'md' }>(), { size: 'md' })
// Clases literales (no interpoladas) para que Tailwind las detecte.
const LIGHT: Record<string, string> = {
  working: 'bg-state-working', waiting: 'bg-state-waiting', done: 'bg-state-done', idle: 'bg-state-idle', error: 'bg-state-error',
}
const light = computed(() => LIGHT[STATE_TOKEN[props.session.status]])
const dismissable = computed(() => props.session.status === 'waiting' || props.session.status === 'error')
function onLight(e: MouseEvent) {
  if (!dismissable.value) return
  e.stopPropagation() // descartar la alerta no selecciona la sesión
  send({ type: 'dismiss', id: props.session.id })
}
</script>

<template>
  <span :class="cn('relative inline-block shrink-0', size === 'sm' ? 'size-7' : 'size-9')">
    <img :src="faceFor(session.name, session.char)" alt="" class="pixel size-full rounded-[var(--radius)] bg-surface-raised" />
    <span
      data-test="state-light"
      :class="cn('absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-surface', light, dismissable && 'cursor-pointer animate-pulse motion-reduce:animate-none')"
      :title="dismissable ? `${STATUS_LABEL[session.status]} · tocar para descartar` : STATUS_LABEL[session.status]"
      @click="onLight"
    />
  </span>
</template>

<style scoped>
.pixel { image-rendering: pixelated; }
</style>
```

`SessionSidebar.vue` (landscape). El drag reusa la lógica de `SessionRail`:
```vue
<script setup lang="ts">
import { computed } from 'vue'
import draggable from 'vuedraggable'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-vue-next'
import { useSessions } from '../../stores/sessions'
import { postOrder } from '../../composables/useSessionOrder'
import { useLayoutMode } from '../../composables/useLayoutMode'
import { STATUS_LABEL, type Session } from '../../types'
import SessionAvatar from './SessionAvatar.vue'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const store = useSessions()
const { collapsed, toggleCollapsed } = useLayoutMode()
// vuedraggable v-model: aplica el orden local (optimista) y lo persiste; el WS sincroniza otros clientes.
const items = computed<Session[]>({
  get: () => store.list,
  set: (val) => { const ids = val.map((s) => s.id); store.reorder(ids); postOrder(ids) },
})
</script>

<template>
  <aside
    data-test="session-sidebar"
    :class="cn('flex h-full flex-col border-r border-border bg-surface transition-[width] duration-150 motion-reduce:transition-none', collapsed ? 'collapsed w-14' : 'w-56')"
  >
    <TooltipProvider :delay-duration="300">
      <draggable v-model="items" item-key="id" tag="div" class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2"
        :animation="150" :delay="200" :delay-on-touch-only="true">
        <template #item="{ element: s }">
          <Tooltip :disabled="!collapsed">
            <TooltipTrigger as-child>
              <button
                data-test="session-item" type="button"
                :aria-current="store.selectedId === s.id ? 'true' : undefined"
                :class="cn('flex w-full items-center gap-2.5 rounded-[var(--radius)] p-1.5 text-left hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent',
                  store.selectedId === s.id && 'bg-surface-raised shadow-[inset_2px_0_0_var(--accent)]', collapsed && 'justify-center')"
                @click="store.select(s.id)"
              >
                <SessionAvatar :session="s" />
                <span v-if="!collapsed" class="min-w-0 flex-1">
                  <span data-test="session-name" class="block truncate font-semibold text-text">{{ s.name }}</span>
                  <span class="block truncate text-xs text-muted">{{ s.project }}<template v-if="s.branch"> · {{ s.branch }}</template></span>
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{{ s.name }} · {{ STATUS_LABEL[s.status] }}</TooltipContent>
          </Tooltip>
        </template>
      </draggable>
    </TooltipProvider>
    <p v-if="!store.list.length && !collapsed" class="p-3 text-sm text-muted">No hay sesiones. Creá una con “+ Nueva sesión”.</p>
    <button data-test="nav-collapse" type="button"
      class="m-2 flex items-center justify-center gap-2 rounded-[var(--radius)] p-2 text-sm text-muted hover:bg-surface-raised hover:text-text"
      :aria-label="collapsed ? 'Expandir barra de sesiones' : 'Colapsar barra de sesiones'" @click="toggleCollapsed">
      <PanelLeftOpen v-if="collapsed" class="size-4" /><PanelLeftClose v-else class="size-4" />
      <span v-if="!collapsed">Colapsar</span>
    </button>
  </aside>
</template>
```

`SessionTabs.vue` (portrait y phone, hasta el PR 3):
```vue
<script setup lang="ts">
import { computed } from 'vue'
import draggable from 'vuedraggable'
import { ChevronsUp, ChevronsDown } from 'lucide-vue-next'
import { useSessions } from '../../stores/sessions'
import { postOrder } from '../../composables/useSessionOrder'
import { useLayoutMode } from '../../composables/useLayoutMode'
import { STATUS_LABEL, type Session } from '../../types'
import SessionAvatar from './SessionAvatar.vue'
import { cn } from '@/lib/utils'

const store = useSessions()
const { collapsed, toggleCollapsed, mode } = useLayoutMode()
const items = computed<Session[]>({
  get: () => store.list,
  set: (val) => { const ids = val.map((s) => s.id); store.reorder(ids); postOrder(ids) },
})
// La rueda vertical scrollea las pestañas en horizontal.
function onWheel(e: WheelEvent) {
  const el = e.currentTarget as HTMLElement
  if (el.scrollWidth > el.clientWidth && e.deltaY) { el.scrollLeft += e.deltaY; e.preventDefault() }
}
</script>

<template>
  <nav data-test="session-tabs" :class="cn('flex items-end gap-1 border-b border-border bg-surface px-2 pt-1.5', collapsed && 'collapsed')">
    <draggable v-model="items" item-key="id" tag="div" class="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto"
      :animation="150" :delay="200" :delay-on-touch-only="true" @wheel="onWheel">
      <template #item="{ element: s }">
        <button
          data-test="session-item" type="button" :title="`${s.name} · ${STATUS_LABEL[s.status]}`"
          :aria-current="store.selectedId === s.id ? 'true' : undefined"
          :class="cn('flex shrink-0 items-center gap-2 rounded-t-[var(--radius)] px-2.5 py-1.5 text-sm text-muted hover:text-text min-h-10',
            store.selectedId === s.id ? 'bg-surface-raised text-text shadow-[inset_0_2px_0_var(--accent)]' : 'bg-background/40')"
          @click="store.select(s.id)"
        >
          <SessionAvatar :session="s" size="sm" />
          <span v-if="!collapsed" data-test="session-name" class="max-w-32 truncate font-medium">{{ s.name }}</span>
        </button>
      </template>
    </draggable>
    <button v-if="mode !== 'phone'" data-test="nav-collapse" type="button"
      class="mb-1 rounded-[var(--radius)] p-2 text-muted hover:bg-surface-raised hover:text-text"
      :aria-label="collapsed ? 'Expandir pestañas' : 'Colapsar pestañas'" @click="toggleCollapsed">
      <ChevronsDown v-if="collapsed" class="size-4" /><ChevronsUp v-else class="size-4" />
    </button>
  </nav>
</template>
```

`SessionNav.vue`:
```vue
<script setup lang="ts">
import { useLayoutMode } from '../../composables/useLayoutMode'
import SessionSidebar from './SessionSidebar.vue'
import SessionTabs from './SessionTabs.vue'

// landscape: barra a la izquierda; portrait (y phone, hasta que llegue la lista del PR 3): pestañas arriba.
const { mode } = useLayoutMode()
</script>

<template>
  <SessionSidebar v-if="mode === 'landscape'" />
  <SessionTabs v-else />
</template>
```

Migrar el test del punto de infra que existía en `SessionPod.test.ts` (dot solo con `infra.dir`, clase por estado). En este PR, el punto de infra va en `SessionSidebar` y `SessionTabs`: un `<span data-test="infra-dot">` junto al nombre, con la clase literal `bg-state-done` (up), `bg-state-working` (partial) o `bg-state-idle` (off/sin estado), visible solo si `s.infra?.dir`. Agregar ese caso a `SessionNav.test.ts`, con `infra: { dir: '/x', state: 'up' }` en un fixture, y asertar la clase.

- [ ] **Step 4: Correr**

Run: `cd habitat/client && npx vitest run src/components/sessions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add habitat/client/src
git commit -m "feat(habitat): navegación de sesiones adaptativa (barra lateral / pestañas, colapsable)"
```

---

### Task 7: `AppShell`, `TopBar` y reemplazo del layout viejo

**Files:**
- Create: `habitat/client/src/components/shell/AppShell.vue`, `TopBar.vue`, `ManaMeter.vue`, `SessionSummary.vue`, `UserMenu.vue`, `TopBar.test.ts`
- Modify: `habitat/client/src/App.vue`, `habitat/client/src/main.ts`
- Delete: `HabitatLayout.vue`, `AppMenu.vue`, `UsageHud.vue`, `SessionRail.vue`, `SessionPod.vue` (y `SessionPod.test.ts`, ya migrado), `composables/useCompactPods.ts` (y su test). También `useViewport.ts` y `useDayNight.ts` con sus tests, **si** después del cambio no quedan referencias (`grep`).
- Modify: `DetailPanel.vue` (sacar `useCompactPods` y la clase `compact`; el header usa siempre el diseño compacto en landscape)

**Interfaces:**
- Consumes: `useSessions`, `useUsage` (`usage`, `mana`, `resetLabel`), `useAuth().logout`, `useZoom`, `SpawnMenu.vue` (sin cambios en este PR), `SessionNav`, `useLayoutMode`, router.
- Produces: `<AppShell />` (layout de toda la app autenticada).

- [ ] **Step 1: Test que falla**

`TopBar.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'

vi.mock('../SpawnMenu.vue', () => ({ default: { template: '<button data-test="spawn">+</button>' } }))
import TopBar from './TopBar.vue'
import { useSessions } from '../../stores/sessions'
import { setUsage } from '../../composables/useUsage'

const sess = (id: string, status: string) => ({ id, name: id, project: 'p', branch: '', status, action: '', since: 0, stamina: 100 }) as any
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }, { path: '/settings/:section?', component: { template: '<div/>' } }] })

describe('TopBar', () => {
  it('resumen con totales por estado y maná', async () => {
    setActivePinia(createPinia())
    useSessions().setAll([sess('a', 'working'), sess('b', 'working'), sess('c', 'waiting'), sess('d', 'idle')])
    setUsage({ pct: 30, resetAt: Math.floor(Date.now() / 1000) + 3600 })
    const w = mount(TopBar, { global: { plugins: [router] } })
    const sum = w.get('[data-test="session-summary"]').text()
    expect(sum).toContain('4')
    expect(sum).toContain('2 trabajando')
    expect(sum).toContain('1 te necesita')
    expect(w.get('[data-test="mana-fill"]').attributes('style')).toContain('width: 70%')
    expect(w.find('[data-test="spawn"]').exists()).toBe(true)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd habitat/client && npx vitest run src/components/shell`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`SessionSummary.vue`:
```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useSessions } from '../../stores/sessions'

const store = useSessions()
const working = computed(() => store.list.filter((s) => s.status === 'working').length)
const need = computed(() => store.list.filter((s) => s.status === 'waiting' || s.status === 'error').length)
</script>

<template>
  <span data-test="session-summary" class="flex items-center gap-2 text-sm text-muted tabular-nums">
    <b class="text-text">{{ store.list.length }}</b>
    <span v-if="working" class="hidden items-center gap-1 sm:flex"><i class="size-2 rounded-full bg-state-working" />{{ working }} trabajando</span>
    <span v-if="need" class="flex items-center gap-1 font-semibold text-state-waiting"><i class="size-2 rounded-full bg-state-waiting" />{{ need }} te necesita</span>
  </span>
</template>
```

`ManaMeter.vue`:
```vue
<script setup lang="ts">
import { useUsage } from '../../composables/useUsage'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const { usage, mana, resetLabel } = useUsage()
</script>

<template>
  <TooltipProvider v-if="usage">
    <Tooltip>
      <TooltipTrigger as-child>
        <span class="flex items-center gap-2 text-xs text-muted" aria-label="Maná: uso de Claude restante">
          <span class="hidden sm:inline">Maná</span>
          <span class="h-1.5 w-20 overflow-hidden rounded-full bg-surface-raised">
            <i data-test="mana-fill" class="block h-full bg-mana" :style="{ width: (mana ?? 0) + '%' }" />
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>Maná {{ mana ?? 0 }}% · próximo ciclo en {{ resetLabel }}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
```

`UserMenu.vue`:
```vue
<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Settings, LogOut, Minus, Plus, CircleUser } from 'lucide-vue-next'
import { useAuth } from '../../composables/useAuth'
import { useZoom } from '../../composables/useZoom'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const router = useRouter()
const { logout } = useAuth()
// El zoom vive acá hasta que Apariencia exista (PR 4).
const { zoomPct, zoomIn, zoomOut, resetZoom, canZoomIn, canZoomOut } = useZoom()
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger class="rounded-[var(--radius)] p-2 text-muted hover:bg-surface-raised hover:text-text" aria-label="Menú">
      <CircleUser class="size-5" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-52">
      <DropdownMenuItem @select="router.push('/settings/general')"><Settings class="size-4" /> Ajustes</DropdownMenuItem>
      <div class="flex items-center justify-between px-2 py-1.5 text-sm">
        <span class="text-muted">Zoom</span>
        <span class="flex items-center gap-1">
          <button class="rounded p-1 hover:bg-surface-raised disabled:opacity-40" :disabled="!canZoomOut" aria-label="Alejar" @click="zoomOut"><Minus class="size-3.5" /></button>
          <button class="w-12 text-center tabular-nums" title="Volver a 100%" @click="resetZoom">{{ zoomPct }}%</button>
          <button class="rounded p-1 hover:bg-surface-raised disabled:opacity-40" :disabled="!canZoomIn" aria-label="Acercar" @click="zoomIn"><Plus class="size-3.5" /></button>
        </span>
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem @select="logout()"><LogOut class="size-4" /> Salir</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
```

`TopBar.vue`:
```vue
<script setup lang="ts">
import SessionSummary from './SessionSummary.vue'
import ManaMeter from './ManaMeter.vue'
import UserMenu from './UserMenu.vue'
import SpawnMenu from '../SpawnMenu.vue'
</script>

<template>
  <header class="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3 pt-[env(safe-area-inset-top,0px)] sm:gap-4 sm:px-4">
    <RouterLink to="/" class="font-display text-lg font-bold text-accent">Hábitat</RouterLink>
    <SessionSummary />
    <span class="flex-1" />
    <ManaMeter />
    <SpawnMenu />
    <UserMenu />
  </header>
</template>
```
`SpawnMenu` mantiene su estilo legacy hasta el PR 3. Si su botón rompe la altura de una fila, envolverlo en un `<span class="flex items-center">` sin tocar `SpawnMenu`.

`AppShell.vue`:
```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useLayoutMode } from '../../composables/useLayoutMode'
import TopBar from './TopBar.vue'
import SessionNav from '../sessions/SessionNav.vue'

const { mode } = useLayoutMode()
const landscape = computed(() => mode.value === 'landscape')
</script>

<template>
  <div class="flex h-dvh flex-col bg-background text-text font-ui">
    <TopBar />
    <div :class="landscape ? 'flex min-h-0 flex-1' : 'flex min-h-0 flex-1 flex-col'">
      <SessionNav />
      <main class="min-h-0 min-w-0 flex-1"><RouterView /></main>
    </div>
  </div>
</template>
```

`App.vue` (reemplazo completo):
```vue
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
```

`main.ts`:
```ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './style.css'
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
```

`DetailPanel.vue`:
- sacar el import y el uso de `useCompactPods`;
- reemplazar `:class="{ compact }"` en `.dhead` por `class="dhead compact"`, para que la cabecera fina quede siempre en landscape (sus media queries ya la limitan a horizontal);
- si `DetailPanel` usa `useViewport`, conservarlo.

`style.css`: eliminar las reglas de layout que solo usaban los componentes borrados (`.hlayout`, `.hrail`, `.hdiv`, `.scrim`, `.hpanelhost`, `.rail`, `.pod*`, `.topbar*`, `.sky-ambient`, `.forge-veil`). Antes, verificar con grep que no las use ningún componente que siga vivo.

Eliminar los archivos listados en **Files → Delete** y correr `grep -rn "HabitatLayout\|AppMenu\|UsageHud\|SessionRail\|SessionPod\|useCompactPods\|useViewport\|useDayNight" src` hasta que no quede ninguna referencia (salvo `useViewport` si `DetailPanel` lo sigue usando).

- [ ] **Step 4: Correr**

Run: `cd habitat/client && npx vitest run && npm run build 2>&1 | tail -2`
Expected: todo en verde y build OK.

- [ ] **Step 5: Commit**

```bash
git add -A habitat/client/src
git commit -m "feat(habitat): AppShell con barra superior y navegación nueva; fuera el layout viejo"
```

---

### Task 8: Script de capturas, verificación visual y PR 1

**Files:**
- Create: `habitat/scripts/screenshots.mjs`
- Modify: `habitat/README.md` (sección de desarrollo: cómo correr las capturas y cómo cambiar de tema)

**Interfaces:**
- Produces: `node habitat/scripts/screenshots.mjs --url <base con ?token=> --out <dir>`, que genera `{theme}-{w}x{h}-{view}.png` para los temas `forja`, `pizarra` y `taberna`, los tamaños `1440x900`, `820x1180` y `400x860`, y las vistas `focus` (`#/`) y `settings` (`#/settings/general`).

- [ ] **Step 1: Script**

`habitat/scripts/screenshots.mjs`. Usa chrome-headless-shell por CDP con el `ws` del server, según la memoria `habitat-headless-screenshots`:
```js
#!/usr/bin/env node
// Capturas de la GUI en 3 temas x 3 tamaños x vistas, por CDP crudo (sin playwright).
// Requiere chrome-headless-shell (npx playwright install chromium) y, en este server,
// LD_LIBRARY_PATH apuntando a las libs bundleadas de JetBrains SÓLO para el proceso de chrome.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import wsPkg from '../node_modules/ws/index.js';
const { WebSocket } = wsPkg;

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const BASE = args.url; const OUT = args.out || 'shots';
if (!BASE) { console.error('uso: screenshots.mjs --url "http://127.0.0.1:8399/?token=XXX" [--out dir]'); process.exit(1); }
const THEMES = ['forja', 'pizarra', 'taberna'];
const SIZES = [[1440, 900], [820, 1180], [400, 860]];
const VIEWS = { focus: '#/', settings: '#/settings/general' };

const msRoot = join(homedir(), '.cache/ms-playwright');
const shellDir = existsSync(msRoot) && readdirSync(msRoot).find((d) => d.startsWith('chromium_headless_shell'));
if (!shellDir) { console.error('falta chrome-headless-shell: npx playwright install chromium'); process.exit(1); }
const bin = join(msRoot, shellDir, 'chrome-headless-shell-linux64/chrome-headless-shell');
const jb = join(homedir(), '.cache/JetBrains/RemoteDev/dist');
const libDir = existsSync(jb) ? readdirSync(jb).map((d) => join(jb, d, 'plugins/remote-dev-server/selfcontained/lib')).find(existsSync) : null;
const chrome = spawn(bin, ['--no-sandbox', '--remote-debugging-port=9411', '--hide-scrollbars'], {
  env: { ...process.env, ...(libDir ? { LD_LIBRARY_PATH: libDir } : {}) }, stdio: 'ignore',
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1500);
mkdirSync(OUT, { recursive: true });
try {
  for (const theme of THEMES) for (const [w, h] of SIZES) for (const [view, hash] of Object.entries(VIEWS)) {
    const tab = await (await fetch('http://127.0.0.1:9411/json/new?about:blank', { method: 'PUT' })).json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => ws.once('open', r));
    let id = 0; const pend = new Map();
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: Math.min(w, h) < 600 });
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('habitat.theme','${theme}')}catch(e){}` });
    await send('Page.navigate', { url: BASE + hash }); await sleep(2500);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `${theme}-${w}x${h}-${view}.png`), Buffer.from(s.result.data, 'base64'));
    ws.close(); await fetch(`http://127.0.0.1:9411/json/close/${tab.id}`);
  }
} finally { chrome.kill(); }
console.log(`capturas en ${OUT}`);
```

- [ ] **Step 2: Instancia de dev con sesiones de prueba y capturas**

```bash
cd habitat/client && npm run build && cd ..
HABITAT_PORT=8399 HABITAT_TOKEN=shots HABITAT_STATE=/tmp/habitat-shots-state.json HABITAT_SESSIONS=/tmp/habitat-shots-sessions.json \
  HABITAT_PROJECTS_STATE=/tmp/habitat-shots-projects.json HABITAT_SETTINGS=/tmp/habitat-shots-settings.json node server/index.js &
sleep 1
for s in ezio:working yoshi:waiting link:done zelda:idle; do n=${s%%:*}; st=${s##*:}
  curl -s -X POST -H 'authorization: Bearer shots' -H 'content-type: application/json' http://127.0.0.1:8399/hooks \
    -d "{\"session_id\":\"$n\",\"hook_event_name\":\"SessionStart\",\"cwd\":\"/home/u/proj-$n\"}"
  case $st in working) ev='{"hook_event_name":"PostToolUse","tool_name":"Edit"}';; waiting) ev='{"hook_event_name":"Notification","message":"¿Aplico la migración?"}';; *) ev='{"hook_event_name":"Stop"}';; esac
  curl -s -X POST -H 'authorization: Bearer shots' -H 'content-type: application/json' http://127.0.0.1:8399/hooks -d "${ev%\}},\"session_id\":\"$n\"}"
done
node scripts/screenshots.mjs --url "http://127.0.0.1:8399/?token=shots" --out /tmp/habitat-shots
```
Revisar las 18 capturas, por ejemplo con la herramienta Read sobre los PNG. Criterios:
- la barra superior queda en una sola fila en los tres tamaños;
- en landscape la barra de sesiones está a la izquierda y en portrait/phone las pestañas arriba;
- las luces de estado se distinguen;
- los textos se leen en los tres temas;
- no quedan restos visuales del layout viejo (gradientes, header roto).

Corregir lo que falle en las tareas correspondientes. Después matar la instancia y borrar `/tmp/habitat-shots*`.

- [ ] **Step 3: README**

En `habitat/README.md`, sección de desarrollo:

```markdown
### Temas y capturas

La UI tiene temas intercambiables (Forja refinada, Pizarra pixel, Noche de taberna) definidos por
tokens en `client/src/theme/` (`themes.ts` + `tokens.css`; el test de contraste verifica AA y que
ambos coincidan). El tema se guarda por dispositivo (`localStorage: habitat.theme`).

Para revisar la UI en los 3 temas y 3 tamaños: levantá una instancia de dev y corré
`node scripts/screenshots.mjs --url "http://127.0.0.1:8399/?token=<token>" --out /tmp/shots`.
```

- [ ] **Step 4: Verificación final, commit y PR**

```bash
git fetch origin && git merge origin/main
cd habitat && npm test 2>&1 | grep -E "^# (pass|fail)"
cd client && npx vitest run 2>&1 | grep -E "Tests " && npm run build 2>&1 | tail -1
cd ../.. && git add habitat/scripts habitat/README.md && git commit -m "chore(habitat): script de capturas por tema y tamaño"
git push -u origin feat/habitat-redesign
gh pr create --base main --head feat/habitat-redesign --title "feat(habitat): rediseño 1/4 — base, temas y navegación" --body "<resumen, capturas clave, testing; terminar con la línea de atribución de Claude Code>"
```
