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

## Acceso remoto desde tablet/celular (Tailscale Serve + login)

El panel sigue bindeado a loopback (`127.0.0.1:8377`). Para llegar desde una tablet
sin SSH ni exponer a internet, se publica vía **Tailscale Serve** (HTTPS dentro del tailnet):

1. Instalar la app de Tailscale en la tablet y unirla al tailnet (misma cuenta).
2. En el admin de Tailscale: habilitar **MagicDNS** y **HTTPS**.
3. En el server: `tailscale serve --bg --https=443 http://127.0.0.1:8377`
   (verificar con `tailscale serve status`).
4. Abrir en la tablet `https://<host>.<tailnet>.ts.net/`.

No hace falta tocar `HABITAT_BIND`: Serve proxea desde loopback. Como todas las conexiones
llegan a la app como loopback, la autorización de endpoints sensibles ya **no** se apoya en
la IP de origen, sino en la autenticación (abajo) + las ACLs de Tailscale.

### Login con usuario y contraseña

Por defecto el panel usa solo `HABITAT_TOKEN`. Para entrar desde el navegador con
usuario+contraseña (en vez de pegar el token en la URL), setear:

    export HABITAT_USER=nico
    export HABITAT_PASSWORD_HASH="$(cd habitat && printf 'TU_CLAVE\n' | npm run --silent hash-password | sed 's/^HABITAT_PASSWORD_HASH=//')"
    # o correr `npm run hash-password` interactivo y pegar la línea en el env del servicio

El login emite una **cookie de sesión** (`HttpOnly; Secure; SameSite=Strict`) de **1 día**
con renovación deslizante, persistida en `.sessions.json` (sobrevive reinicios). Variables:

- `HABITAT_USER`, `HABITAT_PASSWORD_HASH` — credenciales (login opt-in; si faltan, solo token).
- `HABITAT_SESSION_TTL_MS` — duración de sesión (default `86400000` = 1 día).
- `HABITAT_COOKIE_SECURE` — `false` solo para pruebas en http plano (default `true`).
- `HABITAT_SESSIONS` — ruta del archivo de sesiones (default `.sessions.json`).

`HABITAT_TOKEN` sigue válido como `Authorization: Bearer` (hooks, statusline) y `?token=`
sigue funcionando como fallback de navegador.

## Producción bajo systemd (IMPORTANTE: no matar las sesiones al reiniciar)

El server crea las sesiones con `tmux new-session -d`, así que el **daemon de tmux queda
como descendiente del proceso del server**. Si el server corre como servicio systemd con el
`KillMode` por defecto (`control-group`), al **parar/reiniciar el servicio systemd manda
SIGTERM a TODO el cgroup** — incluido el server tmux. Resultado: cada deploy o crash-restart
**desconecta todas las sesiones a la vez** (las terminales mueren y los `claude` reciben SIGHUP).

Para evitarlo, el unit DEBE usar `KillMode=process` (systemd señaliza sólo al proceso node;
el server tmux sobrevive al restart):

    [Service]
    KillMode=process        # <-- crítico: que el restart no se lleve puesto el tmux server
    Restart=on-failure
    ExecStart=/usr/bin/node server/index.js

Tras editar el unit: `systemctl --user daemon-reload && systemctl --user restart habitat`.

Complementos ya en el código que refuerzan esto:
- **Socket tmux dedicado** (`-L habitat`, configurable con `HABITAT_TMUX_SOCKET`): aísla las
  sesiones del panel del tmux personal del usuario. El server sólo lista/mata lo suyo.
- **El server no muere por un PTY roto**: las ops sobre el PTY van con `try/catch` y hay un
  `uncaughtException`/`unhandledRejection` global. Una terminal muerta ya no tumba el server
  (que, con el cgroup, equivalía a tumbar todas las sesiones).

## Si cerrás la terminal/SSH y se cae todo (linger)

`KillMode=process` (arriba) protege el tmux server de un **restart del servicio**
(deploy, crash-restart). No protege de esto otro, que es un problema distinto:

Si `habitat` corre bajo `systemctl --user` (como en producción) y **cerrás la
terminal/sesión SSH** desde la que quedó todo arrancado, systemd-logind da por
terminada tu sesión de login. Sin **linger** habilitado, en cuanto no queda
ninguna sesión activa tuya, logind **para el user-manager completo**
(`user@<uid>.service`) — y con él mueren TODOS los procesos que cuelgan de ese
manager: el servicio `habitat` y el **daemon de tmux** (con todas las sesiones
`claude` corriendo adentro), sean o no `detached`. Que una sesión de tmux esté
"detached" sólo significa que no tiene terminal controlador adjunta — no la
saca del cgroup de tu sesión de usuario, así que igual muere con ella.

