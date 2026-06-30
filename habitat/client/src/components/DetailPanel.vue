<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import QuestBook from './QuestBook.vue'
import FileBrowser from './FileBrowser.vue'
import ChangesPanel from './ChangesPanel.vue'
import ProjectExplorer from './ProjectExplorer.vue'
import EditorTerminal from './EditorTerminal.vue'
import { quotePath } from '../composables/useFiles'
import { useSessions } from '../stores/sessions'
import { STATUS_LABEL, type FightResult } from '../types'
import { faceFor, ago, fmt } from '../sprites'
import { useTerminal, canReadClipboard } from '../composables/useTerminal'
import { useProjects } from '../composables/useProjects'
import { createLongPress } from '../composables/longPress'

const store = useSessions()
const { canSpawn, kill, colorForProject } = useProjects()
const selectedId = computed(() => store.selected?.id ?? null)
const termEl = ref<HTMLElement | null>(null)
const { fit, insert, getSelection, copySelection, pasteClipboard, copyVisible, selectMode } =
  useTerminal(termEl, selectedId, { onCopied: flashCopied })
// En contexto inseguro (HTTP/LAN) no se puede leer el portapapeles desde un click:
// el botón "Pegar" se deshabilita y el usuario pega con Ctrl+V (evento nativo).
const canPaste = canReadClipboard()

// Toast efímero "copiado" (para copiar-visible y, más adelante, modo selección).
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
function flashCopied() {
  copied.value = true
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = false), 1500)
}
function onCopyVisible() { if (copyVisible()) flashCopied() }
const headTint = computed(() => {
  const c = store.selected ? colorForProject(store.selected.project) : ''
  return c ? { background: `color-mix(in srgb, ${c} 14%, var(--color-surface))` } : {}
})

function closeSession() {
  const s = store.selected
  if (!s) return
  if (confirm(`¿Cerrar la sesión "${s.name}"? Se perderá el trabajo en curso.`)) kill(s.id)
}

// Menú contextual de la terminal (copiar / pegar). El navegador reserva Ctrl+Shift+C
// para DevTools, así que el click derecho es la vía explícita de copiar/pegar.
const menu = ref<{ x: number; y: number; hasSel: boolean } | null>(null)
function openMenu(p: { clientX: number; clientY: number }) {
  menu.value = { x: p.clientX, y: p.clientY, hasSel: !!getSelection() }
}
function menuCopy() { copySelection(); menu.value = null }
function menuPaste() { pasteClipboard(); menu.value = null }

// En touch no hay click derecho: un long-press sobre la terminal abre el mismo menú.
const lp = createLongPress((x, y) => openMenu({ clientX: x, clientY: y }))
function onTouchStart(e: TouchEvent) {
  if (selectMode.value) return // en modo selección el gesto es para seleccionar, no long-press
  const t = e.touches[0]
  if (t) lp.start(t.clientX, t.clientY)
}
function onTouchMove(e: TouchEvent) {
  if (selectMode.value) return
  const t = e.touches[0]
  if (t) lp.move(t.clientX, t.clientY)
}

const bookOpen = ref(false)
watch(selectedId, () => { bookOpen.value = false }) // cerrar el libro al cambiar de sesión
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { bookOpen.value = false; filesOpen.value = false; changesOpen.value = false; explorerOpen.value = false; menu.value = null } }
onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => {
  document.removeEventListener('keydown', onKey)
  if (copiedTimer) clearTimeout(copiedTimer)
})

const filesOpen = ref(false)
watch(selectedId, () => { filesOpen.value = false }) // cerrar al cambiar de sesión
const changesOpen = ref(false)
watch(selectedId, () => { changesOpen.value = false })
const explorerOpen = ref(false)
const editorOpen = ref(false)
watch(selectedId, () => { explorerOpen.value = false; editorOpen.value = false })
function onPickFile(rel: string) {
  insert(quotePath(rel) + ' ') // escribir el path (con espacio final) en la terminal
  filesOpen.value = false
}

// Overlay de loot al vencer — solo para la sesión enfocada.
const lootShown = ref(false)
const loot = ref<FightResult | null>(null)
watch(
  () => store.lastFight,
  (lf) => {
    if (lf && lf.id === store.selected?.id) {
      loot.value = lf.result
      lootShown.value = true
      setTimeout(() => (lootShown.value = false), 2600)
    }
  },
)

