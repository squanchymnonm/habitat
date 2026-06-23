# Animar al héroe según el estado de la sesión — Design

**Fecha:** 2026-06-23
**Componente:** `habitat/client`
**Estado:** aprobado (re-basado sobre `main` el 2026-06-23)

## Objetivo

Cada personaje del Hábitat tiene sprites deplegados (`idle`, `walk`, `jump`, `item`, `dead`,
`anim_idle`) pero el héroe en pantalla se dibuja siempre como `idle.png` estático. Este trabajo
cablea las animaciones a los estados de la sesión, "cuando corresponde", para que el panel
comunique de un vistazo qué hace cada agente.

Alcance acotado a usar sprites **que ya están en disco**. No se importan ni generan sprites
nuevos.

## Contexto (estado de `main`)

Este diseño se brainstormeó originalmente sobre una rama vieja (`SessionPod.vue` dibujaba al
héroe). `main` reestructuró la UI: hoy el héroe lo renderiza **`MiniArena.vue`** (montado por
`SessionPod.vue` con `:height="56"`). Hechos actuales:

- **`habitat/client/src/components/MiniArena.vue`** — dibuja al héroe con
  `mode="static" :frame="monster ? 3 : 0"` vía `heroIdle(...)`, con `:class="{ flinch }"`. Ya
  tiene: `flinch` (ref, 700 ms en `error`), `floats` (watch sobre `combat.tokens` para números
  de daño), `emote` por estado, `monster` computed.
- **`habitat/client/src/components/Sprite.vue`** — motor de sprite con 3 modos:
  - `static`: tira horizontal de direcciones; muestra un `frame` fijo (no anima).
  - `grid`: hoja 4×4; `dir` = columna (dirección), filas animadas en loop.
  - `strip`: tira horizontal animada; `frames = round(ancho/alto)`, anima en loop con `duration`.
- **`habitat/client/src/sprites.ts`** — tiene `heroIdle` (→ `idle.png`), `faceFor`, y un
  **scaffolding muerto** `STATUS_ANIM` + `heroAnim(name,char,status)` (mapea todo a `anim_idle`)
  que **no se importa ni usa en ningún lado**. Es el placeholder que este feature reemplaza.
- **vitest** está instalado (`npm test` → `vitest run`); hay tests en `src/stores/*.test.ts`.

### Geometría de los sprites (consistente en los 16 personajes)

| Sprite | Tamaño | Interpretación | Modo |
|---|---|---|---|
| `anim_idle` | 128×32 | 4 frames de 32×32, **idle animado (respiración)** | `strip` |
| `idle` | 64×16 | 4 frames = 4 direcciones, estático | `static` |
| `walk` | 64×64 | grid 4×4 (4 dir × 4 frames), **animado** | `grid` |
| `jump` | 64×16 | 4 direcciones, pose estática | `static` |
| `item` | 16×16 | 1 frame, pose de "usar objeto" | `static` |
| `dead` | 16×16 | 1 frame, pose de caído | `static` |

`Sprite.vue` ya soporta los tres modos — no hace falta motor nuevo.

## Decisiones (brainstorming)

- **Enfoque declarativo.** La selección vive en funciones puras en `sprites.ts`;
  `MiniArena.vue` calcula la pose y la bindea al `<Sprite>`.
- **Reposo animado.** `idle`/`waiting` usan `anim_idle.png` (modo `strip`, respiración). En
  combate el héroe usa `idle.png` estático frame 3 (mirando al monstruo, pose `combat`).
- **Combate = "jab" con `item`.** Con monstruo presente el héroe descansa en `combat` (idle
  dir derecha) y pulsa a la pose `item` en cada golpe (cuando sube `combat.tokens`).
- **Remover el scaffolding muerto.** Se borran `heroAnim` + `STATUS_ANIM` de `sprites.ts`; el
  sistema de poses pasa a ser el único camino.
- **Tests de las funciones puras** con vitest (existe runner): `heroPoseFor` y `heroSprite`.
- **Efectos existentes intactos:** emote por estado, flinch en `error`, números de daño,
  overlay de loot (donde aplique). Las animaciones son una capa adicional.

## Mapeo estado → pose ("cuando corresponde")

| Situación | Pose | Sprite / modo | Nota |
|---|---|---|---|
| `idle` (quieta) | `rest` | `anim_idle` / strip | respiración |
| `working` (trabajando) | `walk` | `walk` / grid | camina en el lugar = ocupada |
| `waiting` (te necesita) | `rest` | `anim_idle` / strip | + emote de alerta (ya existe) |
| `done` (lista) | `jump` | `jump` / static frame 0 | celebración |
| `error` | `rest` | `anim_idle` / strip | + flinch CSS (ya existe) |
| `offline` (caída) | `dead` | `dead` / static frame 0 | caído |
| **monstruo presente** | `combat` | `idle` / static frame 3 | mira al monstruo; prioridad sobre el estado |
| ↳ en cada golpe | `item` | `item` / static frame 0 | pulso de "jab" |
| victoria (`lastFight`) | `jump` | `jump` / static frame 0 | saltito breve durante el overlay |

