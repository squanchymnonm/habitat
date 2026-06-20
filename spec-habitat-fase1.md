# MNONMAgents — Hábitat de sesiones · Spec Fase 1 (mirador)

> Spec para levantar en Claude Code. Sugerido: abrir, opcionalmente correr
> `superpowers:brainstorming` para afinar, luego `writing-plans` → TDD.

## 1. Contexto

Sistema personal para desarrollar en varios proyectos en paralelo sin estar
frente a la PC. Cada proyecto corre en una sesión de **Claude Code** dentro de
**tmux** en un server siempre encendido, accedido por **VPN**.

Ya existe y está **aprobado** el frontend: una GUI pixel-art ("hábitat") donde
cada sesión es un personaje animado que cambia según su estado. Archivo de
referencia: `habitat-prototipo.html` (autocontenido, sprites embebidos, capa de
datos *mock* claramente marcada).

Esta fase construye el **backend Node** que reemplaza esa capa mock con datos
reales: leer tmux, recibir hooks de Claude Code y empujar estado por WebSocket.

Decisiones ya tomadas (no re-discutir salvo que aparezca fricción real):

- **Stack:** Node ahora, puerta abierta a Laravel después. Sin DB en Fase 1.
- **Transporte:** WebSocket desde el arranque (el chat directo es Fase 2).
- **Interacción Fase 1:** mirador (solo lectura). Se responde por Remote Control
  en el celu. El chat directo en la GUI es Fase 2.
- **Fuente del estado:** hooks de Claude Code (no parsing frágil de la terminal).

## 2. Objetivo

Ver en la GUI, en vivo y por VPN, todas las sesiones de Claude Code del server
con su estado actual y qué están haciendo, para saber de un vistazo cuál necesita
intervención.

## 3. Alcance

**En alcance (P0)**

- Servicio Node único con 4 responsabilidades: servir la GUI estática, servidor
  WebSocket, endpoint de hooks, y lector de tmux.
- Mapeo de eventos de hooks → estado de sesión.
- Contrato de sesión estable (ver §5).
- Reemplazo de la capa mock del frontend por un cliente WebSocket.
- Preview del panel tmux en el drawer (capture-pane).
- Seguridad básica: bind a la VPN/loopback + token compartido (Ley 1).

**Fuera de alcance (Fase 1)** — con motivo:

- Chat directo en la GUI → Fase 2 (requiere send-keys + stream).
- Persistencia / historial de sesiones → todavía no hay necesidad real.
- Auth multiusuario → la VPN ya es la barrera; es proyecto personal.
- Scheduling, métricas de tokens/costo, observabilidad Langfuse → más adelante.

**Fase 2 (diseñar para, no construir ahora)**

- Chat directo por WebSocket: `send-keys` para enviar y `pipe-pane` para
  stremear la salida del panel a la GUI.

## 4. Leyes / principios

- **Ley 1 — seguridad primero:** no exponer a internet; el endpoint de hooks y el
  WS exigen token; el payload de hooks se trata como no confiable.
- **Núcleo = fuente de verdad:** en Fase 1 el "núcleo" es el servicio Node.
  Mantener el contrato de sesión estable para poder migrar a Laravel después sin
  tocar el frontend.

## 5. Contrato de sesión

El frontend ya renderiza a partir de este shape. **No cambiarlo.**

```ts
type Status = 'idle' | 'working' | 'waiting' | 'done' | 'error' | 'offline';

interface Session {
  id: string;        // Claude Code session_id (estable durante la sesión)
  name: string;      // nombre legible (basename del cwd, o el nombre de tmux)
  project: string;   // proyecto / repo
  branch: string;    // rama git activa
  status: Status;    // estado actual
  action: string;    // qué está haciendo / qué pregunta (texto corto)
  since: number;     // epoch ms del último cambio de estado
  tmux?: string;     // nombre de la sesión tmux (para preview y Fase 2)
}
```

`status` se mapea en el frontend a: quieta / trabajando / te necesita / lista /
error / caída.

## 6. Estado desde hooks de Claude Code

### 6.1 Configuración de hooks

Preferir **hooks HTTP** (`"type": "http"`) que hacen POST del payload al servicio
con un `Authorization: Bearer $MNONM_TOKEN` (usar `allowedEnvVars` para inyectar
el token). Si la versión instalada no soporta HTTP hooks, fallback a **command
hook**: un script `mnonm-hook` que lee el JSON de stdin y lo reenvía por `curl`.

