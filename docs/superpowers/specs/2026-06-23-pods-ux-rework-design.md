# Hábitat — Mejoras de UX de pods y sesión abierta

Fecha: 2026-06-23

## Contexto

La UI del hábitat (cliente Vue 3 + Pinia en `habitat/client`, server en `habitat/server`)
muestra una lista de "pods" de sesión en `SessionRail` y un `DetailPanel` con el terminal
de la sesión seleccionada. Cuatro problemas de UX motivan este trabajo:

1. Al hacer `/clear` en una sesión, su pod salta al final de la lista y se pierde el foco.
2. No se pueden reordenar los pods manualmente.
3. El color del proyecto solo se ve en el pod, no dentro de la sesión abierta.
4. No hay señal gráfica clara de qué pod está abierto: la cara del héroe es lo único, y el
   borde dorado de selección queda pisado por las clases de estado.

## Objetivos

- `/clear` conserva la posición del pod y mantiene el foco en él.
- Reordenar pods arrastrándolos, con el orden persistido en el server y compartido por WS.
- El color del proyecto se refleja también en el header del `DetailPanel`.
- Marca inequívoca del pod abierto, independiente de su estado.

No-objetivos: reordenar proyectos, cambiar la lógica de spawn/kill, tocar el combate RPG.

---

## Feature 1 — `/clear` conserva posición y foco

### Causa raíz

En `/clear`, `applyEvent` (`server/hooks-logic.js:67-90`) reusa el pod existente pero le
**cambia el `id`** al nuevo `session_id`, y `index.js` emite dos mensajes WS: `session`
(con el id nuevo) y `remove` (con el id viejo). En el front (`composables/useSocket.ts`):

- `store.upsert(sessionNueva)` no encuentra el id nuevo → hace `push` al final de `list`.
- `store.remove(idViejo)` saca el pod viejo y `reconcile()` cae a `ids[0]` si el viejo
  estaba seleccionado → se pierde el foco.

### Solución — mensaje `rekey` dedicado

El rekey es una operación atómica "este pod cambió de id", no un alta + baja. Lo modelamos
como tal:

- **`server/hooks-logic.js`**: el branch de `/clear` devuelve, además de `session`, un campo
  `rekey: { from: oldId, to: prev.id }`. Se mantiene `removed` fuera de este caso para no
  alterar el resto de flujos.
- **`server/index.js`**: al procesar el resultado de `applyEvent`, si viene `rekey`, emite
  `{ type: 'rekey', from, to, session: snapOf(session) }` y **omite** el par `session` +
  `remove` para ese evento. El resto de eventos queda igual.
- **`client/src/types.ts`**: agregar a `ServerMessage` el caso
  `{ type: 'rekey'; from: string; to: string; session: Session }`.
- **`stores/sessions.ts`**: nuevo método `rekey(from, to, session)`:
  - Busca el índice de `from` en `list`. Si existe, **reemplaza ese elemento in situ** por
    `session` (misma posición). Si no existe (caso borde), hace `upsert`.
  - Si `selectedId === from`, lo setea a `to`.
  - No llama a `reconcile()` (la posición y la selección ya quedan correctas).
- **`composables/useSocket.ts`**: manejar `msg.type === 'rekey'` → `store.rekey(...)`.

### Tests

- `hooks-logic.test.js`: el test de `/clear` existente verifica que el resultado incluye
  `rekey: { from, to }` con los ids correctos.
- `stores/sessions.test.ts`: `rekey` conserva la posición del pod en `list` y migra
  `selectedId` de `from` a `to`; si el pod no estaba seleccionado, `selectedId` no cambia.

---

## Feature 2 — Reordenar pods arrastrando

### Decisiones

- Librería: `vuedraggable@next` (SortableJS, compatible Vue 3, soporte táctil incluido).
- Orden persistido en el **server** y compartido por WS a todos los clientes.
- Soporte **desktop + táctil** desde el arranque (long-press en touch para no chocar con el
  scroll y el tap de selección).
- Sesiones nuevas se agregan **al final** (comportamiento natural del `Map` del store).

### Server

