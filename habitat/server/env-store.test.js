import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, chmodSync, rmSync, statSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEnvStore } from './env-store.js';

test('env-store en disco: set/get con 0600 y carpeta 0700, path con / codificado', () => {
  const base = mkdtempSync(join(tmpdir(), 'habitat-envs-'));
  const dir = join(base, 'envs');
  try {
    const s = createEnvStore({ dir });
    assert.equal(s.get('back', 'self', '.env'), '');
    s.set('back', 'infra', 'docker/.env', 'A=1\n');
    assert.equal(s.get('back', 'infra', 'docker/.env'), 'A=1\n');
    assert.deepEqual(readdirSync(join(dir, 'back')), ['infra@docker%2F.env.env']);
    assert.equal(statSync(join(dir, 'back', 'infra@docker%2F.env.env')).mode & 0o777, 0o600);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    s.remove('back', 'infra', 'docker/.env');
    assert.equal(s.get('back', 'infra', 'docker/.env'), '');
    s.set('back', 'self', '.env', 'B=2');
    s.removeProject('back');
    assert.equal(existsSync(join(dir, 'back')), false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('env-store en disco: repo y path no colisionan en el nombre de archivo', () => {
  const base = mkdtempSync(join(tmpdir(), 'habitat-envs-'));
  try {
    const s = createEnvStore({ dir: join(base, 'envs') });
    s.set('back', 'a__b', 'c', 'UNO');
    s.set('back', 'a', 'b__c', 'DOS');
    assert.equal(s.get('back', 'a__b', 'c'), 'UNO');
    assert.equal(s.get('back', 'a', 'b__c'), 'DOS');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('env-store en disco: ajusta a 0700 una carpeta que ya existía con otros permisos', () => {
  const base = mkdtempSync(join(tmpdir(), 'habitat-envs-'));
  const dir = join(base, 'envs');
  try {
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755);
    createEnvStore({ dir }).set('back', 'self', '.env', 'A=1');
    assert.equal(statSync(dir).mode & 0o777, 0o700);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('env-store sin dir funciona en memoria', () => {
  const s = createEnvStore();
  s.set('p', 'self', '.env', 'X=1');
  assert.equal(s.get('p', 'self', '.env'), 'X=1');
  s.removeProject('p');
  assert.equal(s.get('p', 'self', '.env'), '');
});