const bagSrc = '/assets/ui/bag.png'

defineExpose({ fit })
</script>

<template>
  <div class="dpanel">
    <template v-if="store.selected">
      <div class="dhead" :style="headTint">
        <div class="portrait">
          <i class="rivet tl"></i><i class="rivet tr"></i><i class="rivet bl"></i><i class="rivet br"></i>
          <div class="well"><img class="face" :src="faceFor(store.selected.name, store.selected.char)" alt="" /></div>
        </div>
        <div class="dinfo">
          <div class="dname">{{ store.selected.name }} <span class="chip" :class="store.selected.status">{{ STATUS_LABEL[store.selected.status] }}</span></div>
          <div class="repo">{{ store.selected.project }} <span class="br" v-if="store.selected.branch">⌥ {{ store.selected.branch }}</span></div>
          <div class="action">{{ store.selected.action }}</div>
          <div class="since">activa hace {{ ago(store.selected.since) }}</div>
        </div>
        <div class="dtools">
          <button class="tool" @click="bookOpen = !bookOpen" title="Quest Book"><img src="/assets/ui/book.png" alt="" />Quest Book</button>
          <button class="tool" @click="filesOpen = !filesOpen" title="Archivos"><img :src="bagSrc" alt="" />Archivos</button>
          <button class="tool" @click="changesOpen = !changesOpen" title="Cambios git">⌥ Cambios</button>
          <button class="tool" @click="explorerOpen = !explorerOpen" title="Explorador de proyecto">🗂 Proyecto</button>
          <button v-if="canSpawn" class="tool danger" @click="closeSession">✕ Cerrar</button>
        </div>
      </div>
      <div class="term" :class="{ selecting: selectMode }">
        <div class="term-bar">
          <span class="tt"><b>{{ store.selected.project }}</b><span v-if="store.selected.branch"> · {{ store.selected.branch }}</span> · tmux</span>
          <button
            class="termbtn"
            :class="{ on: selectMode }"
            style="margin-left:auto"
            @click="selectMode = !selectMode"
            title="Arrastrá con el dedo para seleccionar y copiar"
          >{{ selectMode ? '✓ seleccionar' : 'seleccionar' }}</button>
          <button class="termbtn" @click="onCopyVisible" title="Copiar todo lo visible">copiar visible</button>
          <span class="live"><span class="d"></span> en vivo</span>
        </div>
        <div
          ref="termEl"
          class="term-body"
          aria-label="terminal de la sesión"
          @contextmenu.prevent="openMenu"
          @touchstart="onTouchStart"
          @touchmove="onTouchMove"
          @touchend="lp.cancel()"
          @touchcancel="lp.cancel()"
        ></div>
        <div class="copied-toast" :class="{ show: copied }">copiado ✓</div>
      </div>
      <template v-if="menu">
        <div class="menu-backdrop" @click="menu = null" @contextmenu.prevent="menu = null"></div>
        <div class="ctxmenu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }">
          <button :disabled="!menu.hasSel" @click="menuCopy">Copiar <span class="sc">⌃C</span></button>
          <button :disabled="!canPaste" :title="canPaste ? '' : 'Pegá con Ctrl+V'" @click="menuPaste">
            Pegar <span class="sc">⌃V</span>
          </button>
        </div>
      </template>
      <QuestBook v-if="bookOpen" :id="store.selected.id" @close="bookOpen = false" />
      <FileBrowser v-if="filesOpen" :id="store.selected.id" @close="filesOpen = false" @pick="onPickFile" />
      <ChangesPanel v-if="changesOpen" :id="store.selected.id" @close="changesOpen = false" />
      <ProjectExplorer v-if="explorerOpen" :id="store.selected.id" @close="explorerOpen = false" @opened="editorOpen = true" />
      <EditorTerminal v-if="editorOpen" :id="store.selected.id" @close="editorOpen = false" />
      <div class="loot" :class="{ show: lootShown }" v-if="loot">
        <img src="/assets/ui/chest.png" alt="" />
        <div><div class="lt">★ Vencido — {{ loot.monster }}</div><div class="ls">HP <b>{{ fmt(loot.hp) }}</b> · {{ loot.hits }} golpes</div></div>
        <div class="lf"><span>loot:</span> {{ loot.loot.join(' · ') }}</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ===== Layout ===== */
