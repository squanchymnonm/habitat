# Spec — Renovación del README, capturas y discoverability de Hábitat

**Fecha:** 2026-06-30
**Estado:** aprobado para planificar

## Objetivo

Poner al día la documentación pública del repositorio y hacerlo más
encontrable:

1. Que el **README en inglés sea el default** (lo que muestra GitHub).
2. Reescribir el README para reflejar **todas las funcionalidades** construidas
   desde la última edición (la doc quedó muy atrás).
3. Agregar **capturas de pantalla** reales (capturadas por el agente) y
   anonimizadas, embebidas en el README.
4. Mejorar la **discoverability**: descripción del repo en inglés, topics,
   y **renombrar el repo a `habitat`**.

## Decisiones tomadas (brainstorming)

- Capturas: **capturar real → anonimizar** (tapar/borrar nombres sensibles como
  "Artisano", rutas, contenido privado de terminales) antes de publicar.
- Imágenes guardadas en **`.github/`**.
- **Renombrar el repo** de `RPG-Agents` a `habitat` (GitHub deja redirect
  automático; aun así se actualizan todas las referencias en la doc).
- Idioma: `README.md` pasa a ser inglés; el español va a `README.es.md`.

## Alcance

### 1. Rotación de idioma

- `README.md` (actual ES) → `README.es.md`.
- `README.en.md` (actual EN) → `README.md` (default en inglés).
- Actualizar los cross-links de idioma (🇬🇧 / 🇪🇸) y el comentario `<!-- ... -->`
  de cabecera en ambos archivos.
- Bug a corregir en ambos: la URL de clone dice `github.com/squanchyhabitat/...`;
  debe ser `github.com/squanchymnonm/habitat.git` (nuevo nombre).

### 2. Contenido nuevo en el README

Reescribir manteniendo el tono (casual EN / rioplatense ES) y la estructura,
incorporando las features no documentadas:

- **Vista de cambios git por sesión** — status/diff, stage/unstage/discard,
  commit/push/pull/merge-default/abort desde el panel. Flag
  `HABITAT_ALLOW_GIT_WRITE` para las acciones de escritura.
- **Explorador + editor de proyecto** — árbol de archivos (`/tree`), preview de
  archivo (`/file`), y editor embebido (sesión tmux con nvim, `/editor/open`).
- **Maná + ciclo día/noche** — uso de Claude (rate limit de 5h) representado
  como maná; el fondo cambia con la ventana de uso.
- **Quest Book** — bitácora de quests / diálogo.
- **Acceso desde tablet/celular** — Tailscale Serve (HTTPS en el tailnet) +
  **login usuario/contraseña** con cookie de sesión persistida; UX táctil
  (modo selección, copy/paste con fallback en contexto inseguro, layouts
  tablet/portrait, alertas de pestaña).
- **StatusLine** — stamina real desde el statusline de Claude Code.
- **Worktrees / multi-agente** — varias ramas del mismo repo en paralelo, cada
  una en su worktree + sesión tmux.
- **Rediseño visual "Forja cálida"** — Tailwind v4, fuentes self-hosted, UI
  premium (mención breve, no técnica).
- **Settings** — gestor de proyectos desde la UI (colores por proyecto,
  allowlist de personajes).
- **Tabla de variables de entorno completa**, agregando al menos:
  `HABITAT_USER`, `HABITAT_PASSWORD_HASH`, `HABITAT_SESSION_TTL_MS`,
  `HABITAT_COOKIE_SECURE`, `HABITAT_SESSIONS`, `HABITAT_ALLOW_GIT_WRITE`,
  `HABITAT_PROJECTS_ROOT`, `HABITAT_WORKTREES_DIR`, `HABITAT_TMUX_SOCKET`,
  `HABITAT_URL`, `HABITAT_URL_STATUS`, `HABITAT_STATUSLINE_DELEGATE`.
- Actualizar el conteo de tests si cambió y la sección "Cómo está hecho".

Fuente de verdad para los detalles: specs en `docs/superpowers/specs/` y el
código en `habitat/server` / `habitat/client`. No inventar flags ni endpoints;
verificar contra el código antes de documentar.

### 3. Capturas de pantalla

- Capturar con Playwright sobre el server que ya corre en `127.0.0.1:8377`
  (requiere el `?token=` del server en ejecución — **dependencia: el usuario lo
  provee** en el momento de capturar; no se imprime el token en logs).
- Vistas objetivo (~5-6):
  1. Grilla principal (imagen héroe) — pods, día/noche, HUD de maná.
  2. Detail panel — preview de terminal + medallón + loot.
  3. Vista de cambios git — diff + acciones.
  4. Explorador + editor de proyecto.
  5. Quest Book.
  6. (opcional) Login "portada de la forja" o vista tablet.
- **Anonimización obligatoria** antes de publicar: ocultar nombres de proyectos
  reales (p. ej. "Artisano"), rutas absolutas y contenido sensible de
  terminales. Método: inyectar CSS/override vía Playwright antes del screenshot,
  o post-editar el PNG. Revisar cada imagen a ojo antes de commitear.
- Guardar en `.github/` con nombres descriptivos (p. ej.
  `.github/screenshot-grid.png`). Embeber en `README.md` y `README.es.md` con
  rutas relativas.

### 4. Discoverability

- **Renombrar el repo** a `habitat`: `gh repo rename habitat`. Actualizar el
  remoto local (`git remote set-url`) y todas las referencias en la doc
  (`RPG-Agents` → `habitat`; ojo con el path resultante `habitat/habitat/...`
  por el subdir, y el PATH `$HOME/habitat/habitat/hook`).
- **Descripción del repo en inglés** (reemplaza la actual en español). Borrador:
  *"🏰 A pixel-art RPG dashboard for your Claude Code sessions — live
  multi-session monitor with terminal preview, git workflow and editor, fed by
  Claude Code hooks (Node + Vue)."*
- **Topics**: mantener los actuales (`anthropic`, `claude`, `claude-code`,
  `developer-tools`, `monitoring`, `nodejs`, `pixel-art`, `rpg`, `tmux`, `vue`)
  y agregar los buscables que falten: `claude-code-hooks`, `observability`,
  `dashboard`, `ai-agents`, `agent-monitoring`, `terminal`, `websocket`,
  `self-hosted`. (Límite de GitHub: 20 topics.)
- **Keywords en el primer párrafo** del README (lo que indexan GitHub/Google):
  asegurar presencia natural de "Claude Code dashboard / monitor /
  observability / multi-agent".
- About → homepage: dejar vacío (no hay sitio) salvo indicación contraria.

## Fuera de alcance

- Reestructurar el layout de directorios del repo.
- Cambiar código de la app (sólo doc + assets + metadata del repo).
- Crear un sitio/landing.

## Criterios de aceptación

- `README.md` está en inglés y es lo que GitHub muestra por defecto; `README.es.md`
  tiene el español; los cross-links de idioma funcionan en ambos sentidos.
- Las URLs de clone y los paths apuntan a `habitat` (sin `squanchyhabitat` ni
  `RPG-Agents` obsoletos).
- El README documenta las features de la lista de la sección 2, con flags y
  endpoints verificados contra el código.
- Hay capturas anonimizadas en `.github/`, embebidas y visibles en el README.
- El repo en GitHub se llama `habitat`, con descripción en inglés y los topics
  ampliados.
- Trabajo integrado vía PR contra `main` siguiendo el flujo de `CLAUDE.md`.