- **`server/state.js`**: nuevo método del store `reorder(ids)`:
  - Reconstruye el `Map` interno en el orden de `ids`. Ids presentes en `ids` que existen en
    el map van primero, en ese orden; cualquier sesión existente no mencionada en `ids` se
    agrega al final (defensa ante carreras). Ids inexistentes se ignoran.
  - Llama a `persist()` (el snapshot/persistencia ya respeta el orden de inserción del Map).
- **`server/index.js`**: endpoint `POST /sessions/order` (siguiendo el patrón de los
  endpoints de `/projects`):
  - Body `{ order: string[] }`. Valida que sea array de strings.
  - Llama `store.reorder(order)` y emite broadcast `{ type: 'reorder', order }`.
  - Responde 200. Sujeto al mismo guard de auth/token que el resto de endpoints de escritura.

### Cliente

- **`client/package.json`**: agregar dependencia `vuedraggable@next`.
- **`client/src/types.ts`**: agregar a `ServerMessage` el caso
  `{ type: 'reorder'; order: string[] }`.
- **`stores/sessions.ts`**: método `reorder(ids)` que ordena `list` según `ids` (estable:
  los ids no presentes en la lista actual se ignoran; pods de `list` no presentes en `ids`
  van al final preservando su orden relativo). No toca `selectedId`.
- **`composables/useSocket.ts`**: manejar `msg.type === 'reorder'` → `store.reorder(order)`.
- **`composables/useProjects.ts`** (o un nuevo helper en el store/composable de sesiones):
  función `postOrder(ids)` que hace `POST /sessions/order`.
- **`components/SessionRail.vue`**: envolver los pods en `<draggable>`:
  - `item-key="id"`, animación corta, `handle`/long-press para touch.
  - Update optimista local (reordena `list`) al soltar, y `postOrder(nuevoOrden)`.
  - El drag no debe disparar la selección (`@click`) del pod; distinguir tap de drag.

### Tests

- `server/state.test.js`: `reorder` deja el `Map` en el orden pedido; sesiones no
  mencionadas quedan al final; ids inexistentes se ignoran; persiste.
- `server/index.test.js`: `POST /sessions/order` reordena y emite broadcast `reorder`.
- `stores/sessions.test.ts`: `reorder` ordena `list` y deja `selectedId` intacto.

---

## Feature 3 — Color del proyecto en la sesión abierta

- **`components/DetailPanel.vue`**: importar `colorForProject` de `useProjects` (ya importa
  `useProjects`). El header `.dhead` recibe un `:style` con tinte de fondo usando el mismo
  `color-mix(in srgb, ${color} 14%, var(--surface))` que el pod (`SessionPod.vue`). Si el
  proyecto no tiene color, sin tinte (estilo vacío).

### Tests

- Cubierto por verificación visual; opcionalmente un test de render que confirme que el
  estilo se aplica cuando `colorForProject` devuelve color.

---

## Feature 4 — Marca del pod abierto

- **`components/SessionPod.vue`** + **`client/src/style.css`**:
  - Barra vertical dorada (var(--gold)) en el borde izquierdo del pod seleccionado, como
    elemento/pseudo-elemento propio, visible solo con `.selected`. Es la señal principal de
    "abierto", **independiente del estado**.
  - Ajustar la prioridad CSS para que el borde dorado de `.pod.selected` gane sobre
    `.pod.working/.waiting/.done/.error`, **conservando el ring de color de estado** (el
    estado se sigue leyendo por el ring interno; lo "abierto" por la barra dorada y el borde).
    Reordenar las reglas (selected después de las de estado) o subir especificidad sin usar
    `!important`.

### Tests

- Verificación visual: un pod `working` seleccionado muestra barra dorada + borde dorado y
  conserva el ring teal de estado.

---

## Orden de implementación sugerido

1. Feature 1 (rekey) — server + types + store + socket + tests.
2. Feature 4 (marca de abierto) — CSS, bajo riesgo.
3. Feature 3 (color en panel) — CSS, bajo riesgo.
4. Feature 2 (drag + orden en server) — la más grande; dep nueva, endpoint, WS, componente.
