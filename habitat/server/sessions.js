import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const DEFAULT_TTL = 86_400_000; // 1 día

// Store de sesiones de login, respaldado en disco con escritura atómica (igual que
// settings.js/state.js) para sobrevivir reinicios del server (KillMode=process).
export function createSessionStore({ persistPath, ttlMs = DEFAULT_TTL, now = Date.now } = {}) {
  // id -> { user, expiresAt }
  const sessions = new Map();

  if (persistPath) {
    try {
      const parsed = JSON.parse(readFileSync(persistPath, 'utf8'));
      const t = now();
      for (const [id, v] of Object.entries(parsed)) {
        if (v && typeof v.user === 'string' && typeof v.expiresAt === 'number' && v.expiresAt > t) {
          sessions.set(id, { user: v.user, expiresAt: v.expiresAt });
        }
      }
    } catch { /* sin archivo o corrupto: arrancamos vacío */ }
  }

  function persist() {
    if (!persistPath) return;
    const obj = {};
    for (const [id, v] of sessions) obj[id] = v;
    const tmp = `${persistPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(obj));
    renameSync(tmp, persistPath);
  }

  return {
    ttlMs,
    create(user) {
      const id = randomBytes(32).toString('base64url');
      sessions.set(id, { user, expiresAt: now() + ttlMs });
      persist();
      return id;
    },
    validate(id) {
      const v = sessions.get(id);
      if (!v) return null;
      if (v.expiresAt <= now()) { sessions.delete(id); persist(); return null; }
      v.expiresAt = now() + ttlMs; // renovación deslizante
      persist();
      return { user: v.user };
    },
    destroy(id) {
      if (sessions.delete(id)) persist();
    },
  };
}
