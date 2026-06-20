# MNONMAgents — Hábitat · Capa RPG "dungeon" (addendum al Spec Fase 1)

> Extiende `spec-habitat-fase1.md`. Agrega campos al contrato (§5) y entradas al
> mapeo de hooks (§6.3), más una capa visual de combate. Lo que se muestra es
> **telemetría real disfrazada de combate** (context, tokens, progreso), no adorno.

## A. Concepto

Cada sesión es un **héroe recorriendo una dungeon**:

- **Quest** = el pedido actual -> la **lista de todos** del agente (`TodoWrite`).
- **Dungeon** = la secuencia de todos. **Cada todo = un monstruo**, de a uno,
  con contador `done/total`.
- **Último todo = BOSS**. En el ciclo superpowers cae en la **review final** ->
  el boss fight = pasar la review.
- **Stamina del héroe = context window restante**. Atacar/trabajar **gasta
  stamina**; al agotarse, el héroe **descansa = compacta** y se recupera. El
  héroe **no tiene vida que perder** (nunca muere; solo se cansa).
- El monstruo **no tiene barra**: su HP va oculto (RPG viejo) y se revela al final.

## B. Campos que se agregan al contrato (§5)

```ts
interface Session {
  // ...campos de Fase 1...
  stamina: number;         // 0..100 = context restante (barra del HÉROE)
  quest?: { total: number; done: number };
  monster?: {
    type: string;          // hash del texto del todo (variedad)
    isBoss: boolean;
    label: string;         // texto del todo en curso
    // sin barra: el HP del monstruo (= tokens) va oculto
  } | null;
  combat?: {               // acumulado del todo en curso
    hits: number;          // golpes dados (tool-uses) — dato secundario
    tokens: number;        // tokens gastados = HP (oculto) del monstruo
    lastDamage?: number;   // tokens del último golpe (número flotante)
  };
}
```

Mensaje WS al vencer un monstruo (fin de cada todo):

```jsonc
{ "type": "fightResult", "id": "…", "result": {
    "monster": "<label del todo>",
    "hp": 18450,             // = tokens que costó (HP del monstruo)
    "hits": 7,               // secundario: en cuántos golpes cayó
    "loot": ["src/Auth.php", "tests/AuthTest.php"]   // entregable del todo
}}
```

## C. Mapeo de hooks -> mecánica (extiende §6.3)

| Señal de hook | Efecto |
|---|---|
| `PostToolUse` matcher `TodoWrite` | `quest.total/done`. El todo `in_progress` define el monstruo (`type` por hash del texto, `label`, `isBoss = índice===total-1`). |
| Todo recién *completed* | **fin de pelea**: emitir `fightResult` con `hp = combat.tokens`, `hits = combat.hits`, `loot` = archivos tocados durante ese todo (Write/Edit/MultiEdit; si no, el texto del todo). Resetear `combat`. Aparece el próximo monstruo. |
| `PreToolUse`/`PostToolUse` (otras tools) con un todo en curso | **golpe**: `combat.hits++`; `damage` = tokens del paso (= **delta de uso de tokens del transcript**); `combat.tokens += damage`; número de daño flotante. Además **baja la `stamina`** del héroe (atacar cansa). |
| `StopFailure` / error de tool | **el monstruo golpea al héroe** (recula/flash). El héroe **no muere** (no hay barra de vida). |
| `PreCompact` | héroe **agotado** (stamina ~0): se sienta a **descansar**. |
| Fin de compactación | `stamina` **repuesta** (descansado). |
| `Notification` | `waiting`: el héroe se gira al jugador; batalla en pausa. |
| `Stop` con `done == total` | dungeon cleared -> `done` (cae el boss). |
| `SessionEnd` | `offline`. |

## D. Render por estado (capa visual del pod)

- **working** -> batalla: héroe (pose `Attack` <-> idle) vs monstruo, **sin barra
  de monstruo**. Al golpear, **número de daño flotante = tokens del paso**, y baja
  la **barra de STAMINA (context)** del héroe. Contador `done/total`. Boss = más grande.
- **fin de cada pelea** -> cartel breve de **loot/resumen**: monstruo vencido,
  **HP = tokens que costó**, en cuántos golpes, y el loot (entregable).
- **stamina agotada** (`PreCompact`) -> el héroe descansa; al compactar, recupera.
- **waiting** -> el héroe se gira al jugador + globo; batalla en pausa.
- **error** -> el monstruo golpea al héroe (recula/flash); sigue en pie.
- **idle** (sin quest) -> campamento: héroe en `Idle`, sin monstruo.
- **done** -> dungeon cleared: el boss cae, héroe en victoria.
- **offline** -> gris, pausado.

## E. Assets

- Monstruos del pack (66 en `Actor/Monster`: BlueBat, Flam, Kappa, slimes, etc.).
- Bosses en `Actor/Boss` (GiantFrog, GiantSlime, DemonCyclop, Tengu, etc.),
  con animaciones propias y de mayor tamaño.
- Monstruo por **hash del texto del todo**. **Héroe** = personaje de la sesión;
  pose `Attack` para pelear.

## F. Honestidad / caveats (defaults a vetar)

- **Daño = tokens por golpe**: el costo de tokens de una tool puntual no es nativo;
  lo fiel es el **delta de uso de tokens del transcript** entre golpes. Aproximado;
  confirmar formato del transcript.
- **HP del monstruo = tokens que costó** (suma del daño), revelado al final.
- **Loot / entregable**: archivos tocados durante el todo (hooks Write/Edit); si no
  hubo cambios, el texto del todo.
- **Stamina del héroe** (context) fina es aproximada; el ancla dura es `PreCompact`
  (agotado) y el fin de compactación (descansado).

## G. Alcance y orden

- **Fase 1 (P0):** capturar los datos (`stamina`, `quest`, `monster`, `combat`) y
  enganchar `TodoWrite` y `PreCompact`. El mirador básico es lo primero.
- **Fase 1.5 / P1:** escena de batalla completa (poses, números de daño, cartel de
  loot, boss) + lectura del transcript para tokens. Capa **sobre** el mirador.

## H. Referencias

- Hooks + formato del transcript para usage:
  https://docs.claude.com/en/docs/claude-code/hooks
- Spec base: `spec-habitat-fase1.md` (§5 contrato, §6.3 hooks).
