<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useGitChanges, type DiffBase, type GitFile } from '../composables/useGitChanges'
import { parseDiff, type DiffHunk } from '../composables/parseDiff'
import { useSessions } from '../stores/sessions'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const store = useSessions()
const { status, loading, error, loadStatus, loadDiff, action } = useGitChanges()

const tab = ref<'work' | 'branch' | 'commits'>('work')
const diff = ref<{ file: string; hunks: DiffHunk[]; binary: boolean } | null>(null)
const busy = ref('')
const actionErr = ref('')

async function refresh() { await loadStatus(props.id) }

async function openDiff(file: string, base: DiffBase) {
  diff.value = null
  try {
    const r = await loadDiff(props.id, file, base)
    diff.value = { file, hunks: r.binary ? [] : parseDiff(r.patch), binary: r.binary }
  } catch { actionErr.value = 'no se pudo cargar el diff' }
}

async function run(name: string, payload: { paths?: string[]; message?: string } = {}, confirmMsg?: string) {
  if (confirmMsg && !confirm(confirmMsg)) return
  busy.value = name; actionErr.value = ''
  const r = await action(props.id, name, payload)
  busy.value = ''
  if (!r.ok) actionErr.value = r.conflict ? `Conflicto en: ${(r.files ?? []).join(', ')}` : (r.message || 'falló')
  await refresh()
}

const commitMsg = ref('')
function doCommit() {
  if (!commitMsg.value.trim()) return
  run('commit', { message: commitMsg.value }).then(() => { commitMsg.value = '' })
}

// Refresh live: cada broadcast WS hace store.upsert -> la sesión seleccionada
// cambia de identidad; debounced para no spamear git.
let t: ReturnType<typeof setTimeout> | null = null
function schedule() { if (t) clearTimeout(t); t = setTimeout(refresh, 800) }
watch(() => store.list.find((s) => s.id === props.id), schedule)

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { if (diff.value) diff.value = null; else emit('close') } }
onMounted(() => { refresh(); window.addEventListener('keydown', onKey) })
onBeforeUnmount(() => { if (t) clearTimeout(t); window.removeEventListener('keydown', onKey) })

function canWrite() { return !!status.value?.canWrite }
function paths(list: GitFile[]) { return list.map((f) => f.rel) }
</script>

