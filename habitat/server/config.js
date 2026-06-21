const num = (v, d) => (v == null || v === '' ? d : Number(v));
const bool = (v) => v === '1' || v === 'true';
const list = (v) => (v ? String(v).split(':').map((s) => s.trim()).filter(Boolean) : []);

export default {
  PORT: num(process.env.MNONM_PORT, 8377),
  BIND: process.env.MNONM_BIND || '127.0.0.1',
  TOKEN: process.env.MNONM_TOKEN || '',
  PREVIEW_LINES: num(process.env.MNONM_PREVIEW_LINES, 30),
  MAX_CONTEXT: num(process.env.MNONM_MAX_CONTEXT, 200000),
  ALLOW_SPAWN: bool(process.env.MNONM_ALLOW_SPAWN),
  PROJECTS: list(process.env.MNONM_PROJECTS),
};
