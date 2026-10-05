<script setup lang="ts">
import { ref, computed } from 'vue'
import type { GitStatus, GitFile, DiffBase, StashEntry } from '../../../composables/useGit'
import GitIcon from './GitIcon.vue'
import { BTN, BTN_ICON, BTN_PRIMARY, BTN_DANGER, GROUP, GROUP_H4, COUNT, MUTED, INPUT, UL, LI, FLAT, FLAT_A, stColor } from './gitClasses'

const props = defineProps<{ status: GitStatus; stash: StashEntry[] }>()
const emit = defineEmits<{
  (e: 'run', name: string, payload?: { paths?: string[]; message?: string; index?: number }, confirmMsg?: string): void
  (e: 'diff', file: string, base: DiffBase): void
}>()

const commitMsg = ref('')
const stashMsg = ref('')
function paths(list: GitFile[]) { return list.map((f) => f.rel) }
function doCommit() {
  if (!commitMsg.value.trim()) return
  emit('run', 'commit', { message: commitMsg.value })
  commitMsg.value = ''
}
// overview.branch viene vacío cuando HEAD es unborn (`rev-parse --abbrev-ref HEAD`
// falla en un repo sin ningún commit): no hay nada que amendear.
const canAmend = computed(() => !!props.status.overview.branch)

// Todo lo que está sin stagear, trackeado o no: es lo que consume "stagear todo",
// simétrico al "unstage all" que ya existía y no tenía par.
const unstagedAll = computed(() => [
  ...props.status.working.unstaged,
  ...props.status.working.untracked,
])
const nothingToDo = computed(() =>
  !props.status.working.conflicted.length &&
  !props.status.working.staged.length &&
  !unstagedAll.value.length)

// status.commits son los commits en default..HEAD. El aviso estaba invertido:
// con la lista vacía `last` era undefined y `warn` undefined -> amend SIN
// confirmación, y ése es justo el caso en que HEAD está garantizado publicado (no
// hay nada local por encima del default). Ahora se avisa salvo que se sepa
// positivamente que el último commit NO está pusheado.
function doAmend() {
  const last = props.status.commits[0]
  const warn = last && !last.pushed
    ? undefined
    : 'El último commit ya está publicado: el amend reescribe historia y el próximo push va a ser rechazado (habría que forzarlo desde la terminal). Seguir?'
  emit('run', 'amend', { message: commitMsg.value }, warn)
  commitMsg.value = ''
}
</script>

