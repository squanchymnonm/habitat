# UI tablet: pods compactos + chrome flotante

Fecha: 2026-06-27

## Objetivo

Adaptar mejor la UI del hábitat a resoluciones de tablet. Dos cambios:

1. **Modo compacto de pods**: un toggle global achica todos los pods de sesión;
   dejan de mostrar la batalla (MiniArena) y pasan a una fila chica con avatar
   del hero, nombre de la sesión, proyecto y stamina (pelotita). En landscape
   el rail se vuelve más angosto para dejar más espacio al panel de detalle.
2. **Chrome flotante**: se elimina el `<header>` fijo. Sus controles pasan a un
   **menú hamburguesa flotante** (arriba-izquierda) y los contadores de sesiones
   pasan a un **badge de stats flotante** (arriba-derecha). Así se gana altura
   vertical, clave en tablet.

El modo normal de los pods (battle) y el `MiniArena` quedan intactos: el modo
compacto solo los oculta vía `v-if`.

## Decisiones de diseño

- **Activación compacto**: toggle global manual (un botón achica todos los pods).
- **Stamina**: pelotita con gradiente de color continuo (verde→amarillo→rojo)
  según el % exacto.
- **Persistencia**: la preferencia de compacto se guarda en `localStorage`.
- **Rail en landscape compacto**: ancho ajustable con mínimo ~180px (default
  ~210), persistido aparte para no pisar el ancho del modo normal.
- **Header**: se elimina por completo. Controles → hamburguesa; stats → badge
  flotante. El `<footer>` (crédito de sprites) se mantiene.
- **Hamburguesa**: arriba-izquierda; contiene brand, switch Sesiones/Settings,
  toggle Compacto, `+ Nueva sesión` (SpawnMenu embebido) y Salir.
- **Stats**: badge flotante arriba-derecha, siempre visible.

## Componentes

### 1. `composables/useCompactPods.ts` (nuevo)

Estado compartido entre el botón del header y los pods. Sigue el patrón de
estado a nivel de módulo (singleton) para que sea reactivo y único.

```ts
import { ref } from 'vue'

const KEY = 'habitat.compactPods'
const compact = ref(localStorage.getItem(KEY) === '1')

export function useCompactPods() {
  function toggleCompact() {
    compact.value = !compact.value
    localStorage.setItem(KEY, compact.value ? '1' : '0')
  }
  return { compact, toggleCompact }
}
```

- `compact`: `Ref<boolean>` compartido.
- `toggleCompact()`: invierte y persiste.
- **Depende de**: `localStorage`, Vue `ref`.

### 2. Menú hamburguesa flotante (`components/AppMenu.vue`, nuevo)

Reemplaza la nav del header eliminado. Componente con:

- Botón `☰` flotante (`position:fixed`, arriba-izquierda, z-index alto) que
  togglea un drawer/menú.
- El drawer contiene, en orden:
  - **Brand** (EL MONO· HÁBITAT) como encabezado del menú.
  - Switch de vista: **Sesiones** / **⚙ Settings** (botones `ctl`, marca
    `active` el actual).
  - Toggle **▭ Compacto** (`useCompactPods`, marca `active` cuando `compact`).
  - **+ Nueva sesión**: el `<SpawnMenu>` actual embebido.
  - **Salir** (`useAuth().logout`).
- Cierra al elegir una vista, al click fuera del drawer, o con `Escape`.

Interfaz con `App.vue`:
- Props/emit: `view` por `v-model` (`'sessions' | 'settings'`).
- Internamente usa `useAuth()` (logout), `useCompactPods()` (toggle) y renderiza
  `<SpawnMenu>`.

```vue
<!-- App.vue -->
<AppMenu v-model:view="view" />
```

```ts
// AppMenu.vue (esqueleto)
const props = defineProps<{ view: 'sessions' | 'settings' }>()
const emit = defineEmits<{ 'update:view': [v: 'sessions' | 'settings'] }>()
const open = ref(false)
const { compact, toggleCompact } = useCompactPods()
const { logout } = useAuth()
function pickView(v: 'sessions' | 'settings') { emit('update:view', v); open.value = false }
```

### 3. Stats flotantes (inline en `App.vue`)

Badge `position:fixed` arriba-derecha, siempre visible sobre el contenido. Lee
el store; reemplaza el `.count` del header. Inline en `App.vue` (es chico).

```vue
<div class="stats-hud">
  <span><b>{{ store.list.length }}</b> SESIONES</span>
  <span class="need"><b>{{ store.needCount }}</b> TE NECESITAN</span>
</div>
```

### 4. Eliminación del header (`App.vue`)

- Se borra el `<header>` completo (brand, `.count`, nav `.views`, `<SpawnMenu>`
  inline) y sus estilos asociados en `style.css` (`header`, `.brand`, `.count`,
  `.need`, `.dot` — verificar que no se usen en otro lado antes de borrar).
- `App.vue` pasa a renderizar: `<AppMenu>` + stats flotantes + el contenido
  (`HabitatLayout` o `SettingsView` según `view`) + `<footer>`.
- `#app` sigue siendo flex-column; sin header, `HabitatLayout` (flex:1) ocupa
  toda la altura disponible.

