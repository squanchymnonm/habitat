# Dismiss en pod compacto vía chip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir apagar el estado "te necesita" (`waiting`) y `error` desde el modo compacto de los pods, haciendo clickeable el chip de estado.

**Architecture:** El affordance de dismiss hoy vive solo en `MiniArena.vue` (emote), que no se renderiza en el branch compacto de `SessionPod.vue`. Se agrega a `SessionPod.vue` un `dismissable`/`dismiss` (reusando `send` del socket, igual que `MiniArena`) y se hace clickeable el chip del branch compacto con `@click.stop`. El server ya maneja `{ type: 'dismiss', id }` (transiciona `waiting`/`error` → `idle`).

**Tech Stack:** Vue 3 (`<script setup lang="ts">`), Vite, vitest (solo lógica node, sin tests de componentes).

## Global Constraints

- Spec de referencia: `docs/superpowers/specs/2026-06-27-dismiss-en-pod-compacto-design.md`.
- El cambio es **exclusivo del branch compacto** de `SessionPod.vue`. El branch no-compacto (`<template v-else>`) y `MiniArena.vue` NO se tocan.
- `dismissable` = `status === 'waiting' || status === 'error'` (mismo criterio que `MiniArena.vue` y el `DISMISSABLE` del server en `habitat/server/hooks-logic.js`).
- Sin sprites ni animaciones nuevas (mantener la sobriedad del modo compacto).
- No hay infra de tests de componentes Vue (`@vue/test-utils`/DOM env ausentes); la verificación de UI es manual.

---

### Task 1: Chip de estado clickeable para dismiss en pod compacto

**Files:**
- Modify: `habitat/client/src/components/SessionPod.vue` (script + template branch compacto)
- Modify: `habitat/client/src/style.css:89` (agregar regla `.chip.dismissable`)

**Interfaces:**
- Consumes: `send` de `habitat/client/src/composables/useSocket` — firma `send(msg: ClientMessage): void`, con `ClientMessage` incluyendo `{ type: 'dismiss'; id: string }` (ver `types.ts:73-75`).
- Produces: nada que otras tareas consuman (cambio terminal de UI).

- [ ] **Step 1: Importar `send` en SessionPod.vue**

En el `<script setup>` de `habitat/client/src/components/SessionPod.vue`, agregar el import junto a los existentes:

```ts
import { send } from '../composables/useSocket'
```

- [ ] **Step 2: Agregar `dismissable` y `dismiss`**

En el mismo `<script setup>`, después de la función `select()`, agregar:

```ts
const dismissable = computed(
  () => props.session.status === 'waiting' || props.session.status === 'error',
)
function dismiss() {
  if (dismissable.value) send({ type: 'dismiss', id: props.session.id })
}
```

(`computed` ya está importado de `vue` en la línea 2.)

- [ ] **Step 3: Hacer clickeable el chip del branch compacto**

En `<template v-if="compact">`, reemplazar el chip actual:

```html
<span class="chip" :class="session.status">{{ STATUS_LABEL[session.status] }}</span>
```

por:

```html
<span
  class="chip"
  :class="[session.status, { dismissable }]"
  :title="dismissable ? 'marcar como quieta' : ''"
  @click.stop="dismiss"
>{{ STATUS_LABEL[session.status] }}</span>
```

NO modificar el chip del `<template v-else>` (branch no-compacto).

- [ ] **Step 4: Agregar el CSS del cursor**

En `habitat/client/src/style.css`, después de la línea 95 (bloque de reglas `.chip.*`), agregar:

```css
  .chip.dismissable{cursor:pointer}
```

- [ ] **Step 5: Typecheck + build + tests existentes**

Run:
```bash
cd habitat/client && npm run build && npm run test
```
Expected: build sin errores de TypeScript; `vitest run` PASS (los tests existentes de lógica siguen verdes, no se agregaron tests de componentes).

- [ ] **Step 6: Verificación manual en modo compacto**

Levantar el cliente, activar modo compacto y comprobar:
- Sesión en `waiting`: el chip "te necesita" muestra cursor pointer; al hacer clic la sesión pasa a `quieta` (idle) y **no** se abre/selecciona el pod.
- Sesión en `error`: mismo comportamiento (dismiss → idle).
- Sesión en `idle`/`working`/`done`: el chip no es dismiss; clic en el pod selecciona normal.
- Modo no-compacto: sin cambios (el emote sigue descartando la alerta).

- [ ] **Step 7: Commit**

```bash
git add habitat/client/src/components/SessionPod.vue habitat/client/src/style.css
git commit -m "fix(habitat): permitir dismiss del estado 'te necesita' en pod compacto"
```