<template>
  <!-- Zona 1: conflictos. Van primero porque bloquean todo lo demás. -->
  <section v-if="props.status.working.conflicted.length" :class="GROUP" class="rounded-[calc(var(--radius)+4px)] border border-state-error bg-state-error/10 p-2.5">
    <h4 :class="GROUP_H4">
      En conflicto
      <span :class="COUNT">{{ props.status.working.conflicted.length }}</span>
    </h4>
    <ul :class="UL">
      <li v-for="f in props.status.working.conflicted" :key="f.rel" :class="LI">
        <span class="w-4 text-center font-mono text-xs text-state-error">{{ f.status }}</span>
        <span :class="FLAT">{{ f.rel }}</span>
      </li>
    </ul>
    <button type="button" :class="[BTN, BTN_DANGER]" @click="emit('run', 'abort', {}, 'Abortar el merge en curso?')">
      Abortar merge
    </button>
  </section>

  <!-- Zona 2: los cambios. Nada que hacer acá es un estado legítimo y se dice. -->
  <p v-if="nothingToDo" :class="MUTED">
    El árbol está limpio: no hay cambios sin commitear.
  </p>

  <template v-else>
    <section v-if="props.status.working.staged.length" :class="GROUP">
      <h4 :class="GROUP_H4">
        Staged
        <span :class="COUNT">{{ props.status.working.staged.length }}</span>
        <button type="button" class="ml-auto" :class="BTN"
          @click="emit('run', 'unstage', { paths: paths(props.status.working.staged) })">
          <GitIcon name="minus" />
          quitar todo
        </button>
      </h4>
      <ul :class="UL">
        <li v-for="f in props.status.working.staged" :key="f.rel" :class="LI">
          <span class="w-4 text-center font-mono text-xs" :class="stColor(f.status)">{{ f.status }}</span>
          <a :class="FLAT_A" @click="emit('diff', f.rel, 'staged')">{{ f.rel }}</a>
          <button type="button" :class="[BTN, BTN_ICON]" :aria-label="`Quitar ${f.rel} del stage`"
            @click="emit('run', 'unstage', { paths: [f.rel] })">
            <GitIcon name="minus" />
          </button>
        </li>
      </ul>
    </section>

    <section v-if="unstagedAll.length" :class="GROUP">
      <h4 :class="GROUP_H4">
        Sin stagear
        <span :class="COUNT">{{ unstagedAll.length }}</span>
        <!-- El simétrico de "quitar todo", que antes no existía. -->
        <button type="button" class="ml-auto" :class="BTN" @click="emit('run', 'stage', { paths: paths(unstagedAll) })">
          <GitIcon name="plus" />
          stagear todo
        </button>
      </h4>
      <ul :class="UL">
        <li v-for="f in props.status.working.unstaged" :key="'u' + f.rel" :class="LI">
          <span class="w-4 text-center font-mono text-xs" :class="stColor(f.status)">{{ f.status }}</span>
          <a :class="FLAT_A" @click="emit('diff', f.rel, 'working')">{{ f.rel }}</a>
          <button type="button" :class="[BTN, BTN_ICON]" :aria-label="`Stagear ${f.rel}`"
            @click="emit('run', 'stage', { paths: [f.rel] })">
            <GitIcon name="plus" />
          </button>
          <!-- Descartar es irreversible: color semántico, icono explícito (antes
               era un ⌦ que no se entendía) y separado del + para no tocarlo
               apuntando al de al lado. -->
          <button type="button" class="ml-2" :class="[BTN, BTN_ICON, BTN_DANGER]" :aria-label="`Descartar cambios de ${f.rel}`"
            @click="emit('run', 'discard', { paths: [f.rel] }, `Descartar cambios de ${f.rel}? No se puede deshacer.`)">
            <GitIcon name="trash" />
          </button>
        </li>
        <li v-for="f in props.status.working.untracked" :key="'n' + f.rel" :class="LI">
          <span class="w-4 text-center font-mono text-xs text-muted">?</span>
          <a :class="FLAT_A" @click="emit('diff', f.rel, 'working')">{{ f.rel }}</a>
          <button type="button" :class="[BTN, BTN_ICON]" :aria-label="`Stagear ${f.rel}`"
            @click="emit('run', 'stage', { paths: [f.rel] })">
            <GitIcon name="plus" />
          </button>
        </li>
      </ul>
    </section>
  </template>

  <!-- Zona 3: commit. Anclada abajo del contenido, es el cierre del flujo. -->
  <section class="my-4 flex flex-col gap-1.5 border-t border-border pt-4">
    <input v-model="commitMsg" class="w-full" :class="INPUT" placeholder="mensaje de commit" @keyup.enter="doCommit" />
    <div class="flex gap-1.5">
      <button type="button" class="flex-1 justify-center" :class="[BTN, commitMsg.trim() ? BTN_PRIMARY : '']" :disabled="!commitMsg.trim()"
        data-test="git-commit-actions"
        @click="doCommit">
        <GitIcon name="check" />
        Commit
      </button>
      <button type="button" class="flex-1 justify-center" :class="BTN" :disabled="!canAmend"
        data-test="git-commit-actions"
        :title="canAmend ? 'reescribe el último commit' : 'el repo todavía no tiene commits'"
        @click="doAmend">amend</button>
    </div>
  </section>

  <!-- Zona 4: stash. Herramienta lateral, no parte del flujo principal. -->
  <section :class="GROUP">
    <h4 :class="GROUP_H4">
      <GitIcon name="stack" />
      Stash
      <span :class="COUNT">{{ props.stash.length }}</span>
    </h4>
    <div class="mb-1.5 flex gap-1.5">
      <input v-model="stashMsg" class="min-w-0 flex-1" :class="INPUT" placeholder="etiqueta (opcional)" />
      <button type="button" :class="BTN" @click="emit('run', 'stash-push', { message: stashMsg })">guardar</button>
    </div>
    <ul :class="UL">
      <li v-for="s in props.stash" :key="s.index" :class="LI">
        <span :class="FLAT">{{ s.message }}</span>
        <button type="button" :class="BTN" @click="emit('run', 'stash-apply', { index: s.index })">aplicar</button>
        <button type="button" class="ml-2" :class="[BTN, BTN_ICON, BTN_DANGER]" :aria-label="`Borrar el stash ${s.message}`"
          @click="emit('run', 'stash-drop', { index: s.index }, 'Borrar este stash? No se puede deshacer.')">
          <GitIcon name="trash" />
        </button>
      </li>
      <li v-if="!props.stash.length" :class="MUTED">nada guardado</li>
    </ul>
  </section>
</template>
