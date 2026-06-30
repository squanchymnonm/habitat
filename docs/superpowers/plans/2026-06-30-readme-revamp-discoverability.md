# README Revamp + Discoverability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the English README the default, document every new feature, embed anonymized screenshots, and make the repo more discoverable (rename to `habitat`, English description, expanded topics).

**Architecture:** This is a documentation + assets + repo-metadata change. No app code changes. Ground truth for flags/endpoints is the code under `habitat/server` and the specs under `docs/superpowers/specs/`. Screenshots are captured with Playwright against the live server (login: user `mnonm`), then anonymized before commit.

**Tech Stack:** Markdown, Playwright (browser MCP) for capture, `gh` CLI for GitHub metadata, git.

## Global Constraints

- Default README (`README.md`) MUST be English; Spanish lives in `README.es.md`.
- Never expose or print `HABITAT_TOKEN` or the login password in logs/output.
- Do NOT invent flags or endpoints — verify each against `habitat/server` before documenting.
- Clone URL and all paths use the new repo name `habitat` (not `RPG-Agents`, not `squanchyhabitat`). Note the resulting subdir path is `habitat/habitat/...`.
- Images live in `.github/`, embedded with relative paths, anonymized (no real project names like "Artisano", no absolute paths, no private terminal content).
- Tone preserved: casual English / rioplatense Spanish.
- Integrate via PR against `main` per `CLAUDE.md` git flow.
- Ground-truth env vars (full set): `HABITAT_TOKEN`, `HABITAT_PORT`, `HABITAT_BIND`, `HABITAT_URL`, `HABITAT_ALLOW_SPAWN`, `HABITAT_PROJECTS`, `HABITAT_PROJECTS_ROOT`, `HABITAT_PROJECTS_STATE`, `HABITAT_WORKTREES_DIR`, `HABITAT_TMUX_SOCKET`, `HABITAT_ALLOW_GIT_WRITE`, `HABITAT_USER`, `HABITAT_PASSWORD_HASH`, `HABITAT_SESSION_TTL_MS`, `HABITAT_COOKIE_SECURE`, `HABITAT_SESSIONS`, `HABITAT_SETTINGS`, `HABITAT_STATE`, `HABITAT_EDITOR`, `HABITAT_FILE_MAX_BYTES`, `HABITAT_PREVIEW_LINES`, `HABITAT_UPLOAD_MAX_BYTES`, `HABITAT_UPLOAD_PASSWORD`, `HABITAT_URL_STATUS`, `HABITAT_STATUSLINE_DELEGATE`.
- Ground-truth HTTP routes: `/hooks`, `/preview`, `/projects`, `/projects/browse`, `/spawn`, `/status`, `/tree`, `/file`, `/files`, `/files/upload`, `/editor/open`, `/git/status`, `/git/diff`, `/git/action`, `/term`, `/ws`.

---

### Task 1: Rotate README language files

**Files:**
- Rename: `README.md` → `README.es.md` (current Spanish)
- Rename: `README.en.md` → `README.md` (current English becomes default)
- Modify: both files' language cross-link + header comment

**Interfaces:**
- Produces: `README.md` (English, default) and `README.es.md` (Spanish), each linking to the other.

- [ ] **Step 1: Move files with git so history follows**

```bash
cd /home/mnonm/habitat-worktrees/RPG-Agents/ciri
git mv README.md README.es.md
git mv README.en.md README.md
```

- [ ] **Step 2: Fix the header comment + language link in `README.md` (English)**

Top comment should point to the Spanish file:
```markdown
<!-- Español: README.es.md -->
```
And the language line:
```markdown
> 🇪🇸 ¿Preferís español? Mirá el [README en español](README.es.md).
```

- [ ] **Step 3: Fix the header comment + language link in `README.es.md` (Spanish)**

Top comment:
```markdown
<!-- English: README.md -->
```
Language line:
```markdown
> 🇬🇧 Prefer English? See the [English README](README.md).
```

- [ ] **Step 4: Fix the clone-URL bug in BOTH files**

Replace `https://github.com/squanchyhabitat/RPG-Agents.git` with `https://github.com/squanchymnonm/habitat.git` and `cd RPG-Agents/habitat` with `cd habitat/habitat`.

