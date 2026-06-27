# Dismiss en pod compacto vía chip de estado

Fecha: 2026-06-27

## Problema

En el modo compacto de los pods (feature `pods-modo-compacto-tablet`) no se puede
apagar el estado "te necesita".

"te necesita" es el label del status `waiting` (`types.ts` → `STATUS_LABEL.waiting`).
La única forma de descartarlo desde el cliente es hacer clic en el globo (emote)
que rebota sobre el héroe, y ese affordance vive en `MiniArena.vue`
(`@click.stop="dismiss"` sobre `.pemote.dismissable`), que **solo se renderiza en
el branch no-compacto** de `SessionPod.vue` (`<template v-else>`).

En el branch compacto (`<template v-if="compact">`) se muestra `face-mini` + meta
+ stamina, sin ningún elemento que despache `{ type: 'dismiss', id }`. Por eso el
estado "te necesita" no se puede apagar en modo compacto.

## Solución

Hacer clickeable el **chip de estado** del pod compacto cuando la sesión pide
atención. El chip ya muestra "te necesita" / "error"; reutilizarlo como affordance
evita sumar elementos nuevos y mantiene la densidad/sobriedad del modo compacto.

El cambio es **exclusivo del branch compacto**. En modo no-compacto el chip queda
igual que hoy (no clickeable); el emote de `MiniArena` sigue siendo el affordance.

### Comportamiento

- El chip es interactivo solo cuando `session.status` es `waiting` o `error`
  (mismo criterio `dismissable` que `MiniArena.vue`).
- Cuando es dismissable: `cursor: pointer`, `title="marcar como quieta"`, y al
  hacer clic despacha `{ type: 'dismiss', id: session.id }` por el socket.
- `@click.stop` en el chip: el clic descarta la alerta y **no** selecciona/abre el
  pod (el `@click="select"` del contenedor no debe dispararse).
- Cuando no es dismissable (idle/working/done/offline) el chip no tiene cursor
  pointer, no tiene title y el clic no hace nada especial (se propaga normal, es
  decir selecciona el pod como cualquier otra zona).

## Implementación

Toda en `habitat/client/src/components/SessionPod.vue`.

### Script

- Importar `send` desde `../composables/useSocket` (igual que `MiniArena.vue`).
- Agregar:
  ```ts
  const dismissable = computed(
    () => props.session.status === 'waiting' || props.session.status === 'error',
  )
  function dismiss() {
    if (dismissable.value) send({ type: 'dismiss', id: props.session.id })
  }
  ```

### Template (branch compacto)

Sobre el `<span class="chip">` del `<template v-if="compact">`:

- `:class="[session.status, { dismissable }]"` (mantiene la clase de estado actual
  y suma `dismissable`).
- `@click.stop="dismiss"`.
- `:title="dismissable ? 'marcar como quieta' : ''"`.

El chip del branch no-compacto (`<template v-else>`) **no se toca**.

### CSS

```css
.chip.dismissable { cursor: pointer; }
```

Se reutiliza el estilo de alerta existente del chip `waiting`/`error` (definido en
`style.css` / estilos del pod); no se agregan sprites ni animaciones nuevas.

## Testing

El proyecto no tiene infraestructura de tests de componentes Vue (no hay
`@vue/test-utils` ni entorno DOM como `happy-dom`/`jsdom`; los tests de
`vitest` corren lógica pura en node). La lógica nueva (`dismissable`) es un
predicado trivial sobre `status` que no amerita extracción a un módulo aparte.

Verificación:

1. `npm run test` y typecheck/build del cliente siguen pasando (no se rompe nada
   existente).
2. **Manual** en modo compacto:
   - Sesión en `waiting`: el chip "te necesita" muestra cursor pointer y al
     hacer clic la sesión vuelve a `quieta` (status `idle`), sin abrir/seleccionar
     el pod.
   - Sesión en `error`: mismo comportamiento ("error" → dismiss).
   - Sesión en `idle`/`working`/`done`: el chip no es clickeable como dismiss;
     clic en el pod selecciona normal.
   - Modo no-compacto: sin cambios; el emote sigue descartando la alerta.

## Fuera de alcance

- Cambiar el affordance de dismiss en modo no-compacto.
- Tocar la lógica del servidor / transición de estados (el server ya maneja
  `{ type: 'dismiss', id }`).
- Agregar infraestructura de tests de componentes Vue.