Requisito: Claude Code ≥ 1.0.20 (los hooks se introdujeron ahí). **Verificar el
esquema exacto de cada evento contra la doc oficial** (ver §16) durante la
implementación, porque puede haber cambiado.

### 6.2 Identidad de la sesión

Correlacionar el `session_id` de Claude con la sesión tmux:

- El wrapper de arranque (`mono <proyecto>`) crea la sesión tmux con nombre
  conocido y exporta `MNONM_TMUX=<nombre>` en el entorno.
- El hook adjunta ese valor (header `X-Mnonm-Tmux: $MNONM_TMUX` en HTTP hooks, o
  el script lo lee de la env).
- Fallback: derivar `name`/`project` del campo `cwd` del payload, y `branch` con
  `git -C <cwd> rev-parse --abbrev-ref HEAD`.

### 6.3 Mapeo evento → estado

Campos comunes en todo evento: `session_id`, `cwd`, `hook_event_name`
(+ `tool_name`, `tool_input` en eventos de tool, `message` en Notification).

| Evento de hook        | status resultante | action                                            |
|-----------------------|-------------------|---------------------------------------------------|
| `SessionStart`        | `idle`            | registrar sesión; derivar project/branch del cwd  |
| `UserPromptSubmit`    | `working`         | "procesando tu pedido"                            |
| `PreToolUse`          | `working`         | tool_name + objeto (ej. "editando UserController.php", "corriendo: npm test") |
| `PostToolUse`         | `working`         | actualizar acción (sigue trabajando)              |
| `Notification`        | `waiting`         | el `message` (ej. "pide permiso para…", "espera tu input") |
| `Stop`                | `idle`            | "a la espera"                                     |
| `StopFailure`         | `error`           | motivo del fallo                                  |
| `SessionEnd`          | `offline`         | "sesión cerrada"                                  |

Notas:

- **`Notification` es la señal clave de "te necesita"** (incluye permission_prompt
  e idle_prompt).
- `done` y `error` finos son heurísticos opcionales: se puede marcar `done`
  cuando un `Stop` sigue a un commit/PR, pero no es obligatorio en Fase 1.
- Mantener el último `action` por sesión y actualizar `since` en cada cambio de
  `status`.

## 7. Integración tmux

- **Descubrir sesiones:** registry construido desde los hooks (preferido), con
  `tmux ls` como respaldo para detectar sesiones huérfanas.
- **Preview (drawer):** `tmux capture-pane -p -t <tmux>` → últimas N líneas.
- **Fallback de actividad:** si una sesión no emite hooks por un tiempo, marcar
  `offline` o `idle` según corresponda.
- **Fase 2:** `tmux send-keys -t <tmux> '<msg>' Enter` para enviar, y
  `tmux pipe-pane -t <tmux> -o 'cat >> <fifo/sock>'` para streamear la salida.

## 8. Protocolo WebSocket

**server → client**

```jsonc
{ "type": "snapshot", "sessions": [ /* Session[] */ ] }   // al conectar
{ "type": "session",  "session": { /* Session */ } }      // upsert (alta o cambio)
{ "type": "remove",   "id": "…" }                          // sesión terminada
```

**client → server** (Fase 2)

```jsonc
{ "type": "chat", "id": "…", "text": "…" }
```

Requisitos: el cliente reenvía/reconecta al caerse la conexión; al reconectar
recibe un `snapshot` completo.

## 9. Integración del frontend

Partir de `habitat-prototipo.html`:

- Reemplazar el bloque marcado `CAPA MOCK` por un **cliente WebSocket** que
  mantiene el array `SESSIONS` y llama `render()` en cada mensaje
  (`snapshot` → reemplaza todo; `session` → upsert; `remove` → saca por id).
- El contrato de sesión es idéntico, así que `render()`, `sprData()`, `faceFor()`
  y `pickKey()` **no cambian**.
- Quitar los botones de demo (o dejarlos detrás de un flag `?demo=1`).
- Los sprites/retratos ya están embebidos en base64 → el front no depende de
  assets externos. (Opcional a futuro: externalizarlos para bajar el peso.)
- El drawer pide el preview del panel por WS o por un fetch al servicio.

## 10. Seguridad (Ley 1)

- Bindear el servicio a la interfaz de la VPN o a loopback detrás de un proxy de
  la VPN. **Nunca** exponer a internet.
