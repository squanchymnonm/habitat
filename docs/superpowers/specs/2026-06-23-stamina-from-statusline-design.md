# Stamina real desde el statusLine de Claude Code

**Fecha:** 2026-06-23
**Estado:** diseño aprobado, pendiente de plan de implementación

## Problema

El orbe de stamina muestra valores incorrectos. En una sesión con la context al
4%, el pod muestra 80% de stamina (debería mostrar ~96%).

La fórmula del espejo ya es correcta:

```js
// habitat/server/hooks-logic.js
function staminaFromContext(ctx, max) {
  return Math.max(0, Math.round(100 * (1 - ctx / max)));
}
```

El bug está en el denominador: `HABITAT_MAX_CONTEXT` está hardcodeado en
`200000` (`habitat/server/config.js`), pero las sesiones corren en Opus 4.8 con
ventana de **1.000.000**. La matemática lo confirma:

- Context real ≈ 4% de 1M ≈ 40.000 tokens.
- Cálculo de habitat: `40000 / 200000 = 0.20` → stamina `100 * (1 - 0.20)` = **80%**.
- Valor correcto: `40000 / 1000000 = 0.04` → stamina = **96%**.

## Por qué no alcanza con detección desde el transcript

Se descartó auto-detectar la ventana leyendo el transcript o el payload de los
hooks. Ninguna de esas fuentes expone el tamaño real de la ventana:

| Fuente | ¿Trae la ventana? |
|---|---|
| Transcript `message.model` | `claude-opus-4-8` **sin** sufijo `[1m]` — idéntico con o sin beta de 1M |
| `message.diagnostics` | `null` |
| `message.usage` | tokens, pero ningún `context_window` ni `betas` |
| Payload del hook | `session_id`, `cwd`, `transcript_path`, `tool_*`… nada de modelo/ventana |
| `~/.claude.json` | solo un catálogo de modelos disponibles, no cuál está activo por sesión |

## Fuente correcta: el statusLine

El `statusLine.command` de Claude Code (verificado en v2.1.186) recibe por stdin
un objeto `context_window` calculado por Claude Code **por sesión y contra la
ventana real** del modelo:

```json
{
  "session_id": "...",
  "transcript_path": "...",
  "context_window": {
    "context_window_size": 1000000,
    "used_percentage": 4,
    "remaining_percentage": 96,
    "total_input_tokens": 0,
    "total_output_tokens": 0
  }
}
```

El campo `context_window.used_percentage` ya es consumido por el script del
plugin de statusline del usuario (`~/.claude/statusline-command.sh`), o sea que
es real y estable, no teoría. `used_percentage` se calcula sobre input tokens
(`input + cache_creation + cache_read`) dividido por el `context_window_size`
real, así que distingue 1M de 200k automáticamente.

La stamina pedida es exactamente el espejo: `stamina = 100 − used_percentage`.

### Restricción del plugin

El script `~/.claude/statusline-command.sh` está gestionado por el plugin
`statusline@claude-statusline` (lleva el marker `managed-by-plugin` y se
reescribe en cada SessionStart). **No se edita.** Sin embargo, el instalador del
plugin solo gestiona ese archivo: **no toca `settings.json`**. El
`statusLine.command` de `settings.json` queda libre para apuntar a un wrapper
de habitat que delegue en el script del plugin para el render.

## Diseño

**Idea central:** la stamina deja de calcularse desde el transcript. Pasa a ser
`stamina = 100 − context_window.used_percentage`, alimentada por el statusLine.
Esto elimina el bug de raíz y vuelve innecesaria toda configuración manual de
la ventana.

### 1. Wrapper de statusline — `habitat/hook/habitat-statusline`

Gemelo de `habitat/hook/habitat-hook`. Bash, fire-and-forget, nunca bloquea:

- Lee el JSON de stdin una sola vez.
- POST a `${HABITAT_URL_STATUS:-http://127.0.0.1:8377/status}` con
  `Authorization: Bearer ${HABITAT_TOKEN}`, timeout corto, errores ignorados.
