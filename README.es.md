<!-- English: README.md -->

# 🏰 Hábitat — un RPG pixel-art para tus sesiones de Claude Code

> Convertí tu terminal en una mazmorra. Cada sesión de [Claude Code](https://claude.com/claude-code) es un personaje en una grilla; cada TODO en curso es un monstruo; los tokens que gasta son el daño que le hace. Mirás todas tus sesiones pelear en tiempo real desde una sola pantalla.

**Hábitat** es un monitor en vivo de sesiones de Claude Code con estética RPG 16-bit (tema medieval, sprites del pack *Ninja Adventure*). No es un juguete cosmético: cada número que ves es telemetría real de la sesión, capturada por los *hooks* de Claude Code. También funciona como capa de **observabilidad** y **monitor** de todo tu flujo de Claude Code — incluyendo ramas **multi-agent** en paralelo — y te da un explorador de proyectos, un editor embebido y un panel de git, todo desde una sola pestaña del browser.

> 🇬🇧 Prefer English? See the [English README](README.md).

- 🧙 **Una grilla de personajes** — una sesión = un pod con su personaje, proyecto y rama git.
- ⚔️ **Batalla en vivo** — el TODO en curso es el monstruo; el daño flotante son los tokens del paso; la *stamina* es cuánto context te queda (datos reales del statusline de Claude).
- 🎁 **Loot** — al completar un TODO cae el monstruo y dropea los archivos que tocaste.
- 👁️ **Preview real** — clic en un pod y ves la terminal (tmux) de esa sesión en vivo.
- 💬 **Chat** — escribile a una sesión desde el panel (va por `tmux send-keys`).
- ➕ **Crear sesiones** — lanzá una nueva sesión de Claude Code en un proyecto, desde el header.
- 🌿 **Vista de cambios git** — ves status, diff, podés stagear/unstagear/descartar archivos, commitear, pushear, pullear y mergear, por sesión, desde el panel de detalle. Las acciones de escritura requieren `HABITAT_ALLOW_GIT_WRITE`.
- 📁 **Explorador de proyectos + editor embebido** — navegá el árbol de archivos de la sesión, previsualizá archivos y abrirlos en nvim (en una ventana tmux dedicada) desde el browser.
- 🌙 **Mana + ciclo día/noche** — la ventana de uso de 5 horas de Claude se representa como mana; el fondo cambia a medida que la ventana se llena y se reinicia.
- 📖 **Libro de Quests** — un log de quests y diálogos por sesión, construido desde el historial de TODOs.
- 📱 **Acceso desde tablet/celular** — Tailscale Serve (HTTPS dentro de tu tailnet) + login con usuario/contraseña y cookie de sesión persistente. UX táctil amigable.
- 🌲 **Worktrees / multi-agent** — cada sesión creada recibe su propio git worktree y sesión tmux, para que múltiples agentes trabajen el mismo repo en paralelo en ramas separadas.
- 🔥 **Warm Forge redesign** — un rediseño visual premium con fuentes self-hosted y Tailwind v4.
- ⚙️ **Settings** — gestioná proyectos desde la UI: colores por proyecto, allowlists de personajes. Se persiste entre reinicios.

---

## ⚡ Quickstart (en la máquina donde corre Claude Code)

**Requisitos:** Node 18+, npm, tmux, git y Claude Code instalado.

```bash
git clone https://github.com/squanchymnonm/habitat.git
cd habitat/habitat

npm install                                   # backend (solo depende de 'ws')
(cd client && npm install && npm run build)   # front Vue → genera habitat/web/

export HABITAT_TOKEN="$(openssl rand -hex 16)"  # token secreto; anotalo
echo "TU TOKEN: $HABITAT_TOKEN"

npm start                                     # → hábitat en http://127.0.0.1:8377
```

Abrí `http://127.0.0.1:8377/?token=TU_TOKEN` en el browser. El `?token=` es obligatorio (lo usa el WebSocket).

> ¿Querés que **Claude Code** haga todo esto por vos? Saltá a [🤖 Setup con Claude Code](#-setup-con-claude-code).

---

## 🪝 Conectar los hooks (para que aparezcan tus sesiones)

El panel se alimenta de los *hooks* de Claude Code. Agregá esto a `~/.claude/settings.json`:

```json
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
```

Y en tu shell (`~/.bashrc` / `~/.zshrc` del entorno donde abrís Claude Code):

```bash
export HABITAT_TOKEN="<el mismo token>"
export PATH="$PATH:$HOME/habitat/habitat/hook"   # para que 'habitat-hook' resuelva
```

> **Importante para preview/chat:** corré tus sesiones de Claude Code **dentro de tmux**, con el nombre de la sesión tmux = basename del directorio del proyecto (ej. `~/dev/mi-app` → `tmux new -s mi-app`). Así el panel matchea la sesión con su terminal. Las sesiones creadas con **"+ NUEVA SESIÓN"** ya lo hacen solas.

---

## 🌲 Stamina real desde el statusline de Claude

La stamina (el orbe de cada pod) refleja `100 − context_window.used_percentage` — el uso real del context window que Claude Code trackea por sesión. Para alimentarla, conectá el hook del statusline en `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash /path/to/habitat/habitat/hook/habitat-statusline"
  }
}
```

Exportá `HABITAT_TOKEN` en el mismo entorno. Usá `HABITAT_URL_STATUS` si el server no está en el `http://127.0.0.1:8377/status` por defecto. `HABITAT_STATUSLINE_DELEGATE` controla a qué renderer de statusline existente delega el wrapper (por defecto: `bash $HOME/.claude/statusline-command.sh`).

---

## 📱 Acceso remoto desde tablet o celular

El server bindea a loopback por diseño. Para acceder desde tablet/celular sin SSH, usá **Tailscale Serve** (HTTPS dentro de tu tailnet). La configuración tarda unos 5 minutos. Ver [`habitat/README.md`](habitat/README.md) para el setup completo de Tailscale + systemd (incluyendo el detalle crítico de `KillMode=process` que mantiene las sesiones vivas entre reinicios).

**Login con usuario/contraseña** (cookie de sesión, TTL de 1 día con renovación sliding):

```bash
export HABITAT_USER=tunombre
export HABITAT_PASSWORD_HASH="$(cd habitat && printf 'tucontraseña\n' | npm run --silent hash-password | sed 's/^HABITAT_PASSWORD_HASH=//')"
```

La cookie es `HttpOnly; Secure; SameSite=Strict`. `HABITAT_TOKEN` sigue funcionando como Bearer token (hooks, statusline) y como fallback de URL `?token=`.

---

## 💻 Usarlo desde otra PC (servidor → tu compu)

El server bindea a **loopback** a propósito: no se expone a internet. Para llegar desde tu PC, túnel SSH:

```bash
# en tu PC
ssh -N -L 8377:127.0.0.1:8377 usuario@tu-servidor
```

Dejá esa terminal abierta y abrí `http://127.0.0.1:8377/?token=TU_TOKEN` en tu browser local.

---

## 🤖 Setup con Claude Code

¿Tenés Claude Code? Cloná el repo, entrá a la carpeta, abrí `claude` y pegá este prompt. Va a entender el proyecto y dejártelo corriendo:

```
Estás en el repo habitat (Hábitat): un monitor pixel-art RPG y dashboard para sesiones de Claude Code.
Antes de tocar nada, leé README.md y habitat/README.md para entender la arquitectura
(server Node en habitat/server, front Vue en habitat/client, hook en habitat/hook).

Después, dejámelo corriendo en esta máquina, paso a paso y verificando cada uno:
1. Comprobá que estén node 18+, npm, tmux y git. Si falta algo, decímelo y frená.
2. Instalá dependencias: `cd habitat && npm install` y `cd habitat/client && npm install`.
3. Buildeá el front: `npm run build` en habitat/client (genera habitat/web/).
4. Generá un token con `openssl rand -hex 16`, mostrámelo y guardalo para los pasos siguientes.
5. Arrancá el server con ese HABITAT_TOKEN y confirmá que responde en http://127.0.0.1:8377.
6. Mostrame el bloque de hooks que tengo que poner en ~/.claude/settings.json y ofrecé
   agregarlo vos (sin pisar hooks que ya tenga). Recordame exportar HABITAT_TOKEN y poner
   habitat/hook en el PATH.
7. Explicame en 3 líneas cómo abrir la GUI (con ?token=) y cómo crear sesiones desde el panel
   si quiero habilitar HABITAT_ALLOW_SPAWN + HABITAT_PROJECTS.

No expongas el server fuera de loopback. Si algo falla, mostrame el error y pará.
```

---

## 🛠️ Cómo está hecho

```
Tu PC (browser)  ──túnel SSH / VPN / Tailscale──▶  Servidor
                                                      ├─ habitat server   HTTP + WebSocket  (127.0.0.1:8377)
                                                      ├─ sesiones tmux con `claude`
                                                      └─ hook habitat-hook   ──POST /hooks──▶ server
```

- **`habitat/server/`** — Node (ESM, sin TypeScript), única dependencia `ws`. HTTP sirve el front + endpoints de API; WebSocket empuja el estado. Tests con `node --test` (**229 passing**). Estado RPG derivado de los hooks (TodoWrite → monstruo/quest; tokens del transcript → daño/stamina; statusline → mana/ventana de uso).
- **`habitat/client/`** — Vue 3 + TypeScript + Vite. Buildea a `habitat/web/` (lo sirve el server).
- **`habitat/hook/habitat-hook`** — reenvía los eventos de Claude Code al server.
- **Seguridad (Ley 1):** Bearer token + bind a loopback en todos los endpoints; crear sesiones exige además el flag `HABITAT_ALLOW_SPAWN` + una lista de proyectos gestionada desde Settings. Las acciones git de escritura requieren `HABITAT_ALLOW_GIT_WRITE`. Comandos tmux vía `execFile` (sin shell). Nunca exponerlo a internet sin VPN o Tailscale.

Specs y planes de diseño en `docs/superpowers/`.

**Rutas HTTP:** `/hooks` `/preview` `/projects` `/projects/browse` `/spawn` `/status` `/tree` `/file` `/files` `/files/upload` `/editor/open` `/git/status` `/git/diff` `/git/action` `/questbook` `/settings` `/login` `/logout` `/auth/me` `/term` `/ws`

---

## ⚙️ Variables de entorno

### Core

| Variable | Default | Para qué |
|---|---|---|
| `HABITAT_TOKEN` | `''` | Bearer token de hooks/WS/GUI. **Ponelo siempre.** |
| `HABITAT_PORT` | `8377` | Puerto HTTP. |
| `HABITAT_BIND` | `127.0.0.1` | Interfaz. No la cambies sin VPN o Tailscale. |
| `HABITAT_URL` | `http://127.0.0.1:8377/hooks` | Override del endpoint de hooks (usado por `habitat-hook`). |
| `HABITAT_STATE` | `.state.json` | Ruta al archivo de estado de sesión persistido. |
| `HABITAT_SETTINGS` | `.settings.json` | Ruta al archivo de settings de UI persistido. |

### Spawn + proyectos

| Variable | Default | Para qué |
|---|---|---|
| `HABITAT_ALLOW_SPAWN` | `0` | `1` habilita crear sesiones y gestionar proyectos desde el panel. |
| `HABITAT_PROJECTS` | `''` | Rutas absolutas separadas por `:` para sembrar la lista de proyectos en el primer arranque (luego se gestiona desde la UI). |
| `HABITAT_PROJECTS_ROOT` | `''` | Directorio raíz para el browser de proyectos en Settings. Necesario para agregar proyectos desde la UI. |
| `HABITAT_PROJECTS_STATE` | `.projects.json` | Ruta al archivo de lista de proyectos persistido. |
| `HABITAT_WORKTREES_DIR` | `~/habitat-worktrees` | Directorio raíz donde se crean los git worktrees para las sesiones creadas. |
| `HABITAT_TMUX_SOCKET` | `habitat` | Nombre del socket tmux (`-L`). Aísla las sesiones de Hábitat de tu tmux personal. |

### Git

| Variable | Default | Para qué |
|---|---|---|
| `HABITAT_ALLOW_GIT_WRITE` | `0` | `1` habilita las acciones git de escritura (stage, unstage, discard, commit, push, pull, merge) desde el panel. |

### Auth + login

| Variable | Default | Para qué |
|---|---|---|
| `HABITAT_USER` | `''` | Usuario para el login con contraseña. El formulario de login solo se muestra cuando están seteados tanto `HABITAT_USER` como `HABITAT_PASSWORD_HASH`. |
| `HABITAT_PASSWORD_HASH` | `''` | Hash scrypt de la contraseña de login. Generalo con `npm run hash-password` en `habitat/`. |
| `HABITAT_SESSION_TTL_MS` | `86400000` | Vida de la cookie de sesión en ms (por defecto 1 día, con renovación sliding). |
| `HABITAT_COOKIE_SECURE` | `true` | Poné `false` solo para testing local en HTTP plano (Tailscale usa HTTPS, dejalo en `true`). |
| `HABITAT_SESSIONS` | `.sessions.json` | Ruta al archivo de sesiones de login persistido (sobrevive reinicios del server). |

### Editor + archivos

| Variable | Default | Para qué |
|---|---|---|
| `HABITAT_EDITOR` | `nvim` | Comando del editor que se lanza en la ventana tmux de edición al abrir archivos. |
| `HABITAT_FILE_MAX_BYTES` | `1048576` (1 MB) | Tamaño máximo de archivo para la preview inline via `/file`. |
| `HABITAT_PREVIEW_LINES` | `30` | Cantidad de líneas de terminal capturadas por `/preview`. |
| `HABITAT_UPLOAD_MAX_BYTES` | `26214400` (25 MB) | Tope de tamaño de upload por defecto via `/files/upload`. |
| `HABITAT_UPLOAD_PASSWORD` | `''` | Contraseña que saltea el tope de tamaño de upload (se envía en el header `X-Upload-Password`). |

### Statusline

| Variable | Default | Para qué |
|---|---|---|
| `HABITAT_URL_STATUS` | `http://127.0.0.1:8377/status` | Override del endpoint del statusline (usado por `habitat-statusline`). |
| `HABITAT_STATUSLINE_DELEGATE` | `bash $HOME/.claude/statusline-command.sh` | Renderer de statusline existente al que delegar después de postear los datos de uso. |

---

## 📄 Licencia

MIT — ver [LICENSE](LICENSE).

## 🙏 Créditos

- Sprites: **Ninja Adventure Asset Pack** (Pixel-Boy / AAA) — CC0.
- Construido con [Claude Code](https://claude.com/claude-code).