### 5. Pod compacto (`SessionPod.vue`)

- Lee `compact` desde `useCompactPods()`.
- Aplica clase `.compact` al `.pod` cuando está activo.
- En modo compacto:
  - **Oculta** `<MiniArena>` (la batalla), `.action` y `.since` (con `v-if="!compact"`).
  - **Muestra** una fila horizontal: avatar chico del hero a la izquierda
    (`faceFor(session.name, session.char)`), nombre + proyecto apilados al
    centro, y la pelotita de stamina a la derecha.
  - Conserva: `ring` de estado (color por status), tinte de proyecto, click
    para abrir el detalle, `tabindex`/rol de botón.

Layout esquemático:

```
┌──────────────────────────────────┐
│ [😀]  nombre-sesion        ● 72%  │
│       proyecto · ⌥ branch         │
└──────────────────────────────────┘
```

El avatar usa `faceFor()` (el mismo helper que ya usa `DetailPanel.vue`).

### 6. Pelotita de stamina (gradiente continuo)

Inline en `SessionPod.vue` (no amerita componente aparte por ahora).

- Color por HSL interpolado según el % exacto: `hue = stamina * 1.2`
  - 0% → hue 0 (rojo)
  - 50% → hue 60 (amarillo)
  - 100% → hue 120 (verde)
- `hsl(hue, ~70%, ~45%)` para el relleno, con un glow leve del mismo tono
  (`box-shadow`).
- `title` con el porcentaje redondeado (ej. `STAMINA 72%`).
- Transición suave de color al cambiar la stamina.

```ts
const stam = computed(() => Math.max(0, Math.min(100, props.session.stamina ?? 100)))
const stamHue = computed(() => Math.round(stam.value * 1.2)) // 0=rojo, 120=verde
const stamStyle = computed(() => ({
  background: `hsl(${stamHue.value} 70% 45%)`,
  boxShadow: `0 0 6px hsl(${stamHue.value} 70% 45% / .7)`,
}))
```

Markup:

```vue
<span class="stam-dot" :style="stamStyle" :title="'STAMINA ' + Math.round(stam) + '%'"></span>
<span class="stam-pct">{{ Math.round(stam) }}%</span>
```

### 7. Rail angosto en landscape compacto (`HabitatLayout.vue`)

Hoy `--rail-w` se controla con `railW` (resizable 280–640px, default 340,
persistido en `habitat.railWidth`). En modo compacto el rail no necesita tanto
ancho.

- Se agrega un ancho compacto propio, persistido aparte:
  `habitat.railWidthCompact` (default ~210, clamp **180**–~360).
- El ancho efectivo (`--rail-w`) se elige según `compact`:
  - `compact === true` → usa el ancho compacto (mín 180).
  - `compact === false` → usa `railW` normal (mín 280) como hasta ahora.
- El handle de resize **sigue activo** en ambos modos; clampa con el
  min/max del modo activo y persiste en la clave correspondiente.
- Solo aplica en wide-landscape (donde el rail es columna vertical). En
  wide-portrait / narrow el comportamiento de layout no cambia; los pods
  igual se renderizan compactos si el toggle está activo.

## Estilos (CSS)

En `style.css` (global):

- **Pod compacto** — bloque `.pod.compact`:
  - `display:flex` horizontal (avatar | meta | stamina).
  - Reduce padding/altura respecto del pod normal.
  - `.stam-dot` (círculo ~12–14px, `border-radius:50%`) y `.stam-pct`.
  - Avatar chico (`~32–40px`, `image-rendering:pixelated`, borde retro).
- **Chrome flotante**:
  - `.hamburger` (botón ☰): `position:fixed; top/left`, z-index alto.
  - `.app-menu` (drawer): panel flotante anclado bajo el botón, z-index alto.
  - `.stats-hud`: `position:fixed; top/right`, z-index alto; `.need` en coral.
- Se eliminan las reglas del header (`header`, `.brand`, `.count`, `.need`,
  `.dot`) salvo las que se reusen en el drawer/stats (mover/renombrar según
  haga falta).

Se respeta `@media (prefers-reduced-motion: reduce)` ya existente (desactiva la
transición de color de la pelotita).

## Qué NO cambia

- `MiniArena.vue` y su barra de stamina quedan intactos (solo se ocultan vía
  `v-if` desde el pod en modo compacto).
- El modo normal de los pods no cambia.
- La lógica de selección, drag/reorder y el panel de detalle no cambian.
- `SpawnMenu.vue` no cambia su lógica interna; solo se mueve adentro del drawer.
- El `<footer>` (crédito de sprites) se mantiene.

## Testing

- `useCompactPods`: lee/escribe `localStorage` y togglea el estado.
- Verificación manual en tablet (landscape y portrait):
  - La hamburguesa abre/cierra (click, click-fuera, Escape) y sus controles
    funcionan (cambio de vista, compacto, spawn, salir).
  - Las stats flotantes muestran los contadores correctos.
  - El toggle achica los pods, el rail se angosta en landscape, la pelotita
    refleja el color correcto según la stamina, y la preferencia persiste tras
    recargar.
- Validar typecheck/build del cliente (`habitat/client`).
```
