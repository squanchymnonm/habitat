import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readUsage } from './transcript.js';

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
