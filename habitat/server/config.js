const num = (v, d) => (v == null || v === '' ? d : Number(v));

export default {
  PORT: num(process.env.MNONM_PORT, 8377),
  BIND: process.env.MNONM_BIND || '127.0.0.1',
  TOKEN: process.env.MNONM_TOKEN || '',
  PREVIEW_LINES: num(process.env.MNONM_PREVIEW_LINES, 30),
  MAX_CONTEXT: num(process.env.MNONM_MAX_CONTEXT, 200000),
};
