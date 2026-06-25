# CLAUDE.md

Guía para trabajar en este repositorio.

## Flujo de trabajo Git (obligatorio)

### Antes de empezar a trabajar

Siempre actualizar el repositorio y traer `main` a la branch actual (o a la
nueva branch donde se vaya a trabajar), para hacer todos los cambios sobre
código actualizado:

```bash
git fetch origin
# si se arranca una branch nueva, partir de main actualizado:
#   git checkout main && git pull origin main && git checkout -b <nueva-branch>
# traer main a la branch de trabajo:
git merge origin/main   # (o git rebase origin/main)
```

Recién después de tener la branch al día con `main`, empezar los cambios.

### Antes de cerrar (terminar el trabajo)

Siempre, antes de cerrar:

1. Actualizar el repo y traer `main` a la branch actual:
   ```bash
   git fetch origin
   git merge origin/main
   ```
2. **Resolver los conflictos** que aparezcan y verificar que todo siga
   funcionando (tests / typecheck / build).
3. Pushear y **hacer el Pull Request**:
   ```bash
   git push origin <branch>
   gh pr create --base main --head <branch>
   ```

Nunca cerrar trabajo sin haber sincronizado con `main` primero.
