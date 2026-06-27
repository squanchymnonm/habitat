# Maná de sesión (uso de Claude) + ciclo día/noche

Fecha: 2026-06-27

## Objetivo

Mostrar en el hábitat el **uso de la ventana de límite de Claude** y **cuánto
falta para que se renueve**, con estética pixel-RPG:

1. **Maná de sesión**: barra azul = `100 − used_percentage` de la ventana de 5h
   (maná lleno = sesión fresca; drena al consumir). En el chrome flotante.
2. **Próxima sesión**: tiempo hasta el reset + un indicador continuo **☀️/🌙**
   (uno entra mientras el otro se va).
3. **Emotes de maná bajo**: sprite Ninja **#21** desde 75% consumido, **#22**
   desde 90%.
4. **Ciclo día/noche global**: el fondo de la app vira amanecer→día→atardecer→
   noche según la posición en la ventana de 5h; al amanecer = sesión renovada.

El dato es **de cuenta** (compartido por todas las sesiones de un mismo Claude),
así que el indicador es **global** (uno solo), no por pod.

## Origen del dato (verificado)

El JSON que Claude Code pasa al `statusLine.command` incluye, para suscriptores
Pro/Max y **tras la primera respuesta**:

```json
"rate_limits": {
  "five_hour":  { "used_percentage": 23.5, "resets_at": 1738425600 },
  "seven_day":  { "used_percentage": 41.2, "resets_at": 1738857600 }
}
```

`resets_at` = epoch en **segundos**. Usamos solo `five_hour`. El hábitat ya
recibe el payload completo del statusline en `POST /status` (hoy de ahí saca la
stamina del `context_window`). **Los nombres exactos se verifican contra un
payload real** durante la implementación (parseo defensivo: si falta, no se
rompe nada y el indicador no se muestra).

## Arquitectura (resumen del flujo existente)

- `habitat/hook/habitat-statusline` postea el JSON del statusline a `POST /status`.
- `index.js` `POST /status`: hoy `staminaFromStatus(body)` → setea `s.stamina`,
  `hub.broadcast({type:'session', session: snapOf(s)})`, `store.persist()`.
- WS (`ws.js`): al conectar envía `{type:'snapshot', sessions: store.snapshot()}`;
  `broadcast(msg)` difunde a todos.
- Cliente (`useSocket.ts`): rutea `snapshot`/`session`/`remove`/… a la store Pinia.

## Componentes

### Server

#### 1. `hooks-logic.js`: `usageFromStatus(body)`

Nueva función pura, hermana de `staminaFromStatus`:

```js
export function usageFromStatus(body) {
  const r = body && body.rate_limits && body.rate_limits.five_hour;
  if (!r) return null;
  const pct = r.used_percentage, resetAt = r.resets_at;
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null;
  if (typeof resetAt !== 'number' || !Number.isFinite(resetAt)) return null;
  return { pct: Math.max(0, Math.min(100, pct)), resetAt }; // resetAt en segundos epoch
}
```

#### 2. Estado global de uso en la store (`state.js`)

El uso es de cuenta, no por sesión. Se guarda un único objeto global en la
store, persistido junto al resto:

- `store.getUsage()` → `{pct, resetAt} | null`
- `store.setUsage(u)` → guarda y `persist()`

(Se serializa/revive con el mismo mecanismo de persistencia; clave aparte del
mapa de sesiones.)

#### 3. `POST /status` (`index.js`)

Tras el bloque de stamina, agregar:

```js
const usage = usageFromStatus(body);
if (usage) {
  store.setUsage(usage);
  hub.broadcast({ type: 'usage', usage });
}
```

#### 4. Snapshot inicial (`ws.js`)

Incluir el uso al conectar:

```js
ws.send(JSON.stringify({ type: 'snapshot', sessions: store.snapshot(), usage: store.getUsage() }));
```

### Cliente

#### 5. Tipos (`types.ts`)

```ts
export interface Usage { pct: number; resetAt: number } // resetAt: epoch segundos
```

`ServerMessage`: agregar variante `{ type: 'usage'; usage: Usage | null }` y que
`snapshot` traiga `usage?: Usage | null`.

#### 6. `composables/useUsage.ts` (singleton, patrón `useAuth`)

- `usage: Ref<Usage | null>` — alimentado por WS.
- `setUsage(u)`.
- Un reloj compartido `now: Ref<number>` que tickea cada 30s (un solo
  `setInterval` a nivel de módulo) para refrescar la cuenta regresiva y la fase.
- Derivados (computed):
  - `mana = usage ? Math.round(100 - usage.pct) : null`
  - `msToReset = usage ? usage.resetAt*1000 - now : null`
  - `cyclePos` (0..1) = `usage ? clamp(1 - msToReset/WINDOW_MS, 0, 1) : null`
    con `WINDOW_MS = 5*3600*1000`. (0 = recién renovado/amanecer, 1 = por
    renovar/noche.)
  - `resetLabel` = formato `"Xh YYm"` / `"Ym"`.