.dpanel {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 16px clamp(14px, 1.8vw, 22px) 22px;
}

/* ===== Header card ===== */
.dhead {
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 14px;
  border-radius: var(--radius-card);
  background: linear-gradient(180deg, var(--color-surface-2), var(--color-surface));
  border: 1px solid var(--color-edge);
  box-shadow: var(--shadow-sh1);
}

/* ===== Brass medallion portrait ===== */
.portrait {
  position: relative;
  width: 90px;
  height: 90px;
  flex: 0 0 auto;
  border-radius: 18px;
  padding: 5px;
  background: linear-gradient(155deg, #EEC675, #B57E32 48%, #6E4A1E 78%, #4A3015);
  box-shadow: 0 3px 7px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.65),
              inset 0 1px 0 rgba(255,240,200,.55), inset 0 -2px 3px rgba(0,0,0,.4);
}
.portrait .well {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 13px;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: radial-gradient(58px 48px at 50% 122%, rgba(232,119,58,.32), transparent 70%),
              linear-gradient(180deg, #15100a, #241910);
  box-shadow: inset 0 2px 9px rgba(0,0,0,.85), inset 0 0 0 1px rgba(0,0,0,.55),
              inset 0 0 0 2px rgba(224,169,75,.12);
}
.portrait .rivet {
  position: absolute;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  z-index: 2;
  background: radial-gradient(circle at 35% 30%, #f6dc94, #6f4a1c);
  box-shadow: 0 1px 1px rgba(0,0,0,.6);
}
.portrait .rivet.tl { top: 6px; left: 6px; }
.portrait .rivet.tr { top: 6px; right: 6px; }
.portrait .rivet.bl { bottom: 6px; left: 6px; }
.portrait .rivet.br { bottom: 6px; right: 6px; }
/* Soften the square pixel-art sprite edges */
.portrait .face {
  display: block;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  border-radius: 10px;
  object-fit: contain;
}

/* ===== Info block ===== */
.dinfo {
  min-width: 0;
  flex: 1;
}
.dname {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: "Fraunces", Georgia, serif;
  font-weight: 560;
  font-size: 23px;
  letter-spacing: -.01em;
}
.repo {
  margin-top: 6px;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 13px;
  color: var(--color-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.repo .br { color: var(--color-brass); }
.dpanel .action {
  margin-top: 7px;
  font-size: 14.5px;
  color: var(--color-ink-2);
}
.dpanel .since {
  margin-top: 8px;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .05em;
  color: var(--color-faint);
}

/* ===== Status chip ===== */
.dpanel .chip {
  margin-left: auto;
  font-family: var(--font-system);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: .07em;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid;
}

.dpanel .chip.working {
  color: var(--color-ember);
  background: rgba(232,119,58,.12);
  border-color: rgba(232,119,58,.4);
}

.dpanel .chip.waiting {
  color: #1b1407;
  background: var(--color-amber);
  border-color: var(--color-amber);
}

.dpanel .chip.done {
  color: var(--color-moss);
  background: rgba(143,184,92,.12);
  border-color: rgba(143,184,92,.4);
}

.dpanel .chip.idle {
  color: var(--color-dim);
  background: rgba(174,153,122,.1);
  border-color: var(--color-edge);
}

.dpanel .chip.error {
  color: var(--color-crimson);
  background: rgba(209,75,60,.12);
  border-color: rgba(209,75,60,.4);
}

.dpanel .chip.offline {
  color: var(--color-dim);
  background: rgba(174,153,122,.1);
  border-color: var(--color-edge);
  opacity: .65;
}

/* ===== Tools ===== */
.dtools {
  display: flex;
  gap: 8px;
  align-self: flex-start;
}
.tool {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 12px;
  border-radius: 9px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-edge);
  color: var(--color-ink-2);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: .15s;
}
.tool:hover { border-color: var(--color-brass-2); color: var(--color-brass); }
.tool img { width: 16px; height: 16px; image-rendering: pixelated; }
.tool.danger:hover { border-color: var(--color-crimson); color: var(--color-crimson); }

/* ===== Terminal (hero surface) ===== */
.term {
  position: relative;
  margin-top: 16px;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-card);
  overflow: hidden;
  border: 1px solid var(--color-edge);
  box-shadow: var(--shadow-sh2);
  background: #0E0A06;
}
.term-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--color-edge);
  background: linear-gradient(180deg, #1b150e, #15100a);
  flex-shrink: 0;
}
.term-bar .tt {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 12px;
  color: var(--color-dim);
}
.term-bar .tt b { color: var(--color-ink-2); }
.term-bar .live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--color-ember);
  text-transform: uppercase;
  letter-spacing: .08em;
}
.term-bar .live .d {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-ember);
  box-shadow: 0 0 8px var(--color-ember);
  animation: pulse 1.6s infinite;
}
@keyframes pulse {
  0%   { box-shadow: 0 0 0 0 rgba(232,119,58,.55); }
  70%  { box-shadow: 0 0 0 7px rgba(232,119,58,0); }
  100% { box-shadow: 0 0 0 0 rgba(232,119,58,0); }
}
.term-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0;
  background: #0E0A06;
}
.termbtn {
  background: var(--color-surface-2);
  border: 1px solid var(--color-edge);
  color: var(--color-ink-2);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 11px;
  padding: 4px 9px;
  border-radius: 7px;
  cursor: pointer;
}
.termbtn:hover { border-color: var(--color-brass-2); color: var(--color-brass); }
.termbtn.on { border-color: var(--color-brass); color: var(--color-brass); background: rgba(224,169,75,.12); }
.term.selecting .term-body { cursor: crosshair; }
/* La barra ya empuja .live a la derecha con margin-left:auto en el primer botón del grupo. */
.copied-toast {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  background: var(--color-surface-2);
  border: 1px solid rgba(224,169,75,.4);
  color: var(--color-brass);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 8px;
  opacity: 0;
  pointer-events: none;
  transition: opacity .15s;
  z-index: 30;
}
.copied-toast.show { opacity: 1; }

