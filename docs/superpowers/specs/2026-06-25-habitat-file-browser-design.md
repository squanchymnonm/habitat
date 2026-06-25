# File Browser + Upload en el pod

## Problema

No hay forma de mandarle archivos a Claude desde el habitat. En particular, **no
se pueden pegar imágenes a través de tmux**: la terminal (PTY sobre tmux) solo
transporta texto, así que pegar una imagen no funciona. El único camino hoy es
escribir a mano un path que ya exista en el filesystem del server — y para una
imagen que está en la Mac del usuario, ese path no existe del lado del server.

El cuello de botella real es **meter el archivo local (de la Mac) en el
filesystem del server** y después referenciarlo. Si el archivo está en el
working dir del pod, Claude lo lee con solo recibir su path (su tool Read lee
imágenes).

## Objetivo

Un **file browser por pod**, abrible desde el panel de detalle (overlay, como el
Quest Book), que permite:

1. **Navegar** los archivos del working dir del pod.
2. **Subir** un archivo desde la máquina del usuario al working dir del pod.
3. Al **elegir un archivo** (subido o existente), **escribir su path en la
   terminal** (como si se tipeara), para que el usuario complete su pregunta y
   se lo mande a Claude.

## Decisiones de diseño (acordadas en brainstorming)

- **Ámbito = working dir del pod.** El browser muestra el worktree del pod
  activo; los uploads caen ahí. Claude lo ve directo en su cwd y los paths
  quedan relativos y cortos.
- **Dirección = ambos:** subir desde la máquina local **y** navegar archivos ya
  existentes en el server.
- **Inserción = escribir en la terminal.** El path se escribe al PTY en la
  posición del cursor, **sin Enter**. El usuario sigue tipeando su pregunta y
  manda cuando quiere. Es lo más parecido a arrastrar un archivo.
- **Tipos de archivo:** cualquiera (imágenes, PDFs, logs, zips, etc.).
- **Límite de tamaño con escape por contraseña:** hay un cap por defecto
  (**25 MB**); se puede superar ingresando una contraseña definida en una **env
  var dedicada** (`HABITAT_UPLOAD_PASSWORD`).
- **UI = overlay como Quest Book:** botón `📁` en el header del panel abre un
  overlay sobre la terminal; cierra con `✕` y `Esc`. La terminal sigue viva
  atrás.
- **Uploads van a una subcarpeta `.habitat-uploads/`** dentro del working dir
  (no a la raíz): no ensucia el repo y es fácil de gitignorear.
- **Transporte del upload = body crudo** (los bytes del archivo en el body del
  request, nombre en header), sin multipart ni dependencias nuevas. El server es
  deliberadamente dependency-light (usa `http` nativo, no Express).

## Arquitectura

### Backend (`habitat/server`)

Todos los endpoints nuevos van detrás de `authorize()` (igual que el resto).

#### 0. Persistir `cwd` en la sesión

Hoy la sesión guarda `name`/`project`/`branch`/`tmux` pero **no** el `cwd`. Para
rootear el browser en el directorio exacto del pod:

- Agregar `cwd: ''` a `newSession` (`state.js`).
- Setear `s.cwd = payload.cwd` en el handler de `SessionStart` (`hooks-logic.js`),
  donde ya se dispone de `payload.cwd`.
- Es un campo público normal (sin prefijo `_`): viaja en el snapshot y se
  persiste como los demás.

El root del file browser de un pod es `s.cwd`. Si un pod no tiene `cwd` (sesión
vieja sin el campo, o evento sin cwd), los endpoints de archivos responden 409
(no disponible) y la UI muestra el estado vacío correspondiente.

#### 1. `GET /files?id=<pod>&path=<rel>` — listar directorio

Lista el contenido de `<root>/<rel>` donde `root = s.cwd`. Reusa el patrón de
seguridad de `/projects/browse`:

- `resolve(root, rel)` y guard sintáctico: el target no puede salir del root
  (`target === root || target.startsWith(root + sep)`).
- `realpath` del target y del root + guard contra symlinks que escapen del root.
- A diferencia de `/projects/browse` (que filtra solo directorios), acá se
  devuelven **archivos y carpetas**. Se siguen ocultando los dotfiles
  (`name.startsWith('.')`) **excepto** `.habitat-uploads/` (para poder ver lo
  subido).

Respuesta JSON: `{ root, rel, breadcrumbs, entries }`, con cada entry
`{ name, rel, isDir, size }`. (Mismo shape de breadcrumbs que `/projects/browse`.)

#### 2. `POST /files/upload?id=<pod>&path=<rel>` — subir archivo

- Nombre del archivo en header `X-Filename`, **sanitizado a `basename`** (se
  descartan separadores de path y `..`) para que no pueda escapar del destino.
- Bytes del archivo en el **body crudo** del request.
- Destino: `<root>/.habitat-uploads/<rel>/<nombre>` (se crea `.habitat-uploads/`
  si no existe). El `<rel>` permite subir a un subdir si el usuario navegó a uno;
  por defecto a la raíz de `.habitat-uploads/`. Mismos guards de path que en (1).
