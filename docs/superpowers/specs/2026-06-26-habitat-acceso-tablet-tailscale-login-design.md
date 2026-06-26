# Acceso a Hábitat desde tablet: Tailscale Serve + login con sesión

**Fecha:** 2026-06-26
**Estado:** Diseño aprobado (pendiente plan de implementación)

## Problema

Hoy el acceso a Hábitat desde una tablet se hace por **SSH sobre VPN** (port-forward
contra el bind loopback). Eso es incómodo: hay que abrir un túnel SSH para llegar a la
web. El objetivo es **abrir Hábitat como una URL normal en el navegador**, desde
cualquier red, sin SSH.

Restricción de seguridad de fondo: **Hábitat controla sesiones de Claude Code**, que
ejecutan comandos arbitrarios en la máquina (y con `HABITAT_ALLOW_SPAWN=1` crean
sesiones/worktrees, y el file-browser permite subir archivos). Exponer el panel equivale
a exponer ejecución remota de código sobre la máquina de desarrollo. Por eso **no se
expone a internet**: el acceso queda dentro del tailnet privado.

Segundo dolor, surgido en el brainstorm: la autenticación actual es un **token en la
query string** (`?token=`). Hay que recordarlo/pegarlo al abrir Hábitat en un dispositivo
nuevo, y además queda en historial del navegador y en logs. Se reemplaza por **login con
usuario + contraseña** que emite una **sesión por cookie**.

## Estado actual del código (referencia)

- `server/config.js`: `BIND` (default `127.0.0.1`), `TOKEN` (`HABITAT_TOKEN`), `PORT` 8377.
- `server/index.js`:
  - `LOCAL = {127.0.0.1, ::1, ::ffff:127.0.0.1}`.
  - `authorize(req,res)`: exige `Authorization: Bearer == TOKEN` **y** `remoteAddress ∈ LOCAL`.
    Lo usan `/hooks`, spawn, gestión de proyectos y file-browser.
  - estáticos (`index.html`, JS): servidos **sin auth**.
- `server/ws.js` (`/ws`) y `server/term.js` (`/term`, PTY completo): validan token vía
  `?token=` **o** header `Authorization`. **No** chequean loopback.

## Arquitectura de la solución

Dos piezas independientes:

### Pieza 1 — Acceso de red: Tailscale Serve (ops, sin código)

```
Tablet (app Tailscale) ──HTTPS cifrado, dentro del tailnet──► tailscaled (server)
                                                                   │ proxy a loopback
                                                                   ▼
                                                   Hábitat 127.0.0.1:8377  (BIND sin cambios)
```

- Tailscale ya corre en el server (`mnonm-server` = `100.81.233.87`).
- La tablet instala la app de Tailscale (iPadOS/Android) y se une al tailnet con la misma cuenta.
- En el server: `tailscale serve --bg --https=443 http://127.0.0.1:8377`.
- Requisitos en admin de Tailscale: **MagicDNS** y **HTTPS** habilitados (cert válido + nombre).
- La tablet abre `https://mnonm-server.<tailnet>.ts.net/`.

**Consecuencias de diseño de Serve:**
1. **No se toca `BIND`**: el proceso sigue en `127.0.0.1:8377`; Serve hace de puente. Cero
   cambio en la superficie de exposición del proceso.
2. **El gate `LOCAL` deja de aislar**: Serve proxea desde loopback, así que el server ve
   todas las conexiones como `127.0.0.1`. La barrera real pasa a ser **ACLs de Tailscale +
   autenticación de la app** (ver Pieza 2). Endpoints antes protegidos por `LOCAL`
   (spawn, gestión, upload) pasan a ser alcanzables desde la tablet — comportamiento
   deseado, pero la seguridad ya no puede apoyarse en `LOCAL`.

### Pieza 2 — Autenticación: login con sesión por cookie (código)

**Por qué cookie y no "bearer en localStorage":** los navegadores no permiten setear
headers en el handshake WebSocket (por eso hoy el token va en la query). Las **cookies sí
viajan automáticamente en el upgrade WS**, así que una cookie de sesión autentica `/ws` y
`/term` sin token en la URL. Además, `HttpOnly` la hace inaccesible a JS (protege de XSS).

**Configuración nueva (`config.js`):**
- `HABITAT_USER` — nombre de usuario.
- `HABITAT_PASSWORD_HASH` — hash scrypt de la contraseña, formato `scrypt$N$salt$hash`
  (scrypt viene en `node:crypto`, sin dependencias nuevas).
- `HABITAT_SESSIONS_PATH` — persistencia de sesiones (default junto a `.state.json`).

**Endpoints nuevos:**
- `POST /login` — body `{user, password}`. Verifica `user === HABITAT_USER` y la
  contraseña contra el hash con `crypto.scrypt` + `timingSafeEqual`. Éxito →
  `Set-Cookie: habitat_session=<random 32B base64url>; HttpOnly; Secure; SameSite=Strict;
  Path=/; Max-Age=86400`. Falla → 401 (más anti-bruteforce, abajo).
- `POST /logout` — borra la sesión server-side y vence la cookie (`Max-Age=0`).
- `GET /auth/me` — 200 `{user}` si hay sesión válida; 401 si no. Lo usa el front al cargar
  para decidir si mostrar login o el panel.

