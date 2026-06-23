# Animaciones de avatar por estado del agente

**Fecha:** 2026-06-22
**Estado:** implementado con pivot (ver nota abajo)

> **Actualización (pivot durante implementación):** el free tier de PixelLab
> resultó ser un tope duro de 40 generaciones y la calidad del lote AI salió
> despareja (fondos de escena opacos, identidad perdida en personajes simples;
> solo los muy distintivos como el Knight salieron bien). Decisión aprobada: se
> shippeó un **idle procedural** (bob de respiración generado por código desde el
> sprite estático — limpio y fiel para los 16) y **todos los estados** apuntan a
> ese idle por ahora. Las 4 animaciones de acción con IA (work/waiting/done/error)
> quedan **diferidas** hasta cargar crédito; el pipeline (`scripts/lib/imgproc.mjs`,
> `scripts/lib/pixellab.mjs` con `negative_description` anti-fondo, y
> `scripts/animate-chars.mjs`) queda listo y testeado para esa regeneración. El
> idle procedural se genera con `scripts/idle-bob.mjs`. La sección de abajo
> describe el diseño AI original; léela con esa salvedad.

## Objetivo

Hoy el avatar de cada sesión en el pod (`SessionPod.vue`) se renderiza **estático** (la pose sur, `idle.png` frame 0). Queremos que el avatar **se anime según el estado del agente** (idle, working, waiting, done, error), generando los frames con IA a partir del sprite estático que ya existe, sin dibujarlos a mano.

El pack *Ninja Adventure* ya trae `walk.png` (ciclo animado) e `idle.png` (poses estáticas por dirección), pero **no trae idle animado ni animaciones de estado**. Ese es el hueco que llenamos.

## Decisiones tomadas (brainstorm)

- **Herramienta:** PixelLab vía su **API REST** (`https://api.pixellab.ai/v1`), endpoint `POST /animate-with-text`. Se maneja desde un script; el agente (Claude) la ejecuta, no el usuario a mano.
- **Costo:** el **free tier cubre las llamadas API** (facturan en `generations`, no contra el saldo USD que está en $0). Validado: 1 animación de 4 frames = **1 generation**.
- **Resolución:** **32×32** por frame (más nitidez que 16×16; el pod los muestra al mismo tamaño visual con `image-rendering: pixelated`).
- **Orientación:** **solo south-facing** (el pod muestra la pose de frente, `frame 0`). No se generan las 4 direcciones → 4× más barato.
- **Set de animaciones:** **5** — `idle`, `work`, `done`, `waiting`, `error` → 5 × 16 personajes = **80 generations**.

## Set de animaciones y mapeo de estados

Cada animación es un **strip horizontal de 4 frames de 32×32 = 128×32 px**, south-facing, que `Sprite.vue` ya anima con `mode="strip"` (calcula `frames = ancho/alto = 128/32 = 4`).

| Archivo (`assets/char/<Char>/`) | Estados que lo usan | `action` prompt (PixelLab) |
|---|---|---|
| `anim_idle.png` | `idle`, `offline`* | "breathing idle, subtle up and down bob" |
| `anim_work.png` | `working` | "working, busy repetitive gesture, hammering" |
| `anim_waiting.png` | `waiting` | "waving one arm to get attention, impatient" |
| `anim_done.png` | `done` | "celebrating, raising arms, cheerful" |
| `anim_error.png` | `error` | "dizzy stumble, hurt flinch" |

\* `offline` reusa `anim_idle.png` pero atenuado por CSS (filtro gris); no se genera arte aparte.

En **combate** (cuando `session.monster` existe) el avatar **no cambia**: sigue el comportamiento actual (`frame 3`, pose de pelea). Las animaciones de estado solo aplican fuera de combate.

## Formato de salida y pipeline de generación

Script nuevo: `habitat/scripts/animate-chars.mjs` (Node, ESM, encaja con el stack del repo). Por cada personaje de `CHARACTERS` (en `client/src/sprites.ts`) y cada animación del set:

1. **Referencia:** leer `client/public/assets/char/<Char>/idle.png`, recortar el frame 0 (pose sur, 16×16), reescalar nearest a 64×64.
2. **Llamada:** `POST /animate-with-text` con:
   - `image_size: {width:64,height:64}` (fijo por la API),
   - `description`: descripción por personaje (mapa `CHAR_DESC` en el script),
   - `action`: el prompt de la tabla,
   - `view: "high top-down"`, `direction: "south"`,
   - `n_frames: 4`, `image_guidance_scale: ~3` (preservar identidad), `text_guidance_scale: ~7`,
   - `reference_image` y `color_image` = el sprite de referencia base64 (la paleta forzada mantiene los colores originales),
   - `seed` fijo por (personaje, animación) para reproducibilidad.
3. **Post-proceso (local, sin API):**
   - **Despeckle**: quitar píxeles opacos aislados (<3 vecinos opacos) → limpia el ruido de fondo que deja el modelo, dejándolo transparente. (Los endpoints de animación **no** tienen flag `no_background`; este pase lo resuelve.)
   - **Downscale** 64→32 con box-filter alpha-aware (mayoría transparente → transparente).
   - **Ensamblar** los 4 frames en un strip `128×32`.
4. **Escribir** `client/public/assets/char/<Char>/anim_<nombre>.png`.

**Idempotencia:** si el archivo destino ya existe, se saltea (permite reanudar si se corta por cuota o error). Token vía env `PIXELLAB_TOKEN`. Loguear `usage` acumulado.

Dependencia local: `pngjs` (JS puro, sin binarios nativos) para recorte/escala/ensamblado. Se añade a `habitat` o se instala en el script.

## Integración frontend

- **`client/src/sprites.ts`**: agregar
  - `STATUS_ANIM: Record<Status,string>` que mapea estado → nombre de archivo (`idle`→`anim_idle`, `working`→`anim_work`, `waiting`→`anim_waiting`, `done`→`anim_done`, `error`→`anim_error`, `offline`→`anim_idle`).
  - `heroAnim(name, char, status): string` → ruta del strip correspondiente.
- **`client/src/components/SessionPod.vue`**: cuando **no** hay monstruo, reemplazar el `<Sprite mode="static" :frame="0">` del héroe por `<Sprite mode="strip" :src="heroAnim(...)" :duration="...">`. Con monstruo, sin cambios. `offline` aplica una clase CSS que atenúa (escala de grises).
- Duración de animación: ~900ms (default de `Sprite.vue`); afinar por estado si hace falta (ej. `error` más corto).

## Riesgos y mitigaciones

- **Cuota del free tier desconocida:** PixelLab no expone endpoint de cuota. 80 generations podrían toparse con el límite. Mitigación: script idempotente (reanuda), generar por tandas, pausar y avisar si la API rechaza por cuota.
- **Identidad a 32px:** validado en el Knight (se reconoce). Personajes muy chicos/simples del pack podrían perder rasgos; si alguno sale mal, regenerar con otra `seed`/`image_guidance_scale` o descripción más específica.
- **Consistencia de escala:** los avatares generados llenan más el tile que los sprites del pack que conviven en combate. Aceptado para esta iteración (estados fuera de combate usan los generados; combate sigue con el pack).
- **Transparencia:** resuelta con el pase de despeckle; revisar visualmente algunos resultados.

## Fuera de alcance

- Generar las 4/8 direcciones (el pod solo muestra la de frente).
- Regenerar `walk.png` (el del pack se mantiene; se usa en combate).
- Animaciones para monstruos/bosses.

## Verificación

- Inspección visual de los strips generados (algunos personajes) sobre fondo transparente.
- `npm run build`/typecheck del cliente tras los cambios en `sprites.ts` y `SessionPod.vue`.
- Correr la GUI y forzar cada estado para ver el avatar animado y la atenuación de `offline`.
