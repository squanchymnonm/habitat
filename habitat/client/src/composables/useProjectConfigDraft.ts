import { computed, ref, type Ref } from 'vue'
import { useProjects } from './useProjects'
import type { Project, RelatedRepo, InfraConfig, EnvFile } from '../types'

// Borrador de la config de un proyecto (relacionados, infra y archivos .env), compartido
// por las pestañas que la editan. Se manda entero al guardar: el server valida la config
// completa. Arranca con una copia de lo que tiene el proyecto al crearse.
export function useProjectConfigDraft(project: Ref<Project>) {
  const { saveConfig } = useProjects()
  const p = project.value
  const related = ref<RelatedRepo[]>((p.related ?? []).map((r) => ({ ...r })))
  const infraRepo = ref(p.infra?.repo ?? '')
  const infraPath = ref(p.infra?.path ?? '')
  const infraUp = ref(p.infra?.up ?? '')
  const infraDown = ref(p.infra?.down ?? '')
  const envFiles = ref<EnvFile[]>((p.envFiles ?? []).map((e) => ({ ...e })))
  const saving = ref(false)
  const configError = ref('')
  const configOk = ref(false)

  // Estado del editor de .env (qué archivo está abierto, su texto y los mensajes).
  // Vive acá, no en ProjectEnvTab, para que cambiar de pestaña (que desmonta el
  // componente) no tire el texto que el usuario todavía no guardó.
  const editing = ref<EnvFile | null>(null)
  const envText = ref('')
  const envMsg = ref('')
  const envErr = ref('')

  const repoOptions = computed(() => ['self', ...related.value.map((r) => r.name)])
  const repoLabel = (r: string) => (r === 'self' ? 'este repo' : r)

  function draft(): { related: RelatedRepo[]; infra: InfraConfig | null; envFiles: EnvFile[] } {
    return {
      related: related.value,
      infra: infraRepo.value ? { repo: infraRepo.value, path: infraPath.value, up: infraUp.value, down: infraDown.value } : null,
      envFiles: envFiles.value,
    }
  }
  async function save() {
    saving.value = true
    configError.value = ''
    configOk.value = false
    const r = await saveConfig(project.value.dir, draft())
    saving.value = false
    if (r.ok) configOk.value = true
    else configError.value = r.error
  }

  return {
    related, infraRepo, infraPath, infraUp, infraDown, envFiles, repoOptions, repoLabel, save, saving, configError, configOk,
    editing, envText, envMsg, envErr,
  }
}

export type ProjectConfigDraft = ReturnType<typeof useProjectConfigDraft>