**Session store (`server/sessions.js`, módulo nuevo):**
- Mapa `sessionId -> {user, createdAt, expiresAt}`.
- **Persistido a disco** (`.sessions.json`) para sobrevivir reinicios/deploys (crítico acá
  por `KillMode=process`: un deploy no debe desloguear).
- **Renovación deslizante**: cada request autenticado con expiración válida empuja
  `expiresAt = now + 1 día`. Re-login solo tras 1 día sin entrar.
- Vencimiento: 1 día de inactividad (`SESSION_TTL_MS = 86_400_000`).
- Limpieza perezosa de expiradas al validar/persistir.

**Cambios en la verificación de auth:**
- Helper único `authenticated(req)` que devuelve `true` si **cualquiera** de:
  1. cookie `habitat_session` válida (renueva la sesión), **o**
  2. `Authorization: Bearer == TOKEN` (programático/local: hooks, statusline), **o**
  3. `?token=` o header == `TOKEN` (**fallback** mantenido a pedido).
- `/ws` y `/term`: aceptan la **cookie** (leída de `req.headers.cookie` en el upgrade)
  además del token actual. Así el navegador ya no usa `?token=`, pero el fallback sigue.
- `authorize()` (spawn/gestión/hooks/upload): pasa a exigir `authenticated(req)`. Se
  **elimina la dependencia de `LOCAL`** como barrera (es inefectiva tras Serve); `/hooks`
  sigue protegido por el Bearer token, que es lo que ya usan los hooks locales.

**Anti-bruteforce (simple):**
- Contador de fallos por usuario en memoria. Tras `N=5` fallos: lockout temporal con
  backoff (ej. 1s, 2s, 4s… hasta un techo, o bloqueo de 60s tras 5). Se resetea al éxito.
- No persistido (tailnet-only; el riesgo es bajo y reiniciar limpia el estado).

**Cliente (Vue):**
- Al cargar, `GET /auth/me`. Si 401 → vista **Login** (usuario + contraseña).
- `POST /login`; en éxito, recarga estado y conecta `/ws` (la cookie ya viaja sola).
- La conexión WS deja de pasar `?token=`. Si `/ws` cierra con `1008 unauthorized` →
  volver a la vista de Login.
- Botón/acción de **logout** (`POST /logout` → vista Login).

**Compatibilidad hacia atrás:**
- `HABITAT_TOKEN` sigue válido como Bearer para hooks y statusline (sin tocar su config).
- `?token=` sigue funcionando como fallback de navegador.

## Backwards-compat y migración

- Si `HABITAT_USER`/`HABITAT_PASSWORD_HASH` **no están seteados**, el login se considera
  deshabilitado y el comportamiento es el actual (solo token). Así un deploy sin configurar
  credenciales no rompe nada; el login es opt-in.
- Script `npm run hash-password` (`server/scripts/hash-password.js`): pide la contraseña por
  stdin (sin eco) y emite la línea `HABITAT_PASSWORD_HASH=scrypt$...` para pegar en el env.

## Seguridad — modelo final por capas

1. **ACLs de Tailscale**: solo los dispositivos del tailnet (los tuyos) alcanzan el endpoint Serve.
2. **HTTPS de Tailscale**: TLS válido extremo a extremo dentro del tailnet; nada en texto plano.
3. **Login + cookie HttpOnly/Secure/SameSite=Strict**: credenciales que recordás, sesión de 1 día deslizante.
4. **Bearer `HABITAT_TOKEN`**: solo para acceso local/programático (hooks, statusline).
5. **Anti-bruteforce** en `/login`.
- **No** hay exposición a internet pública. La tablet entra por el tailnet, igual que cualquier otro dispositivo.

## Testing

- `sessions.test.js`: crear/validar/expirar/renovar sesión; persistencia y recarga; limpieza de expiradas.
- `index.test.js`: `/login` (éxito, password mala, user malo, lockout tras N fallos); `/auth/me`
  con y sin cookie; `/logout`; `authorize()` aceptando cookie y rechazando sin nada; fallback `?token=`.
- `ws.test.js` / `term.test.js`: upgrade autenticado por cookie; rechazo sin cookie ni token.
- Hash: scrypt + `timingSafeEqual` round-trip; rechazo de password incorrecta.
- Respetar el patrón de tests existente (`node --test`). Validar solo los módulos tocados
  (hay fallas pre-existentes en otros módulos por deps faltantes).

## Fuera de alcance (YAGNI)

- Multiusuario / roles. Un solo usuario.
- OAuth/SSO, 2FA.
- Tailscale Funnel (exposición pública) — explícitamente descartado.
- Rotación de tokens, refresh tokens, "recordar dispositivo" más allá de la cookie.
- Cambiar `BIND` o tocar el systemd unit (Serve no lo requiere).

## Pasos de puesta en marcha (runbook, post-implementación)

1. Tablet: instalar app Tailscale, loguear con la cuenta, confirmar que aparece en el tailnet.
2. Admin Tailscale: habilitar MagicDNS y HTTPS.
3. Server: `npm run hash-password` → setear `HABITAT_USER` y `HABITAT_PASSWORD_HASH` en el env del servicio.
4. Server: `tailscale serve --bg --https=443 http://127.0.0.1:8377`; verificar con `tailscale serve status`.
5. (Opcional) ACL de Tailscale para restringir qué dispositivos llegan al puerto.
6. Tablet: abrir `https://mnonm-server.<tailnet>.ts.net/`, loguear, verificar terminal y chat.