**El fix es habilitar linger, no "más detach":**

    sudo loginctl enable-linger mnonm
    loginctl show-user mnonm -p Linger   # debe decir Linger=yes

Con linger, el user-manager de `mnonm` (y todo lo que cuelga de él) sigue vivo
aunque cierres todas las terminales/SSH. Sólo se cae con un reboot real de la
máquina o si vos mismo bajás el servicio.

### Checklist para diagnosticar un episodio de "se cerraron mis sesiones"

1. `systemctl --user status habitat` → mirar el "Active: ... since <hace
   cuánto>". Un uptime de pocos minutos sin que hayas corrido `habitat
   restart`/`up` vos mismo es la señal de que el user-manager se reinició
   (sesión de login cerrada sin linger, o reboot real).
2. `tmux -L habitat ls` (o `HABITAT_TMUX_SOCKET` si se cambió el default) → si
   tira error ("no server running on ...") o no lista las sesiones esperadas,
   el daemon de tmux murió — aunque `habitat` (el server node) esté `active`.
3. El panel de habitat va a seguir mostrando las branches "congeladas" en el
   último estado conocido (lee `.state.json` al arrancar), pero no vas a poder
   interactuar: no hay proceso vivo detrás hasta que se recreen las sesiones.

### Recuperar sesiones perdidas (worktree + transcript sobreviven siempre)

El daemon de tmux puede morir, pero el **git worktree** de cada rama y el
**transcript de Claude Code** (`~/.claude/projects/.../<session-id>.jsonl`) son
archivos en disco — sobreviven a cualquier caída de tmux o del server. Se puede
resumir la conversación exacta donde quedó:

1. Abrir `.state.json` (raíz de `HabitatProdu`, no confundir con
   `.sessions.json` que son tokens de login) y ubicar el pod por rama. Sacar:
   - `id` → session id de Claude Code
   - `project` + `branch` → arman el nombre tmux: `<project>-<branch con "/"
     reemplazado por "-">` (ver `worktree.js`)
   - `cwd` → el worktree en disco
2. Confirmar que sigue todo ahí:

       ls "$cwd"                                              # el worktree
       ls ~/.claude/projects/"$(echo "$cwd" | tr / -)"/        # debe listar <id>.jsonl

3. Recrear la sesión tmux con el mismo nombre, mismo directorio, y resumir por
   id (el `--permission-mode` debe matchear `.settings.json`, hoy
   `acceptEdits`):

       tmux -L habitat new-session -d -s "<project>-<branch>" -c "<cwd>"
       tmux -L habitat send-keys -t "<project>-<branch>" -l "claude --permission-mode acceptEdits --resume <id>"
       tmux -L habitat send-keys -t "<project>-<branch>" Enter

4. Verificar que resumió con contexto (no una sesión en blanco):

       tmux -L habitat capture-pane -p -t "<project>-<branch>" | tail -20

5. Refrescar el panel — reconecta solo apenas Claude dispare el próximo hook.

No uses `/spawn` (ni el botón "+ NUEVA SESIÓN") para esto: ese endpoint crea un
**worktree y una rama nuevos**, sirve para arrancar de cero, no para recuperar
una sesión existente.

> Nada de esto reemplaza habilitar linger — sin eso, el mismo corte vuelve la
> próxima vez que se cierre la terminal desde la que quedó arrancado.

## Desarrollo del front (HMR)
    cd habitat && HABITAT_TOKEN=<tu-token> npm start   # backend en :8377
    cd habitat/client && npm run dev                 # Vite en :5173, proxea /ws y /preview al backend
    # los sprites se generan con: bash habitat/scripts/import-assets.sh (a client/public/assets)

### Temas y capturas

La UI tiene temas intercambiables (Forja refinada, Pizarra pixel, Noche de taberna) definidos por
tokens en `client/src/theme/` (`themes.ts` + `tokens.css`; el test de contraste verifica AA y que
ambos coincidan). El tema se guarda por dispositivo (`localStorage: habitat.theme`).

Para revisar la UI en los 3 temas y 3 tamaños: levantá una instancia de dev y corré
`node scripts/screenshots.mjs --url "http://127.0.0.1:8399/?token=<token>" --out /tmp/shots`.

### Atajos

En el foco: `[` y `]` pasan a la sesión anterior/siguiente; `Esc` cierra el editor y
desfija el panel. No actúan mientras escribís en la terminal o en un campo.

## Crear sesiones desde el panel (opcional)

Deshabilitado por default. Para habilitarlo, exportar antes de `npm start`:

    export HABITAT_ALLOW_SPAWN=1
    export HABITAT_PROJECTS_ROOT="/home/tu/proyectos"   # raíz para navegar y agregar proyectos desde la UI
    export HABITAT_PROJECTS="/home/tu/proyecto-a:/home/tu/proyecto-b"   # opcional: siembra la lista la primera vez
    export HABITAT_CLONE_OWNERS="MNONM-SOFTWARE:squanchymnonm"   # opcional: owners de GitHub cuyos repos se pueden clonar

La lista de proyectos se gestiona desde **Settings → Proyectos**: el botón "Agregar proyecto"
navega las carpetas dentro de `HABITAT_PROJECTS_ROOT`, y al elegir una se asigna un **color**
(de una paleta fija) que diferencia los pods de ese proyecto. La lista se persiste en
`.projects.json`; `HABITAT_PROJECTS` solo la siembra la primera vez (después manda la UI).
Cada proyecto puede además fijar una **allowlist de personajes**: si está seteada, al crear una
sesión solo se ofrecen esos; si está vacía, están todos.

Con `HABITAT_CLONE_OWNERS` seteado aparece además **"Clonar repo"**: lista (vía `gh repo list`)
los repos de esos owners —usuarios u orgs, sin distinguir mayúsculas—, y al elegir uno lo clona
por https en `HABITAT_PROJECTS_ROOT/<nombre-del-repo>` y abre el alta precargada. El server
rechaza cualquier owner fuera de la lista. Requiere `gh` instalado y autenticado
(`gh auth login`) con acceso a esos repos; la whitelist solo se cambia en el entorno (reinicio).

Con eso, el header muestra "+ NUEVA SESIÓN": elegís un proyecto y el server crea una sesión
tmux con nombre = basename del directorio y lanza `claude` dentro. El pod aparece cuando Claude
dispara `SessionStart`. El nombre tmux = basename habilita el preview y el chat sobre esa sesión.

Con `HABITAT_ALLOW_SPAWN=1`, al elegir un proyecto se pide una **rama** y una **base** (default `main`).
Hábitat crea un git worktree en `HABITAT_WORKTREES_DIR` (default `~/habitat-worktrees/<proyecto>/<rama>`),
levanta una sesión tmux `<proyecto>-<rama>` y lanza `claude` dentro. Así varios agentes trabajan el mismo
repo en paralelo, cada uno en su rama. Los worktrees persisten: limpialos con `git worktree remove` cuando
termines.

> Crear sesiones spawnea procesos en tu máquina. El endpoint exige el mismo token, bind a
> loopback, el flag `HABITAT_ALLOW_SPAWN`, y que el directorio esté en la lista de proyectos
> gestionada desde Settings.

### Infra docker y repos relacionados por sesión

En **Settings → Proyectos → configurar** cada proyecto puede definir:

- **Repos relacionados**: otros repos de `HABITAT_PROJECTS_ROOT` (p.ej. el repo de infra,
  el front). Cada sesión recibe un worktree de cada uno, en su misma rama, dentro de
  `.habitat-related/<nombre>/`. Al cerrar la sesión se remueven sin forzar: uno con
  cambios sin commitear queda en disco (y entonces el worktree principal también, para no
  borrar ese trabajo anidado). La rama se borra sólo en los relacionados, y sólo si no
  tiene commits sin mergear; la del worktree principal no se toca.
- **Infra**: en qué repo y subcarpeta está el compose, y los comandos para levantarlo y
  bajarlo (default `docker compose up -d` / `docker compose down`).
- **Archivos `.env`**: plantillas que guarda Habitat (en `HABITAT_ENVS_DIR`, default
  `.habitat-envs/`, con permisos 0600) y que se escriben en cada sesión con estas
  variables: `{{stack}}` (nombre único del stack), `{{port:NOMBRE}}` (un puerto libre de
  `HABITAT_PORT_RANGE`, default `20000-29999`), `{{path:self}}` / `{{path:<relacionado>}}`
  y `{{branch}}`.

La sesión arranca con la infra apagada y un `CLAUDE.local.md` que le dice a Claude dónde
está, cómo levantarla y qué puertos tiene.

    export HABITAT_ENVS_DIR="/home/tu/.habitat-envs"   # opcional
    export HABITAT_PORT_RANGE="20000-29999"            # opcional

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
