# Hábitat RPG — Diseño consolidado

> Consolida `spec-habitat-fase1.md` (mirador) y `spec-habitat-rpg.md` (capa de
> combate) en un diseño único, con las decisiones tomadas en el brainstorming.
> Reemplaza ambiguidades de esos specs; donde no diga lo contrario, siguen
> vigentes. Fecha: 2026-06-19.

## 1. Qué construimos

Sistema personal para monitorear varias sesiones de **Claude Code** (cada una en
una sesión **tmux** en un server siempre encendido, accedido por **VPN**) desde
una GUI pixel-art. Cada sesión es un personaje en una grilla. La telemetría real
(estado, tokens, context, todos) se muestra **disfrazada de combate RPG**: no es
adorno, son los datos reales.

Servicio **Node** que: sirve la GUI estática, corre un servidor WebSocket, expone
un endpoint de hooks de Claude Code, lee tmux y lee el transcript para tokens.

## 2. Decisiones del brainstorming (las que cambian el alcance)

1. **Frontend nuevo, pero anclado a los mocks existentes.** El frontend no estaba
   en el repo; se rehace, partiendo de los dos mocks ya aprobados por el usuario:
   - `habitat-prototipo.html` — la **grilla** (mirador, 6 estados).
   - `habitat-batalla-mock.html` — la **escena de batalla** (un pod, stage
     completo: stamina, contador de dungeon, daño flotante, overlay de loot,
     boss, burbuja "te necesita", flinch de error, descanso=compactación).
2. **RPG desde el arranque.** El primer entregable ya incluye la escena de
   batalla con datos reales (no es una fase posterior). Esto ata el daño/stamina
   a leer tokens del transcript desde el día uno (ver §6, riesgo).
3. **Integración grilla + batalla = "batalla al expandir" (opción C/híbrida).**
   La grilla queda como vista general (pod = personaje en pose por estado). Al
   hacer **clic en un pod**, el **drawer** muestra la escena de batalla completa
   de esa sesión. Una sola sesión "en batalla" a la vez (la del drawer abierto).
4. **Assets suficientes.** El pack Ninja Adventure cubre el alcance: héroe
   (`Actor/Character`), 66 monstruos (`Actor/Monster`), 20 bosses (`Actor/Boss`),
   UI (`Ui/Dialog`, `Ui/Emote`, `Ui/Font`), y FX (`FX/Attack`, `FX/Slash`,
   `FX/Particle`) si luego se quieren efectos de golpe/descanso. No falta nada
   para este alcance.

## 3. Arquitectura

Servicio Node único en `habitat/server/`:

| Módulo          | Responsabilidad |
|-----------------|-----------------|
| `index.js`      | Arranque: sirve GUI estática + WS + endpoint hooks. |
| `state.js`      | `Map` de sesiones, reglas de transición, acumulador de combate. **Fuente de verdad.** |
| `hooks.js`      | Endpoint HTTP (Bearer token), mapea evento de hook → estado + mecánica RPG. |
| `tmux.js`       | `capture-pane` para el drawer; `tmux ls` como respaldo de sesiones huérfanas. |
| `ws.js`         | Broadcast `snapshot` / `session` / `remove`. |
| `transcript.js` | **(nuevo)** lee el JSONL del `transcript_path` para sacar tokens (daño/stamina). |
| `config.js`     | Puerto, bind, token, N líneas de preview, max-context por modelo. |

`web/index.html` parte de `habitat-prototipo.html` con la `CAPA MOCK`
reemplazada. `hook/habitat-hook` es el script fallback (stdin → curl) si la versión
de Claude Code no soporta HTTP hooks.

**Flujo:** hook de Claude Code → POST a `hooks.js` → actualiza la `Session` en
`state.js` → `ws.js` emite upsert → el front renderiza el pod (y el drawer si
está abierto en esa sesión).

## 4. Contrato de sesión

Base (`spec-habitat-fase1.md` §5) **+** campos RPG (`spec-habitat-rpg.md` §B). El
contrato es el ancla estable: permite migrar el núcleo a Laravel después sin
tocar el frontend.

```ts
type Status = 'idle' | 'working' | 'waiting' | 'done' | 'error' | 'offline';

interface Session {
  id: string;        // Claude Code session_id (estable durante la sesión)
  name: string;      // legible (basename del cwd, o nombre de tmux)
  project: string;
  branch: string;
  status: Status;
  action: string;    // qué hace / qué pregunta (texto corto)
  since: number;     // epoch ms del último cambio de estado
  tmux?: string;     // nombre de la sesión tmux (preview y Fase 2)

  // --- capa RPG ---
  stamina: number;   // 0..100 = context restante (barra del HÉROE, no vida)
  quest?: { total: number; done: number };
  monster?: {
    type: string;    // hash del texto del todo (variedad de sprite)
    isBoss: boolean;
    label: string;   // texto del todo en curso
  } | null;
  combat?: {
    hits: number;        // golpes (tool-uses) — dato secundario
    tokens: number;      // HP oculto del monstruo (suma del daño)
    lastDamage?: number; // tokens del último golpe (número flotante)
  };
}
```