/* ===== Context menu ===== */
.menu-backdrop { position: fixed; inset: 0; z-index: 40; }
.ctxmenu {
  position: fixed;
  z-index: 41;
  min-width: 140px;
  display: flex;
  flex-direction: column;
  background: var(--color-surface-2);
  border: 1px solid var(--color-edge-soft);
  border-radius: 9px;
  padding: 4px;
  box-shadow: var(--shadow-sh2);
}
.ctxmenu button {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  background: transparent;
  border: 0;
  color: var(--color-ink-2);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 12px;
  text-align: left;
  padding: 6px 10px;
  border-radius: 5px;
  cursor: pointer;
}
.ctxmenu button:hover:not(:disabled) { background: var(--color-raise); color: var(--color-brass); }
.ctxmenu button:disabled { opacity: 0.4; cursor: default; }
.ctxmenu .sc { opacity: 0.5; font-size: 11px; }

/* ===== Loot toast ===== */
.loot {
  display: none;
  margin-top: 14px;
  align-items: center;
  gap: 14px;
  padding: 13px 16px;
  border-radius: var(--radius-card);
  background: radial-gradient(200px 80px at 12% 50%, rgba(224,169,75,.16), transparent 70%),
              linear-gradient(180deg, var(--color-surface-2), var(--color-surface));
  border: 1px solid rgba(224,169,75,.35);
  box-shadow: var(--shadow-sh1);
}
.loot.show {
  display: flex;
  animation: bfadein .2s;
}
.loot img {
  width: 34px;
  height: 34px;
  image-rendering: pixelated;
  filter: drop-shadow(0 3px 4px rgba(0,0,0,.5));
  flex-shrink: 0;
}
.loot .lt {
  font-family: "Fraunces", Georgia, serif;
  font-weight: 560;
  font-size: 15px;
  color: var(--color-brass);
}
.loot .ls {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 12px;
  color: var(--color-dim);
}
.loot .ls b { color: var(--color-ink-2); }
.loot .lf {
  margin-left: auto;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 12px;
  color: var(--color-moss);
  text-align: right;
}
.loot .lf span { color: var(--color-faint); }
</style>
