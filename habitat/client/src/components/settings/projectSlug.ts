// Identificador del proyecto en la URL: el último segmento de su carpeta (único
// dentro de PROJECTS_ROOT). El label lo elige el usuario y puede repetirse.
export function projectSlug(dir: string): string {
  return dir.split('/').filter(Boolean).pop() ?? dir
}
