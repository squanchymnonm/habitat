# Nombres de sesión aleatorios y únicos globalmente

## Problema

Al abrir sesiones nuevas en el Hábitat, el nombre autogenerado siempre sale en
el mismo orden: la primera sesión es `mario`, la segunda `luigi`, etc. Esto pasa
porque `autoName` recorre la lista `NAMES` secuencialmente y devuelve el primer
nombre libre.

Además, la unicidad hoy es **por proyecto**: dos proyectos distintos pueden
tener cada uno un `mario`.

## Objetivo

1. La elección del nombre autogenerado debe ser **aleatoria**.
2. Un nombre no se puede repetir entre **todas** las sesiones abiertas
   (unicidad **global**, no por proyecto).

## Diseño

### Cambio 1 — `autoName` aleatorio (`habitat/server/characters.js`)

Reescribir `autoName(used)` para elegir al azar entre los nombres libres en vez
de recorrer `NAMES` en orden:

1. Calcular los nombres de `NAMES` que **no** estén en `used`.
2. Si hay libres → devolver uno **aleatorio** de esos.
3. Si están todos usados → generar candidatos con sufijo (`-2`, `-3`, …) y
   elegir aleatoriamente entre los libres de ese nivel, subiendo de nivel hasta
   encontrar uno. Esto mantiene la garantía de no-repetición que ya existía.

Se usa `Math.random()` (disponible normalmente en el entorno del server).

### Cambio 2 — unicidad global (`habitat/server/index.js`)

En el handler de `/spawn`, quitar el filtro por proyecto al calcular `used`:

```js
// antes:
const used = store.all().filter((s) => s.project === projectName).map((s) => s.name);
// después:
const used = store.all().map((s) => s.name);
```

Así un nombre tomado en cualquier proyecto se considera ocupado.

### Tests (`habitat/server/characters.test.js`)

Los tests actuales asumen orden determinista
(`autoName([]) === NAMES[0]`, `autoName([NAMES[0]]) === NAMES[1]`). Hay que
reescribirlos para la nueva semántica:

- `autoName([])` devuelve **algún** miembro de `NAMES`.
- El resultado **nunca** está en `used`.
- Con todos los nombres usados, devuelve un sufijado válido (`/-\d+$/`) y fuera
  de `used`.

## Fuera de alcance (no cambia)

- La lista `NAMES`.
- El chequeo de colisión de tmux (respuesta 409 si la sesión ya existe).
- El contrato cliente/servidor.
