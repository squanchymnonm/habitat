<!-- Español: README.md -->

# 🏰 Hábitat — a pixel-art RPG for your Claude Code sessions

> Turn your terminal into a dungeon. Each [Claude Code](https://claude.com/claude-code) session is a character on a grid; each in-progress TODO is a monster; the tokens it spends are the damage it deals. Watch all your sessions fight in real time from a single screen.

**Hábitat** is a live monitor for Claude Code sessions with 16-bit RPG flair (medieval theme, sprites from the *Ninja Adventure* pack). It's not cosmetic fluff: every number you see is real session telemetry, captured through Claude Code's *hooks*.

- 🧙 **A grid of characters** — one session = one pod with its character, project and git branch.
- ⚔️ **Live battle** — the in-progress TODO is the monster; floating damage is the step's tokens; *stamina* is how much context you have left.
- 🎁 **Loot** — completing a TODO kills the monster and drops the files you touched.
- 👁️ **Real preview** — click a pod to see that session's terminal (tmux) live.
- 💬 **Chat** — message a session from the panel (sent via `tmux send-keys`).
- ➕ **Spawn sessions** — launch a new Claude Code session in a project, right from the header.

> 🇪🇸 ¿Preferís español? Mirá el [README en español](README.md).

---

## ⚡ Quickstart (on the machine where Claude Code runs)

**Requirements:** Node 18+, npm, tmux, git, and Claude Code installed.

```bash
git clone https://github.com/squanchymnonm/RPG-Agents.git
cd RPG-Agents/habitat

npm install                                   # backend (only depends on 'ws')
(cd client && npm install && npm run build)   # Vue front → generates habitat/web/

export MNONM_TOKEN="$(openssl rand -hex 16)"  # secret token; write it down
echo "YOUR TOKEN: $MNONM_TOKEN"

npm start                                     # → hábitat on http://127.0.0.1:8377
```

Open `http://127.0.0.1:8377/?token=YOUR_TOKEN` in your browser. The `?token=` is required (the WebSocket uses it).

> Want **Claude Code** to do all this for you? Jump to [🤖 Setup with Claude Code](#-setup-with-claude-code).

---

## 🪝 Wire up the hooks (so your sessions show up)

The panel is fed by Claude Code's *hooks*. Add this to `~/.claude/settings.json`:

```json
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
```

And in your shell (`~/.bashrc` / `~/.zshrc` of the environment where you open Claude Code):

```bash
export MNONM_TOKEN="<the same token>"
export PATH="$PATH:$HOME/RPG-Agents/habitat/hook"   # so 'mnonm-hook' resolves
```

> **Important for preview/chat:** run your Claude Code sessions **inside tmux**, with the tmux session name = basename of the project directory (e.g. `~/dev/my-app` → `tmux new -s my-app`). That's how the panel matches a session to its terminal. Sessions created with **"+ NUEVA SESIÓN"** already do this automatically.

---

## 💻 Use it from another machine (server → your computer)

The server binds to **loopback** on purpose: it's never exposed to the internet. To reach it from your PC, use an SSH tunnel:

```bash
# on your PC
ssh -N -L 8377:127.0.0.1:8377 user@your-server
```

Keep that terminal open and open `http://127.0.0.1:8377/?token=YOUR_TOKEN` in your local browser.

---

## 🤖 Setup with Claude Code

Got Claude Code? Clone the repo, cd into it, run `claude` and paste this prompt. It will understand the project and leave it running:

```
You are in the RPG-Agents repo (Hábitat): a pixel-art monitor for Claude Code sessions.
Before touching anything, read README.md / README.en.md and habitat/README.md to understand
the architecture (Node server in habitat/server, Vue front in habitat/client, hook in habitat/hook).

Then get it running on this machine, step by step, verifying each one:
1. Check that node 18+, npm, tmux and git are present. If something is missing, tell me and stop.
2. Install dependencies: `cd habitat && npm install` and `cd habitat/client && npm install`.
3. Build the front: `npm run build` in habitat/client (generates habitat/web/).
4. Generate a token with `openssl rand -hex 16`, show it to me and keep it for the next steps.
5. Start the server with that MNONM_TOKEN and confirm it responds on http://127.0.0.1:8377.
6. Show me the hooks block I need to put in ~/.claude/settings.json and offer to add it
   yourself (without clobbering hooks I already have). Remind me to export MNONM_TOKEN and
   add habitat/hook to PATH.
7. Explain in 3 lines how to open the GUI (with ?token=) and how to spawn sessions from the
   panel if I want to enable MNONM_ALLOW_SPAWN + MNONM_PROJECTS.

Do not expose the server beyond loopback. If anything fails, show me the error and stop.
```

---

## 🛠️ How it's built

```
Your PC (browser)  ──SSH tunnel / VPN──▶  Server
                                           ├─ habitat server   HTTP + WebSocket  (127.0.0.1:8377)
                                           ├─ tmux sessions running `claude`
                                           └─ hook mnonm-hook   ──POST /hooks──▶ server
```

- **`habitat/server/`** — Node (ESM, no TypeScript), single dependency `ws`. HTTP serves the front + `/hooks` + `/preview` + `/projects` + `/spawn`; WebSocket pushes state. Tests with `node --test` (**36/36**). RPG state derived from hooks (TodoWrite → monster/quest; transcript tokens → damage/stamina).
- **`habitat/client/`** — Vue 3 + TypeScript + Vite. Builds to `habitat/web/` (served by the server).
- **`habitat/hook/mnonm-hook`** — forwards Claude Code events to the server.
- **Security (Law 1):** Bearer token + loopback bind on every endpoint; spawning sessions additionally requires the `MNONM_ALLOW_SPAWN` flag + `MNONM_PROJECTS` whitelist. tmux commands run via `execFile` (no shell). Never expose to the internet without a VPN.

Design specs and plans live in `docs/superpowers/`.

## ⚙️ Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MNONM_TOKEN` | `''` | Bearer token for hooks/WS/GUI. **Always set it.** |
| `MNONM_PORT` | `8377` | HTTP port. |
| `MNONM_BIND` | `127.0.0.1` | Interface. Don't change without a VPN. |
| `MNONM_ALLOW_SPAWN` | `0` | `1` enables spawning sessions from the panel. |
| `MNONM_PROJECTS` | `''` | Whitelist of absolute paths (colon-separated) where sessions may be spawned. |

## 📄 License

MIT — see [LICENSE](LICENSE).

## 🙏 Credits

- Sprites: **Ninja Adventure Asset Pack** (Pixel-Boy / AAA) — CC0.
- Built with [Claude Code](https://claude.com/claude-code).