- Delega en el renderer del plugin pasándole el mismo stdin, para que la línea
  de estado de la terminal siga idéntica. El comando a delegar es configurable
  vía `HABITAT_STATUSLINE_DELEGATE`, default `bash $HOME/.claude/statusline-command.sh`.
- `exit 0` siempre.

Boceto:

```bash
#!/usr/bin/env bash
URL="${HABITAT_URL_STATUS:-http://127.0.0.1:8377/status}"
TOKEN="${HABITAT_TOKEN:-}"
DELEGATE="${HABITAT_STATUSLINE_DELEGATE:-bash $HOME/.claude/statusline-command.sh}"
payload="$(cat || true)"
printf '%s' "$payload" | curl -fsS -m 3 -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  --data-binary @- >/dev/null 2>&1 &
printf '%s' "$payload" | $DELEGATE
exit 0
```

### 2. Server — nueva ruta `POST /status` (`habitat/server/index.js`)

Al lado de `/hooks`, misma `authorize()`:

- Parsea el body. En error → `400`.
- `id = body.session_id`. Sin id → `400`.
- `s = store.get(id)`. Si no existe → `204` y nada (no se crean pods zombie,
  igual que el manejo de `SessionEnd` inexistente).
- Si `body.context_window?.used_percentage` es numérico:
  `s.stamina = clamp(0, 100, Math.round(100 - used_percentage))`.
- `hub.broadcast({ type: 'session', session: snapOf(s) })` y `store.persist()`.
- `204`.

La lógica de mapear el payload a stamina vive en una función pura testeable
(p.ej. `staminaFromStatus(body)` en `hooks-logic.js` o un módulo nuevo), para no
meter lógica en el handler HTTP.

### 3. Limpieza en `habitat/server/hooks-logic.js`

- Eliminar `staminaFromContext` y sus dos llamados (`UserPromptSubmit` →
  `recomputeStamina`, y `handleHit`).
- Conservar la lectura del transcript en `handleHit` **solo** para el daño de
  combate (`totalTokens` → `s.combat.tokens`), que es independiente de la stamina.
- `PreCompact` sigue poniendo `s.stamina = 5` para el efecto visual de
  "descansando"; el statusLine lo corrige al terminar el compact.
- `recomputeStamina` y el parámetro `maxContext` de las deps quedan sin uso →
  se quitan.

### 4. Config — `habitat/server/config.js`

- Eliminar `MAX_CONTEXT` (queda sin uso). Si `readUsage` deja de devolver
  `contextTokens`, simplificarlo para devolver solo `totalTokens`.

### 5. Cliente

Sin cambios. `StaminaOrb` y `SessionPod` ya consumen `session.stamina`.

### 6. Tests

- Actualizar `hooks-logic.test.js` y `state.test.js`: los casos que hoy testean
  stamina vía transcript dejan de aplicar; se ajustan o eliminan.
- Nuevo test de `staminaFromStatus` / ruta `/status`:
  - `used_percentage: 4` → `stamina 96`.
  - `used_percentage: 25` → `stamina 75`.
  - clamp en bordes (`<0`, `>100`).
  - sesión inexistente → no rompe, no crea pod.
  - payload sin `context_window` → no modifica stamina.
- TDD: tests primero.

### 7. Instalación / README

Documentar en `habitat/README.md` que `statusLine.command` en
`~/.claude/settings.json` debe apuntar al wrapper de habitat
(`bash <ruta>/habitat-statusline`), que delega en el script del plugin. Mantener
`HABITAT_TOKEN` como ya se usa para los hooks.

## Scope explícitamente descartado

- **Vista de settings configurable** para el tamaño de ventana: innecesaria, la
  ventana se detecta sola y exacta por sesión vía statusLine.
- **Tabla modelo → ventana** y **auto-ajuste por pico observado**: heurísticas
  que el statusLine vuelve obsoletas.

## Criterio de éxito

En la sesión actual (context ~4%), el orbe muestra ~96% de stamina, y el valor
sube/baja como espejo del `used_percentage` que muestra la línea de estado de la
terminal, en sesiones de 200k y de 1M por igual, sin configuración.