<template>
  <div class="changes-overlay">
    <header class="ch-head">
      <span class="ch-title">⌥ Cambios git</span>
      <span v-if="status" class="ch-branch">
        {{ status.overview.branch }} → {{ status.overview.default }}
        <b>↑{{ status.overview.ahead }} ↓{{ status.overview.behind }}</b>
      </span>
      <button class="ch-x" @click="refresh" title="Refrescar">⟳</button>
      <button class="ch-x" @click="emit('close')" title="Cerrar">✕</button>
    </header>

    <nav class="ch-tabs">
      <button :class="{ on: tab === 'work' }" @click="tab = 'work'">Trabajo</button>
      <button :class="{ on: tab === 'branch' }" @click="tab = 'branch'">Rama</button>
      <button :class="{ on: tab === 'commits' }" @click="tab = 'commits'">Commits</button>
    </nav>

    <p v-if="error" class="ch-err">{{ error === 'sin-dir' ? 'sesión sin working dir' : error }}</p>
    <p v-if="actionErr" class="ch-err">{{ actionErr }}</p>
    <p v-if="loading" class="ch-muted">cargando…</p>

    <div v-if="status" class="ch-body">
      <!-- TRABAJO -->
      <section v-show="tab === 'work'">
        <div v-if="status.working.conflicted.length" class="ch-group">
          <h4>En conflicto</h4>
          <ul>
            <li v-for="f in status.working.conflicted" :key="f.rel">
              <span class="st conf">{{ f.status }}</span> {{ f.rel }}
            </li>
          </ul>
          <button v-if="canWrite()" class="act danger" :disabled="busy === 'abort'"
            @click="run('abort', {}, 'Abortar el merge en curso?')">Abortar merge</button>
        </div>

        <div class="ch-group">
          <h4>Staged ({{ status.working.staged.length }})
            <button v-if="canWrite() && status.working.staged.length" class="mini"
              @click="run('unstage', { paths: paths(status.working.staged) })">unstage all</button>
          </h4>
          <ul>
            <li v-for="f in status.working.staged" :key="f.rel">
              <span class="st">{{ f.status }}</span>
              <a @click="openDiff(f.rel, 'staged')">{{ f.rel }}</a>
              <button v-if="canWrite()" class="mini" @click="run('unstage', { paths: [f.rel] })">−</button>
            </li>
          </ul>
        </div>

        <div class="ch-group">
          <h4>Sin stagear ({{ status.working.unstaged.length + status.working.untracked.length }})</h4>
          <ul>
            <li v-for="f in status.working.unstaged" :key="'u' + f.rel">
              <span class="st">{{ f.status }}</span>
              <a @click="openDiff(f.rel, 'working')">{{ f.rel }}</a>
              <button v-if="canWrite()" class="mini" @click="run('stage', { paths: [f.rel] })">+</button>
              <button v-if="canWrite()" class="mini danger"
                @click="run('discard', { paths: [f.rel] }, `Descartar cambios de ${f.rel}? No se puede deshacer.`)">⌦</button>
            </li>
            <li v-for="f in status.working.untracked" :key="'n' + f.rel">
              <span class="st new">?</span>
              <a @click="openDiff(f.rel, 'working')">{{ f.rel }}</a>
              <button v-if="canWrite()" class="mini" @click="run('stage', { paths: [f.rel] })">+</button>
            </li>
          </ul>
        </div>

        <div v-if="canWrite()" class="ch-commit">
          <input v-model="commitMsg" placeholder="mensaje de commit" @keyup.enter="doCommit" />
          <button :disabled="busy === 'commit' || !commitMsg.trim()" @click="doCommit">Commit</button>
        </div>
      </section>

      <!-- RAMA -->
      <section v-show="tab === 'branch'">
        <ul class="ch-group">
          <li v-for="f in status.overview.files" :key="f.rel">
            <span class="st">{{ f.status }}</span>
            <a @click="openDiff(f.rel, 'branch')">{{ f.rel }}</a>
          </li>
          <li v-if="!status.overview.files.length" class="ch-muted">sin diferencias con {{ status.overview.default }}</li>
        </ul>
        <div v-if="canWrite()" class="ch-actions">
          <button :disabled="busy === 'push'" @click="run('push')">Push</button>
          <button :disabled="busy === 'pull'" @click="run('pull')">Pull</button>
          <button :disabled="busy === 'merge-default'"
            @click="run('merge-default', {}, `Mergear ${status.overview.default} en la rama?`)">Merge default</button>
        </div>
      </section>

      <!-- COMMITS -->
      <section v-show="tab === 'commits'">
        <div v-for="c in status.commits" :key="c.sha" class="ch-commit-row">
          <span class="dot" :class="{ pushed: c.pushed }" :title="c.pushed ? 'pusheado' : 'sin pushear'">
            {{ c.pushed ? '✓' : '●' }}
          </span>
          <code>{{ c.shortSha }}</code> <span class="subj">{{ c.subject }}</span>
          <ul>
            <li v-for="f in c.files" :key="c.sha + f.rel">
              <span class="st">{{ f.status }}</span>
              <a @click="openDiff(f.rel, `commit:${c.sha}`)">{{ f.rel }}</a>
            </li>
          </ul>
        </div>
        <p v-if="!status.commits.length" class="ch-muted">sin commits sobre {{ status.overview.default }}</p>
      </section>
    </div>

    <!-- VISOR DIFF lado a lado (responsivo: split en ancho, inline en angosto) -->
    <div v-if="diff" class="ch-diff" @click.self="diff = null">
      <div class="ch-diff-box">
        <header><b>{{ diff.file }}</b><button class="ch-x" @click="diff = null">✕</button></header>
        <p v-if="diff.binary" class="ch-muted">archivo binario</p>
        <div v-else class="diff-scroll">
          <table v-for="(h, i) in diff.hunks" :key="i" class="diff-table">
            <tbody>
              <tr v-for="(l, j) in h.lines" :key="j" :class="l.type">
                <td class="ln">{{ l.oldNo ?? '' }}</td>
                <td class="ln">{{ l.newNo ?? '' }}</td>
                <td class="code">{{ l.text }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.changes-overlay { position: absolute; inset: 0; background: var(--color-base, #1a1410); color: var(--color-ink, #e8dcc0); display: flex; flex-direction: column; z-index: 5; overflow: hidden; }
.ch-head { display: flex; align-items: center; gap: .5rem; padding: .5rem .75rem; border-bottom: 1px solid var(--color-line, #3a2e22); }
.ch-title { font-weight: 700; }
.ch-branch { font-size: .8rem; opacity: .85; margin-left: auto; }
.ch-x, .mini, .act, .ch-actions button, .ch-commit button { cursor: pointer; background: var(--color-raise, #2a2018); color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); }
.ch-x { padding: .15rem .5rem; }
.ch-tabs { display: flex; gap: .25rem; padding: .4rem .75rem; }
.ch-tabs button { flex: 1; padding: .35rem; background: transparent; color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); cursor: pointer; }
.ch-tabs button.on { background: var(--color-brass, #c79a4b); color: #1a1410; font-weight: 700; }
.ch-body { flex: 1; overflow: auto; padding: .5rem .75rem; }
.ch-group { margin-bottom: .9rem; }
.ch-group h4 { margin: .3rem 0; font-size: .85rem; display: flex; align-items: center; gap: .5rem; }
.ch-group ul { list-style: none; margin: 0; padding: 0; }
.ch-group li { display: flex; align-items: center; gap: .4rem; padding: .12rem 0; font-size: .85rem; }
.ch-group a { cursor: pointer; text-decoration: underline dotted; flex: 1; word-break: break-all; }
.st { display: inline-block; width: 1.4em; text-align: center; font-weight: 700; color: var(--color-brass, #c79a4b); }
.st.new { color: #5fb36b; } .st.conf { color: #d2553f; }
.mini { padding: 0 .4rem; font-weight: 700; }
.danger { color: #d2553f; }
.ch-commit { display: flex; gap: .4rem; margin-top: .5rem; }
.ch-commit input { flex: 1; padding: .35rem; background: var(--color-raise, #2a2018); color: inherit; border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-sm, 4px); }
.ch-actions { display: flex; gap: .4rem; margin-top: .6rem; }
.ch-actions button, .ch-commit button, .act { padding: .35rem .6rem; }
.ch-commit-row { border-bottom: 1px dashed var(--color-line, #3a2e22); padding: .4rem 0; font-size: .85rem; }
.ch-commit-row code { color: var(--color-brass, #c79a4b); }
.ch-commit-row .subj { opacity: .9; }
.dot { display: inline-block; width: 1.2em; } .dot.pushed { color: #5fb36b; }
.ch-err { color: #d2553f; padding: 0 .75rem; font-size: .8rem; }
.ch-muted { opacity: .6; font-size: .82rem; }
.ch-diff { position: absolute; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 6; }
.ch-diff-box { width: 94%; height: 90%; background: var(--color-base, #1a1410); border: 1px solid var(--color-line, #3a2e22); border-radius: var(--radius-md, 6px); display: flex; flex-direction: column; }
.ch-diff-box header { display: flex; align-items: center; justify-content: space-between; padding: .4rem .6rem; border-bottom: 1px solid var(--color-line, #3a2e22); }
.diff-scroll { flex: 1; overflow: auto; }
.diff-table { width: 100%; border-collapse: collapse; font-family: ui-monospace, monospace; font-size: .8rem; }
.diff-table td { padding: 0 .4rem; white-space: pre; vertical-align: top; }
.diff-table .ln { color: #6b5d49; text-align: right; user-select: none; width: 1px; }
.diff-table tr.add .code { background: rgba(95,179,107,.16); }
.diff-table tr.del .code { background: rgba(210,85,63,.16); }
.diff-table tr.add .code::before { content: '+ '; color: #5fb36b; }
.diff-table tr.del .code::before { content: '- '; color: #d2553f; }
</style>