Las funciones del front que el spec marca como intocables siguen igual:
`render()`, `sprData()`, `faceFor()`, `pickKey()`. La capa de batalla del drawer
es **código nuevo**, no toca esas funciones.

## 5. Mapeo hook → estado y mecánica RPG

Campos comunes en todo evento: `session_id`, `cwd`, `hook_event_name`
(+ `tool_name`, `tool_input` en tools; `message` en Notification;
`transcript_path` para tokens).

| Evento / señal | status | Efecto RPG |
|---|---|---|
| `SessionStart` | `idle` | Registrar sesión; derivar project/branch del cwd. Campamento (sin monstruo). |
| `UserPromptSubmit` | `working` | "procesando tu pedido". |
| `PostToolUse` matcher `TodoWrite` | `working` | `quest.total/done`. El todo `in_progress` define el monstruo (`type`=hash del texto, `label`, `isBoss = índice===total-1`). |
| `PreToolUse`/`PostToolUse` (otras tools) con todo en curso | `working` | **golpe**: `combat.hits++`; `damage` = delta de tokens del transcript; `combat.tokens += damage`; `lastDamage = damage` (número flotante). Baja la `stamina`. |
| Todo recién *completed* | `working` | **fin de pelea**: emitir `fightResult` (`hp = combat.tokens`, `hits`, `loot` = archivos tocados durante ese todo vía Write/Edit/MultiEdit; si no hubo, el texto del todo). Reset `combat`. Aparece el próximo monstruo. |
| `StopFailure` / error de tool | `error` | El monstruo golpea al héroe (recula/flash). El héroe **no muere** (no hay barra de vida). |
| `PreCompact` | `working` | Héroe agotado (stamina~0): descansa. |
| Fin de compactación | `working` | `stamina` repuesta (descansado). |
| `Notification` | `waiting` | Señal clave de "te necesita". Héroe se gira al jugador + globo; batalla en pausa. |
| `Stop` (done < total) | `idle` | "a la espera". |
| `Stop` con `done == total` | `done` | Dungeon cleared → cae el boss, héroe en victoria. |
| `SessionEnd` | `offline` | Gris, pausado. |

### Mensaje `fightResult` (server → client, fin de cada todo)

```jsonc
{ "type": "fightResult", "id": "…", "result": {
    "monster": "<label del todo>",
    "hp": 18450,          // = tokens que costó (HP oculto, se revela acá)
    "hits": 7,            // secundario
    "loot": ["src/Auth.php", "tests/AuthTest.php"]  // entregable del todo
}}
```

## 6. Tokens, stamina y daño (la parte frágil)

El costo de tokens de una tool puntual **no es nativo**. Lo fiel:

- **Daño por golpe** = delta del uso de tokens del transcript entre golpes. En
  cada tool hook, leer `transcript_path` (JSONL), tomar el `usage` más reciente
  del turno del asistente, `damage = acumuladoActual − acumuladoAnterior` (por
  sesión).
- **HP del monstruo** = suma del daño (`combat.tokens`), oculto hasta el final.
- **Stamina del héroe** = `100 · (1 − contextUsado / maxContextDelModelo)`.
  `maxContext` por modelo va en `config.js`. La parte fina es aproximada; el
  **ancla dura** es `PreCompact` (stamina~0) y el fin de compactación (repuesta).

**Acción obligatoria al implementar:** verificar el esquema real del transcript y
de cada evento de hook contra la doc oficial (puede haber cambiado). Si el
formato no permite el delta limpio, degradar a una aproximación documentada (p.
ej. tokens estimados por tipo de tool) sin romper el contrato.

## 7. Frontend

- Parte de `habitat-prototipo.html`. Reemplazar el bloque `CAPA MOCK` por un
  cliente WebSocket que mantiene `SESSIONS` y llama `render()` en cada mensaje
  (`snapshot`→reemplaza todo; `session`→upsert; `remove`→saca por id). Reconecta
  al caerse y pide `snapshot` al reconectar.
