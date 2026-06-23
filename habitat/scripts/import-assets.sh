#!/usr/bin/env bash
# Importa un subconjunto curado de sprites del pack "Ninja Adventure - Asset Pack"
# (src externo, nombres inconsistentes) a habitat/web/assets/ con nombres
# normalizados que el front consume. Idempotente: re-correrlo regenera la carpeta.
#
# Uso: bash habitat/scripts/import-assets.sh   (desde la raíz del repo)
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/Ninja Adventure - Asset Pack"
DST="$ROOT/habitat/client/public/assets"

CHARS=(Boy Cavegirl Knight NinjaBlue Monk Hunter FighterRed DemonRed Eskimo GreenPig Lion Monkey Inspector Master KnightGold Caveman)
MONSTERS=(Slime Slime3 Flam BlueBat Mushroom KappaGreen Eye Larva Mole Mouse Lizard Bear Beast GreenOctopus Butterfly Dragon)
# Solo bosses con frames cuadrados (W % H == 0) → el front deriva frames = W/H sin manifest.
BOSSES=(GiantFrog DemonCyclop GiantBamboo TenguRed GiantRacoon GiantSpirit GiantFlam TenguBlue)

copied=0; skipped=0
log_skip(){ echo "SKIP: $1"; skipped=$((skipped+1)); }

rm -rf "$DST"
mkdir -p "$DST/char" "$DST/monster" "$DST/boss"

# --- Personajes: anim consistente en SeparateAnim/ ---
for c in "${CHARS[@]}"; do
  sa="$SRC/Actor/Character/$c/SeparateAnim"
  face="$SRC/Actor/Character/$c/Faceset.png"
  [ -d "$sa" ] || { log_skip "char $c (sin SeparateAnim)"; continue; }
  mkdir -p "$DST/char/$c"
  declare -A map=([Idle]=idle [Walk]=walk [Jump]=jump [Item]=item [Dead]=dead)
  for src_name in "${!map[@]}"; do
    if [ -f "$sa/$src_name.png" ]; then
      cp "$sa/$src_name.png" "$DST/char/$c/${map[$src_name]}.png"; copied=$((copied+1))
    else log_skip "char $c/$src_name.png"; fi
  done
  if [ -f "$face" ]; then cp "$face" "$DST/char/$c/face.png"; copied=$((copied+1)); else log_skip "char $c/Faceset.png"; fi
done

# --- Monstruos: el .png que NO es Faceset* ---
for m in "${MONSTERS[@]}"; do
  dir="$SRC/Actor/Monster/$m"
  [ -d "$dir" ] || { log_skip "monster $m (no existe)"; continue; }
  spr="$(ls "$dir"/*.png 2>/dev/null | grep -iv 'faceset' | head -1)"
  if [ -n "$spr" ]; then cp "$spr" "$DST/monster/$m.png"; copied=$((copied+1)); else log_skip "monster $m (sin sprite)"; fi
done

# --- Bosses: el Idle*.png (no .gif) ---
for b in "${BOSSES[@]}"; do
  dir="$SRC/Actor/Boss/$b"
  [ -d "$dir" ] || { log_skip "boss $b (no existe)"; continue; }
  idle="$(ls "$dir"/*[Ii]dle*.png 2>/dev/null | head -1)"
  if [ -n "$idle" ]; then cp "$idle" "$DST/boss/$b.png"; copied=$((copied+1)); else log_skip "boss $b (sin idle png)"; fi
done

# --- UI: fuente, marcos, orbe, cofre, emotes ---
FONTS="$ROOT/habitat/client/public/fonts"
mkdir -p "$DST/ui" "$DST/emote" "$FONTS"
cp "$SRC/Ui/Font/NormalFont.ttf" "$FONTS/NormalFont.ttf"
cp "$SRC/Ui/Dialog/DialogBox.png" "$DST/ui/dialogbox.png"
cp "$SRC/Ui/Dialog/DialogueBoxSimple.png" "$DST/ui/dialogsimple.png"
cp "$SRC/Ui/Receptacle/Receptacle Sphere/BackgroundWood.png" "$DST/ui/orb-bg.png"
cp "$SRC/Ui/Receptacle/Receptacle Sphere/ProgressGreen.png" "$DST/ui/orb-green.png"
cp "$SRC/Ui/Receptacle/Receptacle Sphere/ProgressYellow.png" "$DST/ui/orb-yellow.png"
cp "$SRC/Ui/Receptacle/Receptacle Sphere/ProgressHealth.png" "$DST/ui/orb-red.png"
cp "$SRC/Ui/Receptacle/Receptacle Sphere/Over.png" "$DST/ui/orb-over.png"
cp "$SRC/Items/Treasure/BigTreasureChest.png" "$DST/ui/chest.png"
cp "$SRC/Items/Treasure/GoldCoin.png" "$DST/ui/coin.png"
for i in $(seq 1 30); do cp "$SRC/Ui/Emote/emote$i.png" "$DST/emote/$i.png"; done

# --- Animaciones de avatar generadas (canónicas en assets-src, fuera del pack) ---
ANIM_SRC="$ROOT/habitat/assets-src/char"
if [ -d "$ANIM_SRC" ]; then
  for cdir in "$ANIM_SRC"/*/; do
    c="$(basename "$cdir")"
    [ -d "$DST/char/$c" ] || continue
    for f in "$cdir"anim_*.png; do
      [ -f "$f" ] || continue
      cp "$f" "$DST/char/$c/"
      copied=$((copied+1))
    done
  done
fi

echo "---"
echo "copiados: $copied · saltados: $skipped"
echo "chars: $(ls "$DST/char" | wc -l) · monsters: $(ls "$DST/monster" | wc -l) · bosses: $(ls "$DST/boss" | wc -l) · ui: $(ls "$DST/ui" | wc -l) · emotes: $(ls "$DST/emote" | wc -l)"