- **Cap de tamaño:** se aplica `HABITAT_UPLOAD_MAX_BYTES` (default 25 MB) salvo
  que venga un header `X-Upload-Password` que matchee `HABITAT_UPLOAD_PASSWORD`.
  El chequeo se hace por `Content-Length` y además se corta el stream si excede
  el límite (defensa real, no solo el header).
  - Si `HABITAT_UPLOAD_PASSWORD` está vacío en la config, **no hay escape**: el
    cap siempre aplica (no se puede destrabar con cualquier valor).
- Colisión de nombre: si ya existe, se sufija ` (1)`, ` (2)`, … antes de la
  extensión, para no pisar.
- Respuesta: `{ rel }` con el path relativo al working dir del archivo guardado
  (ej. `.habitat-uploads/logo.png`).

#### 3. Inserción del path → sin endpoint nuevo

La inserción reusa el **WS de terminal existente** (`/term`): el cliente escribe
el path como input al PTY (igual que tipear). No hace falta backend nuevo.

### Config nueva (`config.js`, env vars)

- `HABITAT_UPLOAD_PASSWORD` — `process.env.HABITAT_UPLOAD_PASSWORD || ''`.
  Destraba el cap. Vacío = sin escape.
- `HABITAT_UPLOAD_MAX_BYTES` — `num(process.env.HABITAT_UPLOAD_MAX_BYTES, 25*1024*1024)`.

### Frontend (`habitat/client`)

#### 4. Botón `📁` en el header del `DetailPanel`

Espeja el patrón del botón `📖` (`bookbtn`): toggle de un overlay. Estado local
`filesOpen`.

#### 5. `FileBrowser.vue` (espeja `QuestBook.vue`)

- Carga el listado con `GET /files?id=<pod>&path=<rel>` al abrir y al navegar.
- Breadcrumbs + click en carpeta para entrar; archivos clickeables.
- Botón **⬆ Subir** = `<input type="file">`. Al elegir archivo:
  - Sube vía `POST /files/upload` con el archivo en el body y `X-Filename`.
  - **Si el server responde 413** (sobre el cap), la UI pide la contraseña
    (prompt) y **reintenta** el mismo upload con el header `X-Upload-Password`.
    Así el cliente no necesita conocer el cap: el server es la única fuente de
    verdad y el reintento solo ocurre cuando hace falta.
  - Al terminar, refresca el listado y deja el archivo seleccionable.
- Al **clickear un archivo**, emite un evento `pick(rel)` que el `DetailPanel`
  traduce a "escribir en la terminal".

#### 6. `useTerminal` expone `insert(text)`

`useTerminal` ya tiene el `ws` del PTY y un `enc` (TextEncoder). Se agrega y
retorna una función `insert(text)` que hace `ws.send(enc.encode(text))` si el WS
está abierto. El `DetailPanel` la obtiene del composable y se la pasa al
`FileBrowser` (o maneja el evento `pick`). El path se inserta **entre comillas**
si contiene espacios.

## Manejo de errores

- **Pod sin `cwd`:** `GET /files` y `POST /files/upload` responden 409; la UI
  muestra "este pod no tiene un directorio asociado".
- **Path fuera del root / symlink que escapa:** 400 (igual que `/projects/browse`).
- **Directorio inexistente:** 404.
- **Upload sobre el cap sin contraseña válida:** 413 (Payload Too Large) con un
  mensaje claro; la UI ofrece reintentar pidiendo la contraseña.
- **WS de terminal cerrado al insertar:** `insert` es no-op silencioso (el botón
  queda sin efecto visible; no rompe nada).

## Seguridad

- Todo detrás de `authorize()`.
- Guards de path-traversal y symlink-escape reusados de `/projects/browse`.
- Root computado **server-side** desde la sesión (`s.cwd`); el cliente solo manda
  paths relativos.
- Nombre de archivo sanitizado a `basename` (sin `..` ni separadores).
- Cap de tamaño real (corte de stream), con escape solo vía contraseña dedicada.

## Testing

Estilo del repo: funciones puras testeadas con vitest (cliente) y `node:test`
(server).

- **Server (`node:test`):**
  - Sanitización de nombre de archivo (descarta `..`, separadores, deja basename).
  - Guard de root (rel que escapa → rechazado; rel válido → resuelto).
  - Decisión cap-vs-password: bajo cap → ok; sobre cap sin password → rechazo;
    sobre cap con password correcta → ok; password vacía en config → siempre cap.
  - Sufijo anti-colisión de nombres (`logo.png` → `logo (1).png`).
  - `GET /files` listado: se testea como los endpoints de `index.test.js`.
- **Cliente (vitest):**
  - Quoting del path al insertar (con/sin espacios).
  - Flujo de reintento: 413 → pedir password → reintento con `X-Upload-Password`.

## Fuera de alcance

- Navegar fuera del working dir del pod (PROJECTS_ROOT completo, carpeta
  compartida).
- Previsualización de imágenes dentro del browser.
- Drag & drop de archivos sobre la terminal (se puede sumar después; el backend
  de upload ya quedaría listo).
- Borrar/renombrar archivos desde el browser.
