import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const num = (v, d) => (v == null || v === '' ? d : Number(v));
const bool = (v) => v === '1' || v === 'true';
const list = (v) => (v ? String(v).split(':').map((s) => s.trim()).filter(Boolean) : []);

const HERE = dirname(fileURLToPath(import.meta.url));

export default {
  PORT: num(process.env.HABITAT_PORT, 8377),
  BIND: process.env.HABITAT_BIND || '127.0.0.1',
  TOKEN: process.env.HABITAT_TOKEN || '',
  PREVIEW_LINES: num(process.env.HABITAT_PREVIEW_LINES, 30),
  ALLOW_SPAWN: bool(process.env.HABITAT_ALLOW_SPAWN),
  PROJECTS: list(process.env.HABITAT_PROJECTS),
  WORKTREES_DIR: process.env.HABITAT_WORKTREES_DIR || join(homedir(), 'habitat-worktrees'),
  PROJECTS_ROOT: process.env.HABITAT_PROJECTS_ROOT || '',
  PROJECTS_STATE: process.env.HABITAT_PROJECTS_STATE || join(HERE, '..', '.projects.json'),
  STATE_PATH: process.env.HABITAT_STATE || join(HERE, '..', '.state.json'),
  SETTINGS_PATH: process.env.HABITAT_SETTINGS || join(HERE, '..', '.settings.json'),
  UPLOAD_PASSWORD: process.env.HABITAT_UPLOAD_PASSWORD || '',
  UPLOAD_MAX_BYTES: num(process.env.HABITAT_UPLOAD_MAX_BYTES, 25 * 1024 * 1024),
  USER: process.env.HABITAT_USER || '',
  PASSWORD_HASH: process.env.HABITAT_PASSWORD_HASH || '',
  SESSION_TTL_MS: num(process.env.HABITAT_SESSION_TTL_MS, 86_400_000),
  COOKIE_SECURE: process.env.HABITAT_COOKIE_SECURE == null ? true : bool(process.env.HABITAT_COOKIE_SECURE),
  SESSIONS_PATH: process.env.HABITAT_SESSIONS || join(HERE, '..', '.sessions.json'),
};