- Cuando `usage` es `null` (no Pro/Max o sin dato aún): todo derivado es `null`
  y la UI de uso no se muestra; el ciclo día/noche queda neutro (sin override).

#### 7. `useSocket.ts`

Rutear: `snapshot` → `setUsage(msg.usage ?? null)` además de `setAll`; y
`else if (msg.type === 'usage') setUsage(msg.usage)`.

#### 8. `components/UsageHud.vue` (chrome flotante)

Se monta en `App.vue` junto a `.stats-hud` (zona flotante arriba-derecha).
Visible solo si `usage != null`. Contiene **dos recuadros de igual alto**
(contenedor flex con `align-items:stretch`):

- **Recuadro maná**: etiqueta `MANÁ` + barra (track oscuro cálido, relleno azul
  vívido **sólido** `#3FA8FF` con línea de brillo arriba, glow). Ancho del
  relleno = `mana%` (variable CSS de nivel **separada del color** — no reusar la
  misma var para ancho y color). Emote de maná bajo (abs., no agranda la card):
  `#21` si `100-mana ≥ 75`, `#22` si `≥ 90` (rebota; oculto si no).
- **Recuadro tiempo**: el dial **☀️/🌙** (ver 9) + `próxima` + `resetLabel`.

#### 9. Dial ☀️/🌙 continuo (dentro de `UsageHud.vue`)

Ventanita `overflow:hidden` (~20×18) con dos `<span>` (☀️ y 🌙). Ambos viajan en
el mismo sentido (suben y salen por arriba), desfasados medio ciclo, en función
de `cyclePos`:

```
qSun = cyclePos;  qMoon = (cyclePos + 0.5) % 1
y(q) = 120 - 240*q     // q0 abajo(120%) → q1 arriba(-120%), clipeado
```

Siempre hay uno visible; en el cruce uno entra por abajo mientras el otro sale
por arriba. El salto de reaparición (q wrap) se hace **sin** transición (se
detecta el salto grande y se desactiva `transition` esa actualización).

Emoji por pedido del usuario. (Alternativa pixel: sprites `Sun.png`/`Moon.png`
del pack Ninja vía `import-assets.sh`; no se implementa ahora.)

#### 10. Ciclo día/noche global del fondo (`composables/useDayNight.ts` + capa en `App.vue`)

Una capa fija a pantalla completa detrás del contenido (`position:fixed; inset:0;
z-index:0; pointer-events:none`) cuyo gradiente se interpola según `cyclePos`
(amanecer→día→atardecer→noche, con el día ocupando la mayor parte). El contenido
de la app va por encima. Es **solo color/luz de fondo**: no toca superficies de
pods/HUD ni la legibilidad del texto.

- `cyclePos == null` → capa neutra (oculta o tono base actual).
- Transición suave de color (no saltos bruscos al llegar updates del statusline).
- Respeta `@media (prefers-reduced-motion: reduce)` (sin transiciones).

## Estilos

En `style.css`: reglas de `UsageHud` (recuadros, barra de maná con var de nivel
separada del color, emote absoluto, dial) y de la capa `.sky-ambient`. La barra
reusa la lógica de color del maná (azul sólido, no degradé a oscuro). Respeta
reduced-motion.

## Qué NO cambia

- `staminaFromStatus` y la stamina por sesión quedan intactas.
- El resto del chrome flotante (hamburguesa, stats) no cambia; se suma `UsageHud`.
- El layout/selección/pods no cambian.

## Riesgos / cuidado

- **Nombres del payload** (`rate_limits.five_hour.used_percentage`/`resets_at`):
  verificar contra un statusline real; parseo defensivo (ausencia → no romper).
- **Ciclo global**: contenerlo a una capa de fondo; no degradar contraste ni
  cubrir contenido (revisar z-index). Transición suave.
- Dato solo en Pro/Max y tras la 1ª respuesta → manejar `null` en todo el flujo.

## Testing

- `usageFromStatus`: payload con/ sin `rate_limits`, campos no numéricos,
  clamp de `pct`. (TDD, server.)
- `useUsage`: deriva `mana`, `msToReset`, `cyclePos` (con `now` mockeado);
  `null` cuando no hay dato. (TDD, cliente.)
- Dial: función pura de posición `y(q)` y el desfase (uno visible siempre).
  (TDD, función extraída.)
- Manual en tablet: maná drena, emotes 21/22 a 75/90%, dial ☀️/🌙 continuo,
  fondo día/noche suave y legible, persistencia tras recargar, y ausencia de
  dato (no rompe, no muestra HUD).
- typecheck/test/build del cliente; validar módulos del server tocados.
