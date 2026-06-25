# Hábitat — Favicon y alertas de tab para sesiones "te necesita"

Fecha: 2026-06-25
Branch: `feat/habitat-tab-alerts`

## Objetivo

Que la pestaña del navegador del Hábitat:

1. Tenga un favicon de marca (el rostro del Monkey, "El Mono").
2. Avise visualmente en la tab cuando alguna sesión está en estado
   `waiting` (etiqueta "te necesita") — vía **título** y **favicon con badge**.
3. Cuando una sesión **recién** entra a `waiting` y la tab está en segundo
   plano: dispare una **notificación del navegador** y un **sonido** corto.

## Contexto del código

- App Vue 3 + Vite en `habitat/client`. Punto de entrada `src/main.ts`,
  raíz `src/App.vue`.
- El store Pinia `src/stores/sessions.ts` ya expone:
  - `list`: `Session[]`
  - `needCount`: cantidad de sesiones con `status === 'waiting'`.
- Estados en `src/types.ts`: `Status = 'idle' | 'working' | 'waiting' | ...`.
  `STATUS_LABEL.waiting === 'te necesita'`.
- Favicon del Monkey: `public/assets/char/Monkey/face.png` (38×38, RGBA).
  Hoy **no hay** `<link rel="icon">` en `index.html`.
- Composables de nivel app siguen el patrón de `useViewport` / `useSettings`
  (función que se llama una vez y registra/limpia listeners).

## Diseño

### 1. Favicon base (HTML)

Agregar al `<head>` un `<link rel="icon">` apuntando al rostro del Monkey en:

- `habitat/client/index.html` (fuente de dev/build).
- `habitat/web/index.html` (HTML servido por la build, si aplica al deploy).

```html
<link rel="icon" type="image/png" href="/assets/char/Monkey/face.png" />
```

Este link es el favicon "por defecto". La composable lo sobreescribe en
runtime (ver §2/§3); el link estático garantiza un favicon correcto antes de
que monte Vue.

### 2. Favicon de alerta — compositado en runtime (canvas)

Decisión aprobada: **no** se crea un segundo PNG. Una sola composable:

- Carga `face.png` en un `Image`.
- Dibuja el favicon en un `<canvas>` (p. ej. 64×64) escalando el sprite con
  `imageSmoothingEnabled = false` (mantiene el look pixel-art).
- Cuando hay alerta, pinta encima un **badge**: círculo rojo en la esquina
  inferior derecha. Si `needCount > 1`, dibuja el número dentro del badge
  (texto blanco, fuente pequeña). Si es 1, solo el punto.
- Setea el favicon vía `link.href = canvas.toDataURL('image/png')`.

Helper interno que ubica (o crea) el `<link rel="icon">` en `<head>` y le
asigna el data URL.

### 3. Composable `useTabAlert` (nueva)

Archivo: `habitat/client/src/composables/useTabAlert.ts`.

Responsabilidad única: reflejar el estado de "sesiones que te necesitan" en la
**tab** (título + favicon) y disparar **notificación + sonido** en transición.

Interfaz: `useTabAlert(): void` — se llama una vez desde `App.vue`.

Comportamiento:

- **Título** (siempre, sin importar foco):
  - Base: `Hábitat · El Mono`.
  - `needCount > 0` → `(${needCount}) Hábitat · El Mono`.
- **Favicon** (siempre): redibuja con/sin badge según `needCount`
  (ver §2). Espera a que la imagen del Monkey cargue; si aún no cargó,
  reintenta al `onload`.
- **Notificación + sonido** (solo en transición a `waiting`, ver §4):
  se disparan **únicamente** si `document.hidden === true`.

Implementación reactiva: `watch` sobre `store.needCount` para título/favicon;
`watch` sobre el conjunto de ids en `waiting` para detectar transiciones
(§4). Limpieza de cualquier listener en `onUnmounted` (aunque al ser nivel app
vive toda la sesión).

### 4. Detección de transición a `waiting`

Para no repetir notificación/sonido mientras la sesión sigue esperando:

- Mantener un `Set<string>` con los ids que estaban en `waiting` en el último
  tick (`prevWaiting`).
- En cada cambio de `store.list`, calcular `currentWaiting`.
- **Nuevos** = ids en `currentWaiting` que no estaban en `prevWaiting`.
- Por cada nuevo id (si `document.hidden`): notificación + sonido.
- Actualizar `prevWaiting = currentWaiting`.
- Inicializar `prevWaiting` con el estado del primer snapshot **sin** disparar
  (evita avisar de golpe al abrir la app con sesiones ya en `waiting`).

### 5. Notificación del navegador

- Pedir permiso una vez (al montar): `Notification.requestPermission()` si el
  estado es `'default'`. Si el navegador no soporta `Notification` o el
  permiso es `'denied'`, se omite silenciosamente (sin errores).
- Al disparar: `new Notification('El Mono · Hábitat', { body: 'La sesión
  «<name>» te necesita', icon: '/assets/char/Monkey/face.png' })`.
- Si hay varias nuevas a la vez, un único aviso resumido
  (`«X» y N más te necesitan`) para no inundar.

### 6. Sonido (jingle .wav del asset pack)

- Función `playChime()` que reproduce un jingle corto vía un único elemento
  `HTMLAudioElement` reusado (`new Audio('/assets/sfx/alert.wav')`,
  `volume = 0.5`, `currentTime = 0` antes de cada play).
- Asset: `Secret2.wav` del pack Ninja Adventure (CC0), copiado a
  `public/assets/sfx/alert.wav`.
- `play()` devuelve una promesa; si el navegador la bloquea (autoplay sin
  gesto previo del usuario) se rechaza y se ignora — degrada en silencio.

> Nota: la primera versión usó un chime sintético WebAudio (sin asset); se
> cambió por el jingle real del pack a pedido, antes del merge.

### 7. Wiring

En `src/App.vue`, junto a `onMounted(startSocket)`:

```ts
import { useTabAlert } from './composables/useTabAlert'
// ...
useTabAlert()
```

## Unidades y límites

| Unidad | Qué hace | Depende de |
| --- | --- | --- |
| `index.html` (link icon) | favicon por defecto pre-Vue | asset estático |
| `useTabAlert` | orquesta título, favicon, notif y sonido | store `sessions`, helpers de favicon/sonido |
| helper favicon (canvas) | dibuja base + badge → data URL | `face.png`, DOM `<link>` |
| `playChime` | sonido WebAudio | `AudioContext` |

Cada pieza es testeable por separado: la lógica de "nuevos ids en waiting" es
una función pura sobre dos sets; el dibujo del favicon y el sonido son efectos
de borde aislados.

## Testing

- **Unit (Vitest, ya configurado):** función pura que calcula los ids
  "nuevos" entre `prevWaiting` y `currentWaiting` (incluye caso inicial que no
  dispara).
- **Manual:** abrir el Hábitat, llevar una sesión a `waiting` con la tab en
  background → ver `(1)` en el título, badge en el favicon, notificación y
  chime. Volver a `idle`/`done` → título y favicon limpios.

## Fuera de alcance (YAGNI)

- Preferencia configurable para silenciar sonido/notificaciones (se puede
  agregar luego en `SettingsView` si molesta).
- Distintos sonidos por tipo de estado (`error`, etc.).
- Badge animado / parpadeo del título.
```