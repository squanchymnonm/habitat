# Pods en modo compacto para tablet

Fecha: 2026-06-27

## Objetivo

Adaptar mejor la UI del hábitat a resoluciones de tablet agregando un **modo
compacto** para los pods de sesión. En modo compacto, los pods dejan de mostrar
la batalla (MiniArena) y pasan a una fila chica que muestra solo lo esencial:
avatar del hero, nombre de la sesión, proyecto y stamina. Además, en landscape
el rail se vuelve más angosto para dejar más espacio al panel de detalle.

Es un cambio **puramente aditivo**: el modo normal (battle) y el `MiniArena`
quedan intactos.

## Decisiones de diseño

- **Activación**: toggle global manual (un botón achica todos los pods a la vez).
- **Stamina**: pelotita con gradiente de color continuo (verde→amarillo→rojo)
  según el % exacto.
- **Persistencia**: la preferencia se guarda en `localStorage` y se mantiene
  entre recargas.
- **Rail en landscape compacto**: ancho ajustable con mínimo ~180px (default
  ~210), persistido aparte para no pisar el ancho del modo normal.

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

### 2. Botón toggle en el header (`App.vue`)

En la nav `.views` (junto a *Sesiones / ⚙ Settings / Salir*) se agrega un botón
`ctl` que llama a `toggleCompact()` y muestra clase `active` cuando
`compact === true`. Solo es relevante en la vista de sesiones.

```vue
<button class="ctl" :class="{ active: compact }" @click="toggleCompact"
        title="Pods compactos">▭ Compacto</button>
```

### 3. Pod compacto (`SessionPod.vue`)

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

### 4. Pelotita de stamina (gradiente continuo)

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

### 5. Rail angosto en landscape compacto (`HabitatLayout.vue`)

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

Los estilos de `.pod` viven en `style.css` (global). Se agrega un bloque
`.pod.compact` que:
- Cambia a `display:flex` horizontal (avatar | meta | stamina).
- Reduce padding/altura respecto del pod normal.
- Define `.stam-dot` (círculo ~12–14px, `border-radius:50%`) y `.stam-pct`.
- Reglas para el avatar chico (`~32–40px`, pixelado, borde de estilo retro).

Se respeta `@media (prefers-reduced-motion: reduce)` ya existente (desactiva la
transición de color de la pelotita).

## Qué NO cambia

- `MiniArena.vue` y su barra de stamina quedan intactos (solo se ocultan vía
  `v-if` desde el pod en modo compacto).
- El modo normal de los pods no cambia.
- La lógica de selección, drag/reorder y el panel de detalle no cambian.

## Testing

- `useCompactPods`: lee/escribe `localStorage` y togglea el estado.
- Verificación manual en tablet (landscape y portrait): el toggle achica los
  pods, el rail se angosta en landscape, la pelotita refleja el color correcto
  según la stamina, y la preferencia persiste tras recargar.
- Validar typecheck/build del cliente (`habitat/client`).
```
