# Hábitat

Monitor pixel-art de sesiones de Claude Code. Ver `docs/superpowers/specs/2026-06-19-habitat-rpg-design.md`.

- `server/` — backend Node (WS + hooks + tmux). Tests: `cd server-dir`… `node --test`.
- `client/` — app Vue 3 + TS (Vite). Buildea a `web/` (gitignored), que sirve el server.

## Correr (producción)
    cd habitat
    npm install
    (cd client && npm install && npm run build)   # genera habitat/web/
    HABITAT_TOKEN=<tu-token> npm start
    # GUI en http://127.0.0.1:8377/?token=<tu-token>  (bind loopback; exponer solo por VPN)

## Desarrollo del front (HMR)
    cd habitat && HABITAT_TOKEN=<tu-token> npm start   # backend en :8377
    cd habitat/client && npm run dev                 # Vite en :5173, proxea /ws y /preview al backend
    # los sprites se generan con: bash habitat/scripts/import-assets.sh (a client/public/assets)

## Crear sesiones desde el panel (opcional)

Deshabilitado por default. Para habilitarlo, exportar antes de `npm start`:

    export HABITAT_ALLOW_SPAWN=1
    export HABITAT_PROJECTS="/home/tu/proyecto-a:/home/tu/proyecto-b"   # rutas absolutas, separadas por :

Con eso, el header muestra "+ NUEVA SESIÓN": elegís un proyecto y el server crea una sesión
tmux con nombre = basename del directorio y lanza `claude` dentro. El pod aparece cuando Claude
dispara `SessionStart`. El nombre tmux = basename habilita el preview y el chat sobre esa sesión.

> Crear sesiones spawnea procesos en tu máquina. El endpoint exige el mismo token, bind a
> loopback, el flag `HABITAT_ALLOW_SPAWN`, y que el directorio esté en `HABITAT_PROJECTS`.

## Hooks (command hook)
Agregar a `~/.claude/settings.json`. `habitat-hook` debe estar en PATH o usar ruta absoluta.
Exportar `HABITAT_TOKEN` (y `HABITAT_URL` si el server no está en el default) en el entorno del wrapper de arranque.

    {
      "hooks": {
        "SessionStart":     [{ "hooks": [{ "type": "command", "command": "habitat-hook" }] }],
        "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "habitat-hook" }] }],
        "PreToolUse":       [{ "matcher": "*", "hooks": [{ "type": "command", "command": "habitat-hook" }] }],
        "PostToolUse":      [{ "matcher": "*", "hooks": [{ "type": "command", "command": "habitat-hook" }] }],
        "Notification":     [{ "hooks": [{ "type": "command", "command": "habitat-hook" }] }],
        "PreCompact":       [{ "hooks": [{ "type": "command", "command": "habitat-hook" }] }],
        "Stop":             [{ "hooks": [{ "type": "command", "command": "habitat-hook" }] }],
        "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "habitat-hook" }] }]
      }
    }

> Verificar contra https://docs.claude.com/en/docs/claude-code/hooks el esquema vigente
> de cada evento y el nombre de campos (`tool_name`, `tool_input.todos`, `transcript_path`).
> `StopFailure` puede no existir como evento separado según versión — en ese caso el error
> llega como `Stop` con un campo de fallo; ajustar `hooks-logic.js` si difiere.

## StatusLine (stamina real)

La stamina del orbe = `100 − context_window.used_percentage` que Claude Code
calcula por sesión contra la ventana real (200k o 1M). Para alimentarla, apuntar
`statusLine.command` en `~/.claude/settings.json` al wrapper de habitat, que
postea a `/status` y delega en el renderer del statusline existente:

    {
      "statusLine": {
        "type": "command",
        "command": "bash /ruta/a/habitat/hook/habitat-statusline"
      }
    }

- Exportar `HABITAT_TOKEN` (y `HABITAT_URL_STATUS` si el server no está en el
  default `http://127.0.0.1:8377/status`) en el entorno.
- `HABITAT_STATUSLINE_DELEGATE` controla el renderer al que se delega; por
  default `bash $HOME/.claude/statusline-command.sh` (el del plugin
  `statusline@claude-statusline`). El wrapper NO edita ese archivo.
