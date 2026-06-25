import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readUsage, readLastAssistantText } from './transcript.js';

const here = dirname(fileURLToPath(import.meta.url));
const sample = join(here, 'fixtures', 'transcript-sample.jsonl');

test('readUsage: contextTokens del último turno', () => {
  const u = readUsage(sample);
  // último turno: 300 + 1500 + 10
  assert.equal(u.contextTokens, 1810);
});

test('readUsage: totalTokens acumulado (in+out+cache_creation, sin cache_read)', () => {
  const u = readUsage(sample);
  // (100+20+50) + (200+80+0) + (300+40+10) = 170 + 280 + 350
  assert.equal(u.totalTokens, 800);
});

test('readUsage: archivo inexistente devuelve null', () => {
  assert.equal(readUsage('/no/existe.jsonl'), null);
});

function fixture(lines) {
  const p = join(tmpdir(), `qb-transcript-${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n'));
  return p;
}

test('readLastAssistantText devuelve el último texto de asistente', () => {
  const p = fixture([
    { type: 'user', message: { content: [{ type: 'text', text: 'hola' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'primer plan' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'segundo plan' }, { type: 'tool_use', name: 'X' }] } },
  ]);
  assert.equal(readLastAssistantText(p), 'segundo plan');
  rmSync(p);
});

test('readLastAssistantText trunca a 400', () => {
  const p = fixture([{ type: 'assistant', message: { content: [{ type: 'text', text: 'z'.repeat(500) }] } }]);
  assert.equal(readLastAssistantText(p).length, 400);
  rmSync(p);
});

test('readLastAssistantText respeta el parámetro max', () => {
  const p = fixture([{ type: 'assistant', message: { content: [{ type: 'text', text: 'z'.repeat(800) }] } }]);
  assert.equal(readLastAssistantText(p, 600).length, 600);
  assert.equal(readLastAssistantText(p).length, 400); // default sin cambios
  rmSync(p);
});

test('readLastAssistantText devuelve "" si no hay texto de asistente', () => {
  const p = fixture([{ type: 'user', message: { content: [{ type: 'text', text: 'solo user' }] } }]);
  assert.equal(readLastAssistantText(p), '');
  rmSync(p);
});

test('readLastAssistantText devuelve "" si el archivo no existe', () => {
  assert.equal(readLastAssistantText('/no/existe/transcript.jsonl'), '');
});
