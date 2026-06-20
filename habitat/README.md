# Hábitat

Monitor pixel-art de sesiones de Claude Code. Ver `docs/superpowers/specs/2026-06-19-habitat-rpg-design.md`.

## Correr
    cd habitat
    npm install
    MNONM_TOKEN=<tu-token> npm start
    # GUI en http://127.0.0.1:8377  (bind loopback; exponer solo por VPN)

## Hooks (command hook)
Agregar a `~/.claude/settings.json`. `mnonm-hook` debe estar en PATH o usar ruta absoluta.
Exportar `MNONM_TOKEN` (y `MNONM_URL` si el server no está en el default) en el entorno del wrapper de arranque.

    {
      "hooks": {
        "SessionStart":     [{ "hooks": [{ "type": "command", "command": "mnonm-hook" }] }],
        "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "mnonm-hook" }] }],
        "PreToolUse":       [{ "matcher": "*", "hooks": [{ "type": "command", "command": "mnonm-hook" }] }],
        "PostToolUse":      [{ "matcher": "*", "hooks": [{ "type": "command", "command": "mnonm-hook" }] }],
        "Notification":     [{ "hooks": [{ "type": "command", "command": "mnonm-hook" }] }],
        "PreCompact":       [{ "hooks": [{ "type": "command", "command": "mnonm-hook" }] }],
        "Stop":             [{ "hooks": [{ "type": "command", "command": "mnonm-hook" }] }],
        "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "mnonm-hook" }] }]
      }
    }

> Verificar contra https://docs.claude.com/en/docs/claude-code/hooks el esquema vigente
> de cada evento y el nombre de campos (`tool_name`, `tool_input.todos`, `transcript_path`).
> `StopFailure` puede no existir como evento separado según versión — en ese caso el error
> llega como `Stop` con un campo de fallo; ajustar `hooks-logic.js` si difiere.
