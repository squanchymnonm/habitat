<!-- English: README.md -->

# 🏰 Hábitat — un RPG pixel-art para tus sesiones de Claude Code

> Convertí tu terminal en una mazmorra. Cada sesión de [Claude Code](https://claude.com/claude-code) es un personaje en una grilla; cada TODO en curso es un monstruo; los tokens que gasta son el daño que le hace. Mirás todas tus sesiones pelear en tiempo real desde una sola pantalla.

**Hábitat** es un monitor en vivo de sesiones de Claude Code con estética RPG 16-bit (tema medieval, sprites del pack *Ninja Adventure*). No es un juguete cosmético: cada número que ves es telemetría real de la sesión, capturada por los *hooks* de Claude Code.

- 🧙 **Una grilla de personajes** — una sesión = un pod con su personaje, proyecto y rama git.
- ⚔️ **Batalla en vivo** — el TODO en curso es el monstruo; el daño flotante son los tokens del paso; la *stamina* es cuánto context te queda.
- 🎁 **Loot** — al completar un TODO cae el monstruo y dropea los archivos que tocaste.
- 👁️ **Preview real** — clic en un pod y ves la terminal (tmux) de esa sesión en vivo.
- 💬 **Chat** — escribile a una sesión desde el panel (va por `tmux send-keys`).
- ➕ **Crear sesiones** — lanzá una nueva sesión de Claude Code en un proyecto, desde el header.

> 🇬🇧 Prefer English? See the [English README](README.md).

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
Estás en el repo RPG-Agents (Hábitat): un monitor pixel-art de sesiones de Claude Code.
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
Tu PC (browser)  ──túnel SSH / VPN──▶  Servidor
                                         ├─ habitat server   HTTP + WebSocket  (127.0.0.1:8377)
                                         ├─ sesiones tmux con `claude`
                                         └─ hook habitat-hook   ──POST /hooks──▶ server
```

- **`habitat/server/`** — Node (ESM, sin TypeScript), única dependencia `ws`. HTTP sirve el front + `/hooks` + `/preview` + `/projects` + `/spawn`; WebSocket empuja el estado. Tests con `node --test` (**36/36**). Estado RPG derivado de los hooks (TodoWrite → monstruo/quest; tokens del transcript → daño/stamina).
- **`habitat/client/`** — Vue 3 + TypeScript + Vite. Buildea a `habitat/web/` (lo sirve el server).
- **`habitat/hook/habitat-hook`** — reenvía los eventos de Claude Code al server.
- **Seguridad (Ley 1):** Bearer token + bind a loopback en todos los endpoints; crear sesiones exige además flag `HABITAT_ALLOW_SPAWN` + whitelist `HABITAT_PROJECTS`. Comandos tmux vía `execFile` (sin shell). Nunca exponer a internet sin VPN.

Specs y planes de diseño en `docs/superpowers/`.

## ⚙️ Variables de entorno

| Variable | Default | Para qué |
|---|---|---|
| `HABITAT_TOKEN` | `''` | Bearer token de hooks/WS/GUI. **Ponelo siempre.** |
| `HABITAT_PORT` | `8377` | Puerto HTTP. |
| `HABITAT_BIND` | `127.0.0.1` | Interfaz. No la cambies sin VPN. |
| `HABITAT_ALLOW_SPAWN` | `0` | `1` habilita crear sesiones desde el panel. |
| `HABITAT_PROJECTS` | `''` | Whitelist de rutas absolutas (separadas por `:`) donde se pueden crear sesiones. |

## 📄 Licencia

MIT — ver [LICENSE](LICENSE).

## 🙏 Créditos

- Sprites: **Ninja Adventure Asset Pack** (Pixel-Boy / AAA) — CC0.
- Construido con [Claude Code](https://claude.com/claude-code).