- Quitar los botones de demo (o dejarlos tras `?demo=1`).
- **Drawer** = escena de batalla (adaptada de `habitat-batalla-mock.html`):
  stage con héroe (pose `Attack`↔`Idle`), monstruo (sin barra), daño flotante =
  tokens del golpe, barra de **stamina (context)**, contador `done/total`, boss
  más grande, overlay de loot al vencer (HP=tokens, golpes, archivos). Debajo, el
  preview real de tmux (`capture-pane`).
- **Layout a validar:** el stage del mock es de ~580px y el drawer es un panel
  lateral más angosto → adaptar el layout reusando el CSS del mock (no arte
  nuevo). Esto se valida visualmente durante la implementación.
- Sprites/retratos embebidos en base64 (como hoy). Monstruo por hash del texto
  del todo; boss desde `Actor/Boss` para el último todo; héroe = personaje de la
  sesión.

## 8. Protocolo WebSocket

```jsonc
// server → client
{ "type": "snapshot", "sessions": [ /* Session[] */ ] }   // al conectar
{ "type": "session",  "session": { /* Session */ } }      // upsert
{ "type": "remove",   "id": "…" }                          // sesión terminada
{ "type": "fightResult", "id": "…", "result": { /* §5 */ } }  // fin de pelea

// client → server (Fase 2)
{ "type": "chat", "id": "…", "text": "…" }
```

## 9. tmux

- **Descubrir sesiones:** registry desde los hooks (preferido), con `tmux ls`
  como respaldo para huérfanas.
- **Identidad:** correlacionar `session_id` de Claude con la sesión tmux. El
  wrapper de arranque (`mono <proyecto>`) crea la tmux con nombre conocido y
  exporta `HABITAT_TMUX`; el hook lo adjunta (`X-Habitat-Tmux` en HTTP, o el script
  lo lee de la env). Fallback: derivar de `cwd` + `git rev-parse --abbrev-ref`.
- **Preview (drawer):** `tmux capture-pane -p -t <tmux>` → últimas N líneas.
- **Fallback de actividad:** sin hooks por X tiempo → `idle`/`offline`.

## 10. Seguridad (Ley 1)

- Bind a la interfaz de la VPN o loopback detrás de un proxy de la VPN. **Nunca**
  exponer a internet.
- Endpoint de hooks exige `Bearer` token; rechazar si no coincide. Validar que
  llega desde localhost.
- WS exige token (query param o header); recomendado dentro de la VPN.
- Todo payload de hook es entrada no confiable → sanitizar antes de render.

## 11. Estructura de archivos

```
habitat/
  server/
    index.js        # static + ws + hooks
    state.js        # Map de sesiones + transiciones + combate
    hooks.js        # endpoint + mapeo evento→estado+RPG
    ws.js           # snapshot/session/remove/fightResult
    tmux.js         # ls / capture-pane (+ send-keys, pipe-pane en Fase 2)
    transcript.js   # lectura de tokens del transcript
    config.js       # puerto, bind, token, N preview, maxContext por modelo
  web/
    index.html      # prototipo, CAPA MOCK → cliente WS, drawer con batalla
  hook/
    habitat-hook      # script fallback (stdin → curl)
  README.md
```

## 12. Orden de implementación (TDD)

1. `state.js` + contrato (§4) + WS con datos **fake** → validar que el front
   (grilla del prototipo) se alimenta del WS (reemplazo de la CAPA MOCK).
2. Drawer con la escena de batalla alimentada por datos fake (`stamina`,
   `quest`, `monster`, `combat`, `fightResult`).
3. Endpoint de hooks (§5) + `tmux.js` (§9).
4. `transcript.js` (§6) — tokens reales para daño/stamina.
5. Cerrar con criterios de aceptación (§13 del spec base) en TDD.

## 13. Alcance

**P0 (MVP, RPG incluido):**
- Grilla en vivo, una sesión por pod, estado por hooks.
- Drawer con escena de batalla por sesión (stamina, monstruo, daño, loot).
- Push por WS (snapshot + upsert + remove + fightResult).
- Tokens del transcript para daño/stamina (o aproximación documentada).
- Preview real de tmux en el drawer.
- Bind a VPN/loopback + token en hooks. CAPA MOCK reemplazada; `render()` intacto.

**P1:** reconexión robusta del WS, varios browsers, aviso de "te necesitan"
(título de pestaña / sonido) al pasar a `waiting`.

**P2 (Fase 2, diseñar para, no construir):** chat directo por WS (`send-keys` +
`pipe-pane`), persistencia/historial, auth, scheduling, backend Laravel.

## 14. Referencias

- Hooks + formato del transcript: https://docs.claude.com/en/docs/claude-code/hooks
- Specs base: `spec-habitat-fase1.md`, `spec-habitat-rpg.md`.
- Mocks aprobados: `habitat-prototipo.html`, `habitat-batalla-mock.html`.
