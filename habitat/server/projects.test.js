import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync, writeFileSync } from 'node:fs';
import { createProjects, validateConfig, hasConfig } from './projects.js';
import { PALETTE } from './palette.js';

const tmpPath = (tag) => join(tmpdir(), `habitat-projects-${process.pid}-${tag}.json`);

test('seed: arranca con los dirs sembrados, label=basename, color de paleta, chars=[]', () => {
  const p = createProjects({ seed: ['/home/u/proj-api'] });
  const list = p.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].dir, '/home/u/proj-api');
  assert.equal(list[0].label, 'proj-api');
  assert.ok(PALETTE.includes(list[0].color));
  assert.deepEqual(list[0].chars, []);
});

test('add válido agrega y devuelve el record', () => {
  const p = createProjects();
  const r = p.add({ dir: '/x/web', color: PALETTE[0] });
  assert.equal(r.ok, true);
  assert.equal(r.record.label, 'web');
  assert.equal(r.record.color, PALETTE[0]);
  assert.deepEqual(r.record.chars, []);
  assert.equal(p.has('/x/web'), true);
});

test('add duplicado por dir -> ok:false', () => {
  const p = createProjects({ seed: ['/x/web'] });
  const r = p.add({ dir: '/x/web', color: PALETTE[0] });
  assert.equal(r.ok, false);
});

test('add con color fuera de paleta -> ok:false', () => {
  const p = createProjects();
  assert.equal(p.add({ dir: '/x/web', color: '#123456' }).ok, false);
});

test('add con char inválido -> ok:false', () => {
  const p = createProjects();
  assert.equal(p.add({ dir: '/x/web', color: PALETTE[0], chars: ['NoExiste'] }).ok, false);
});

test('add con chars válidos los guarda', () => {
  const p = createProjects();
  const r = p.add({ dir: '/x/web', color: PALETTE[0], chars: ['Knight', 'Monk'] });
  assert.deepEqual(r.record.chars, ['Knight', 'Monk']);
});

test('update edita solo los campos provistos', () => {
  const p = createProjects({ seed: ['/x/web'] });
  const r = p.update({ dir: '/x/web', color: PALETTE[2], label: 'Web App' });
  assert.equal(r.ok, true);
  assert.equal(r.record.color, PALETTE[2]);
  assert.equal(r.record.label, 'Web App');
  assert.deepEqual(r.record.chars, []);
});

test('update sobre dir inexistente -> ok:false', () => {
  const p = createProjects();
  assert.equal(p.update({ dir: '/no/existe', color: PALETTE[0] }).ok, false);
});

test('remove quita y devuelve true; segundo remove false', () => {
  const p = createProjects({ seed: ['/x/web'] });
  assert.equal(p.remove('/x/web'), true);
  assert.equal(p.has('/x/web'), false);
  assert.equal(p.remove('/x/web'), false);
});

test('persistencia: add escribe y un store nuevo recarga (sin re-seed)', () => {
  const path = tmpPath('reload');
  rmSync(path, { force: true });
  try {
    const a = createProjects({ persistPath: path, seed: ['/seed/one'] });
    a.add({ dir: '/x/web', color: PALETTE[0] });
    assert.ok(existsSync(path));
    // El seed NO debe re-aplicarse: el archivo ya existe, manda el disco.
    const b = createProjects({ persistPath: path, seed: ['/otro/dir'] });
    const dirs = b.list().map((r) => r.dir).sort();
    assert.deepEqual(dirs, ['/seed/one', '/x/web']);
  } finally {
    rmSync(path, { force: true });
  }
});

test('archivo corrupto arranca aplicando el seed', () => {
  const path = tmpPath('corrupt');
  rmSync(path, { force: true });
  try {
    writeFileSync(path, '{ no json');
    const p = createProjects({ persistPath: path, seed: ['/x/web'] });
    assert.equal(p.has('/x/web'), true);
  } finally {
    rmSync(path, { force: true });
  }
});

const CFG = {
  related: [{ dir: '/r/infra-repo', name: 'infra' }, { dir: '/r/front', name: 'front' }],
  infra: { repo: 'infra', path: 'docker', up: 'make up', down: '' },
  envFiles: [{ repo: 'self', path: '.env' }, { repo: 'infra', path: 'docker/.env' }],
};

test('validateConfig acepta una config completa y normaliza defaults', () => {
  const r = validateConfig(CFG, '/r/back');
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.infra, { repo: 'infra', path: 'docker', up: 'make up', down: '' });
  assert.deepEqual(validateConfig({}, '/r/back'), { ok: true, value: { related: [], infra: null, envFiles: [] } });
});

test('validateConfig rechaza lo inválido', () => {
  const bad = [
    { related: [{ dir: 'rel/x', name: 'a' }] },                                   // dir no absoluto
    { related: [{ dir: '/r/back', name: 'a' }] },                                 // el propio proyecto
    { related: [{ dir: '/r/x', name: 'self' }] },                                 // nombre reservado
    { related: [{ dir: '/r/x', name: '-a' }] },                                   // formato
    { related: [{ dir: '/r/x', name: 'a' }, { dir: '/r/y', name: 'a' }] },        // duplicado
    { infra: { repo: 'self', path: '../afuera' } },                               // escapa
    { infra: { repo: 'self', path: '/abs' } },                                    // absoluto
    { envFiles: [{ repo: 'self', path: '' }] },                                   // path vacío
    { envFiles: [{ repo: 'self', path: '.env' }, { repo: 'self', path: '.env' }] },// duplicado
  ];
  for (const c of bad) assert.equal(validateConfig(c, '/r/back').ok, false, JSON.stringify(c));
});

test('validateConfig lista las referencias colgantes', () => {
  const r = validateConfig({ related: [], infra: { repo: 'infra' }, envFiles: [{ repo: 'front', path: '.env' }] }, '/r/back');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'referencias a relacionados inexistentes: infra, front');
});

test('update con config la guarda, la persiste y la devuelve en list/get', () => {
  const path = tmpPath('cfg');
  rmSync(path, { force: true });
  try {
    const p = createProjects({ persistPath: path, seed: ['/r/back'] });
    const r = p.update({ dir: '/r/back', ...CFG });
    assert.equal(r.ok, true);
    assert.deepEqual(r.record.related, CFG.related);
    const again = createProjects({ persistPath: path });
    assert.deepEqual(again.get('/r/back').envFiles, CFG.envFiles);
    assert.equal(hasConfig(again.get('/r/back')), true);
    // update parcial: sólo color, la config se conserva
    p.update({ dir: '/r/back', color: PALETTE[1] });
    assert.deepEqual(p.get('/r/back').infra, { repo: 'infra', path: 'docker', up: 'make up', down: '' });
  } finally { rmSync(path, { force: true }); }
});

test('update con config inválida no cambia nada y devuelve el error', () => {
  const p = createProjects({ seed: ['/r/back'] });
  const r = p.update({ dir: '/r/back', envFiles: [{ repo: 'front', path: '.env' }] });
  assert.equal(r.ok, false);
  assert.match(r.error, /front/);
  assert.deepEqual(p.get('/r/back').envFiles, []);
  assert.equal(hasConfig(p.get('/r/back')), false);
  assert.equal(p.get('/nope'), null);
});