### Precedencia (función pura, testeable)

`heroPoseFor({ status, inCombat, jabbing, celebrating }) → Pose`, en orden:

1. `celebrating` → `jump`
2. `status === 'offline'` → `dead`
3. `inCombat` → `jabbing ? 'item' : 'combat'`
4. `status === 'working'` → `walk`
5. `status === 'done'` → `jump`
6. resto (`idle` / `waiting` / `error`) → `rest`

## Diseño de componentes

### `sprites.ts` (puro)

- `type Pose = 'rest' | 'walk' | 'jump' | 'item' | 'dead' | 'combat'`
- `interface PoseRender { file: string; mode: 'static' | 'grid' | 'strip'; frame?: number; duration?: number }`
- `const POSE_RENDER: Record<Pose, PoseRender>`:
  - `rest`: `{ file: 'anim_idle', mode: 'strip', duration: 1600 }`
  - `walk`: `{ file: 'walk', mode: 'grid', duration: 600 }`
  - `jump`: `{ file: 'jump', mode: 'static', frame: 0 }`
  - `item`: `{ file: 'item', mode: 'static', frame: 0 }`
  - `dead`: `{ file: 'dead', mode: 'static', frame: 0 }`
  - `combat`: `{ file: 'idle', mode: 'static', frame: 3 }`
- `heroSprite(name, char, pose)` → `assets/char/{resolved}/{POSE_RENDER[pose].file}.png`.
- `heroPoseFor({ status, inCombat, jabbing, celebrating })` → `Pose` (la lista de precedencia).
- **Borrar** `STATUS_ANIM` y `heroAnim`. `heroIdle` y `faceFor` se mantienen.

### `MiniArena.vue`

- Refs transitorios: `jabbing` (true en el watch de `combat.tokens` que ya existe, `setTimeout`
  180 ms) y `celebrating` (`MiniArena` importa `useSessions` y agrega un watch sobre
  `store.lastFight`; cuando `lastFight.id === session.id`, `true` por 1200 ms). El overlay de
  loot completo sigue viviendo en `DetailPanel.vue`; acá sólo se usa `lastFight` para el saltito.
- `computed` `pose = heroPoseFor({ status, inCombat: !!monster, jabbing, celebrating })`,
  `render = POSE_RENDER[pose]`, `heroSrc = heroSprite(name, char, pose)`.
- Reemplazar el `<Sprite>` del héroe para bindear `:src="heroSrc"`, `:mode="render.mode"`,
  `:frame="render.frame ?? 0"`, `:duration="render.duration ?? 900"`, conservando
  `:class="{ flinch }"`.

### `Sprite.vue`

Sin cambios. Validar que `strip` con `anim_idle` (128×32, height 56) y `grid` con `walk` se vean
bien; ajustar `duration` por pose si hace falta.

## Manejo de errores / casos borde

- **`offline` con monstruo**: `dead` gana sobre `combat` (precedencia 2 > 3): un agente caído no
  pelea.
- **Victoria**: quita el monstruo (`inCombat` → false) y `celebrating` tiene máxima precedencia,
  así que el saltito no compite con el jab.
- **Transiciones de modo** (strip↔grid↔static): `Sprite.vue` ya hace `anim.cancel()` y reaplica
  al cambiar `src`/`mode`/`frame`/`dir`; no quedan animaciones colgadas.
- **Sprite faltante**: las animaciones se deplegan juntas; si faltara, el `<img>` no carga
  (degradación silenciosa).

## Testing y verificación

- **vitest** (`npm test` desde `habitat/client/`): unit tests puros de `heroPoseFor`
  (toda la tabla de precedencia, incluyendo `offline`+combate y `celebrating`) y de `heroSprite`
  (mapeo pose→archivo: `rest`→`anim_idle.png`, `combat`→`idle.png`, etc.).
- **typecheck + build**: `npm run typecheck`, `npm run build`.
- **Verificación manual** en la app: recorrer cada fila del mapeo.

## Fuera de alcance

- Importar o generar sprites nuevos (PixelLab, `Attack`/`Special*`).
- Direcciones de `item`/`dead`/`jump` distintas a la de frente.
- Cambios de servidor: el `status` ya llega por WS; es solo presentación.
