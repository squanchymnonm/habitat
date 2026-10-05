import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stackName, scan, render } from './env-template.js';

test('stackName normaliza a las reglas de compose', () => {
  assert.equal(stackName('ARTISANO-BackEnd', 'feature/Login'), 'artisano-backend-feature-login');
  assert.equal(stackName('.proj', 'x'), 'proj-x');
  assert.equal(stackName('mi proj', 'b.1'), 'mi-proj-b-1');
});

test('scan junta puertos únicos y ordenados, y tokens desconocidos', () => {
  const t = 'A={{port:db}}\nB={{port:app}}\nC={{ port:db }}\nD={{path:front}}\nE={{nope}}\nF={{port:Mal}}';
  const r = scan(t, ['self', 'infra']);
  assert.deepEqual(r.ports, ['app', 'db']);
  assert.deepEqual(r.unknown, ['{{path:front}}', '{{nope}}', '{{port:Mal}}']);
});

test('render resuelve todas las variables', () => {
  const ctx = { stack: 's-b', branch: 'b', paths: { self: '/wt', infra: '/wt/.habitat-related/infra' }, ports: { app: 20001 } };
  const r = render('N={{stack}}\nP={{port:app}}\nQ={{port:app}}\nC={{path:self}}\nI={{path:infra}}\nB={{branch}}\nX=sin vars', ctx);
  assert.deepEqual(r, { ok: true, text: 'N=s-b\nP=20001\nQ=20001\nC=/wt\nI=/wt/.habitat-related/infra\nB=b\nX=sin vars' });
});

test('render rechaza desconocidas y puertos sin asignar', () => {
  const ctx = { stack: 's', branch: 'b', paths: { self: '/wt' }, ports: {} };
  assert.deepEqual(render('A={{path:front}}', ctx), { ok: false, unknown: ['{{path:front}}'] });
  assert.deepEqual(render('A={{port:db}}', ctx), { ok: false, unknown: ['{{port:db}}'] });
});