Verify no stale refs remain:
```bash
grep -rn "squanchyhabitat\|RPG-Agents.git\|cd RPG-Agents" README.md README.es.md
```
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add README.md README.es.md
git commit -m "docs(habitat): English README as default + fix clone URL/paths"
```

---

### Task 2: Rewrite the English README with all new features

**Files:**
- Modify: `README.md`
- Read for ground truth: `habitat/server/*.js`, `habitat/README.md`, `docs/superpowers/specs/2026-06-2*.md`

**Interfaces:**
- Consumes: file structure from Task 1.
- Produces: the canonical feature list + env table reused (translated) in Task 3.

- [ ] **Step 1: Expand the feature bullet list** near the top to include, each one line, only verified features:
  - Git changes view per session (status/diff, stage/commit/push/pull/merge) — gated by `HABITAT_ALLOW_GIT_WRITE`.
  - Project explorer + embedded editor (file tree `/tree`, file preview `/file`, nvim-in-tmux via `/editor/open`).
  - Mana + day/night cycle (Claude 5h usage as mana; background shifts with the usage window).
  - Quest Book (quest log / dialogue).
  - Tablet/phone access: Tailscale Serve + username/password login; touch UX (selection, copy/paste, tablet layouts, tab alerts).
  - Real stamina from the Claude statusline.
  - Worktrees / multi-agent (parallel branches of one repo).
  - "Warm Forge" visual redesign (brief, non-technical mention).

- [ ] **Step 2: Update the "How it's built" section** — keep the ASCII diagram, update the endpoint list to the real routes (`/hooks /preview /projects /spawn /status /tree /file /files /editor/open /git/* /term /ws`), and update the test count by running:

```bash
cd /home/mnonm/habitat-worktrees/RPG-Agents/ciri/habitat/server && node --test 2>&1 | tail -3
```
Use the reported pass count (only if it runs cleanly; otherwise keep a generic "tests with `node --test`" without a number).

- [ ] **Step 3: Add a "Remote access from tablet/phone" section** summarizing Tailscale Serve + login (cookie session), sourced from `habitat/README.md` lines on Tailscale/login. Keep it short; link to `habitat/README.md` for the full systemd/Tailscale detail.

- [ ] **Step 4: Replace the env-var table** with the full set from Global Constraints, each with a one-line purpose verified against the code. Group logically (core / spawn+projects / git / auth+login / editor+files / statusline).

- [ ] **Step 5: Ensure discoverability keywords** appear naturally in the first paragraph: "Claude Code dashboard", "monitor", "observability", "multi-agent".

- [ ] **Step 6: Verify no stale references and that it renders**

```bash
grep -rn "squanchyhabitat\|RPG-Agents" README.md   # expect none except maybe historical prose; fix clone/path refs
```
Eyeball the markdown structure (headings balanced, code fences closed).

- [ ] **Step 7: Commit**

```bash
git add README.md && git commit -m "docs(habitat): document git view, editor, mana, login, worktrees in README"
```

---

### Task 3: Mirror the rewrite into the Spanish README

**Files:**
- Modify: `README.es.md`

**Interfaces:**
- Consumes: the English content from Task 2.
- Produces: feature-parity Spanish README.

- [ ] **Step 1:** Port every section added/changed in Task 2 into `README.es.md`, translated to rioplatense Spanish, keeping the same structure, the same env table, and the same routes. Keep `habitat/habitat` paths and the corrected clone URL.

- [ ] **Step 2: Verify parity** — both files have the same set of `##` headings:

```bash
diff <(grep -E '^#{1,3} ' README.md) <(grep -E '^#{1,3} ' README.es.md) || echo "review heading differences (language text differs, structure should match)"
```

- [ ] **Step 3: Commit**

```bash
git add README.es.md && git commit -m "docs(habitat): sync Spanish README with new features"
```

---

### Task 4: Capture and anonymize screenshots

**Files:**
- Create: `.github/screenshot-grid.png`, `.github/screenshot-detail.png`, `.github/screenshot-git.png`, `.github/screenshot-editor.png`, `.github/screenshot-questbook.png` (+ optional `.github/screenshot-login.png` or `.github/screenshot-tablet.png`)

**Interfaces:**
- Consumes: live server at `http://127.0.0.1:8377`, login user `mnonm` (password provided by user at runtime — never log it).
- Produces: anonymized PNGs in `.github/`.

- [ ] **Step 1: Log in via Playwright.** Navigate to `http://127.0.0.1:8377/`, fill the login form (user `mnonm`, password from the user), submit. Confirm the grid renders.

- [ ] **Step 2: Anonymize before each shot.** Use `browser_evaluate` to override sensitive text in the DOM (replace real project names like "Artisano" with a neutral label e.g. "demo-app", blank absolute paths) and/or blur terminal text panels via injected CSS, OR post-edit the PNG. Do this per view right before capturing.

- [ ] **Step 3: Capture each target view** with `browser_take_screenshot`, saving to the `.github/` paths above:
  1. Main grid (hero).
  2. Detail panel (terminal preview + medallion + loot).
  3. Git changes view (open a session's changes panel).
  4. Project explorer + editor.
  5. Quest Book.
  6. (optional) Login screen or tablet layout (resize viewport with `browser_resize` for tablet).

- [ ] **Step 4: Manually verify anonymization.** Read each PNG back (Read tool on the image) and confirm no real project names, absolute paths, or private content are legible. Re-capture any that leak.

- [ ] **Step 5: Commit**

```bash
git add .github/*.png && git commit -m "docs(habitat): add anonymized screenshots"
```

---

### Task 5: Embed screenshots in both READMEs

**Files:**
- Modify: `README.md`, `README.es.md`

**Interfaces:**
- Consumes: PNGs from Task 4.

- [ ] **Step 1:** Add the hero screenshot right under the intro blockquote in both files:

```markdown
![Hábitat — live grid of Claude Code sessions](.github/screenshot-grid.png)
```

- [ ] **Step 2:** Add the remaining screenshots near the features they illustrate (git view by the git bullet, editor by the explorer bullet, etc.), with descriptive alt text in the respective language.

- [ ] **Step 3: Verify image paths resolve**

```bash
cd /home/mnonm/habitat-worktrees/RPG-Agents/ciri
for f in $(grep -ohE '\.github/[a-z-]+\.png' README.md | sort -u); do test -f "$f" && echo "OK $f" || echo "MISSING $f"; done
```
Expected: all `OK`.

- [ ] **Step 4: Commit**

```bash
git add README.md README.es.md && git commit -m "docs(habitat): embed screenshots in READMEs"
```

---

### Task 6: GitHub metadata — rename, description, topics

**Files:** none (GitHub + local git remote)

**Interfaces:**
- Consumes: `gh` CLI authenticated as the repo owner.

- [ ] **Step 1: Rename the repo** (GitHub keeps a redirect from the old name):

```bash
gh repo rename habitat --repo squanchymnonm/RPG-Agents --yes
```

- [ ] **Step 2: Update the local remote URL**

```bash
cd /home/mnonm/habitat-worktrees/RPG-Agents/ciri
git remote set-url origin https://github.com/squanchymnonm/habitat.git
git remote -v   # confirm habitat.git
```

- [ ] **Step 3: Set the English description**

```bash
gh repo edit squanchymnonm/habitat --description "🏰 A pixel-art RPG dashboard for your Claude Code sessions — live multi-session monitor with terminal preview, git workflow and editor, fed by Claude Code hooks (Node + Vue)."
```

- [ ] **Step 4: Set the expanded topics** (existing + new, ≤20)

```bash
gh repo edit squanchymnonm/habitat \
  --add-topic claude-code-hooks --add-topic observability --add-topic dashboard \
  --add-topic ai-agents --add-topic agent-monitoring --add-topic terminal \
  --add-topic websocket --add-topic self-hosted
```

- [ ] **Step 5: Verify**

```bash
gh repo view squanchymnonm/habitat --json name,description,repositoryTopics
```
Expected: name `habitat`, English description, topics include the new ones.

---

### Task 7: Sync with main and open the PR

**Files:** none (git)

- [ ] **Step 1: Sync with main per CLAUDE.md**

```bash
cd /home/mnonm/habitat-worktrees/RPG-Agents/ciri
git fetch origin
git merge origin/main --no-edit
```
Resolve any conflicts (most likely none — docs-only).

- [ ] **Step 2: Push the branch**

```bash
git push origin ciri
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create --base main --head ciri \
  --title "docs(habitat): English-default README, new features, screenshots, discoverability" \
  --body "$(cat <<'EOF'
## Summary
- README.md is now English (default); Spanish moved to README.es.md
- Documented git view, project explorer+editor, mana/day-night, Quest Book, Tailscale+login, statusline, worktrees, full env-var table
- Added anonymized screenshots in .github/
- Fixed clone URL/paths to the renamed `habitat` repo

## Discoverability
- Repo renamed RPG-Agents → habitat
- English description + expanded topics

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Confirm the PR URL is printed.**

---

## Self-Review

**Spec coverage:**
- Language rotation → Task 1 ✓
- New-feature content (EN) → Task 2 ✓; (ES) → Task 3 ✓
- Screenshots capture+anonymize in `.github/` → Task 4; embed → Task 5 ✓
- Discoverability (rename, description, topics) → Task 6 ✓
- Clone-URL bug fix → Task 1 ✓
- PR per CLAUDE.md → Task 7 ✓

**Placeholder scan:** No TBDs; the only runtime-variable values (test count, password) are explicitly handled, not left blank.

**Type consistency:** File names (`README.md`, `README.es.md`, `.github/screenshot-*.png`) and repo name (`habitat`) used consistently across tasks.
