import { readFileSync } from 'node:fs';

export function readUsage(transcriptPath) {
  let raw;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }
  let total = 0;
  let lastContext = null;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'assistant') continue;
    const u = obj.message && obj.message.usage;
    if (!u) continue;
    const inp = u.input_tokens || 0;
    const out = u.output_tokens || 0;
    const cc = u.cache_creation_input_tokens || 0;
    const cr = u.cache_read_input_tokens || 0;
    total += inp + out + cc;
    lastContext = inp + cr + cc;
  }
  if (lastContext === null) return null;
  return { contextTokens: lastContext, totalTokens: total };
}