- El endpoint de hooks exige `Bearer` token; rechazar si no coincide.
- El WS exige token (query param o header). En VPN es opcional pero recomendado.
- Validar que los hooks llegan desde localhost (corren en el mismo server).
- Tratar todo payload de hook como entrada no confiable (sanitizar antes de
  mostrar en la GUI).

## 11. Estructura de archivos (propuesta)

Alineado con `/srv/mnonmagents/` (`infra/`, `app/`, `data/`). Componente nuevo:

```
/srv/mnonmagents/habitat/
  server/
    index.js        # arranque: static + ws + hooks
    state.js        # Map de sesiones + reglas de transición
    hooks.js        # endpoint de hooks + mapeo evento→estado
    ws.js           # servidor WebSocket (snapshot/session/remove)
    tmux.js         # ls / capture-pane (+ send-keys, pipe-pane en Fase 2)
    config.js       # puerto, bind, token, N líneas de preview
  web/
    index.html      # el prototipo aprobado, con la capa mock reemplazada
  hook/
    mnonm-hook      # script fallback (lee stdin, curl-ea al servicio)
  README.md
```

(Decisión a confirmar: `habitat/` como componente aparte vs. dentro de `app/`.)

## 12. Requisitos

**P0 (sin esto no sirve)**

- Lista de sesiones en vivo en la GUI, una por sesión de Claude Code en tmux.
- Estado en vivo derivado de hooks según §6.3.
- Push por WebSocket (snapshot + upsert + remove).
- Preview real del panel tmux en el drawer.
- Bind a VPN/loopback + token en hooks.
- Capa mock reemplazada; `render()` intacto.

**P1 (mejora fuerte, no bloquea)**

- Reconexión robusta del WS; soporte de varios browsers a la vez.
- Aviso de "te necesitan" (título de pestaña / sonido) cuando una pasa a
  `waiting`.

**P2 (Fase 2 / futuro — diseñar para, no construir)**

- Chat directo en la GUI por WS (send-keys + pipe-pane).
- Persistencia/historial, auth, scheduling, backend Laravel.

## 13. Criterios de aceptación

```
Dado que arranco dos sesiones tmux con claude
Cuando abro la GUI por VPN
Entonces veo dos pods, cada uno con su personaje y nombre de proyecto/rama
```
```
Dado una sesión activa
Cuando Claude usa una tool (ej. edita un archivo)
Entonces el pod pasa a "trabajando" y muestra la acción correspondiente
```
```
Dado una sesión activa
Cuando Claude emite un Notification (pide permiso o espera input)
Entonces el pod pasa a "te necesita" (salto + anillo coral + globo)
```
```
Dado una sesión en "te necesita" que resuelvo por Remote Control
Cuando Claude termina el turno (Stop)
Entonces el pod vuelve a "quieta"
```
```
Dado una sesión abierta
Cuando cierro la sesión (SessionEnd)
Entonces el pod pasa a "caída" (o desaparece según §14)
```

Checklist:

- [ ] Sin VPN no hay acceso a la GUI ni al endpoint de hooks.
- [ ] Hook sin token válido → rechazado.
- [ ] Clic en un pod → preview real de las últimas líneas del panel tmux.
- [ ] Reabrir la GUI (o recargar) → snapshot completo y consistente.
- [ ] Una sesión sin hooks por X tiempo → estado coherente (idle/offline).

## 14. Decisiones a confirmar

- ¿`habitat/` como componente propio o dentro de `app/`? (eng)
- ¿`SessionEnd` saca el pod al toque o lo deja en "caída" N minutos? (producto)
- ¿Token en el WS obligatorio dentro de la VPN? (seguridad)
- ¿HTTP hooks o command hook según la versión de Claude Code instalada? (eng,
  verificar al implementar)

## 15. Para arrancar en Claude Code

1. Confirmar versión de Claude Code y soporte de HTTP hooks.
2. Empezar por `state.js` + el contrato (§5) y el WS con datos *fake* → validar
   que el frontend se alimenta del WS (reemplazo de la capa mock).
3. Recién ahí enchufar el endpoint de hooks (§6) y `tmux.js` (§7).
4. Cerrar con los criterios de aceptación (§13) en TDD.

## 16. Referencias

- Hooks de Claude Code (verificar esquema exacto de eventos y campos):
  https://docs.claude.com/en/docs/claude-code/hooks
- tmux: `man tmux` → `capture-pane`, `send-keys`, `pipe-pane`.
- Frontend de referencia: `habitat-prototipo.html` (capa mock marcada).
