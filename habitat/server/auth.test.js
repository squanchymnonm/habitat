import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCookies, isAuthenticated, COOKIE_NAME } from './auth.js';

const fakeReq = ({ cookie, authorization, urlToken } = {}) => ({
  headers: { ...(cookie ? { cookie } : {}), ...(authorization ? { authorization } : {}) },
  url: `/x${urlToken ? `?token=${urlToken}` : ''}`,
});
const storeOf = (validId, user = 'nico') => ({
  validate: (id) => (id === validId ? { user } : null),
});

test('parseCookies parsea pares y trimea', () => {
  assert.deepEqual(parseCookies('a=1; habitat_session=xyz'), { a: '1', habitat_session: 'xyz' });
  assert.deepEqual(parseCookies(undefined), {});
});

test('cookie de sesión válida autentica', () => {
  const req = fakeReq({ cookie: `${COOKIE_NAME}=good` });
  assert.equal(isAuthenticated(req, { sessionStore: storeOf('good'), token: 'secret' }), true);
});

test('Bearer token correcto autentica', () => {
  const req = fakeReq({ authorization: 'Bearer secret' });
  assert.equal(isAuthenticated(req, { sessionStore: storeOf('none'), token: 'secret' }), true);
});

test('?token= correcto autentica (fallback)', () => {
  const req = fakeReq({ urlToken: 'secret' });
  assert.equal(isAuthenticated(req, { sessionStore: storeOf('none'), token: 'secret' }), true);
});

test('sin nada y con token configurado: rechaza', () => {
  const req = fakeReq({});
  assert.equal(isAuthenticated(req, { sessionStore: storeOf('none'), token: 'secret' }), false);
});

test('cookie inválida + Bearer malo: rechaza', () => {
  const req = fakeReq({ cookie: `${COOKIE_NAME}=bad`, authorization: 'Bearer nope' });
  assert.equal(isAuthenticated(req, { sessionStore: storeOf('good'), token: 'secret' }), false);
});

test('sin token configurado: libre (comportamiento actual)', () => {
  const req = fakeReq({});
  assert.equal(isAuthenticated(req, { sessionStore: storeOf('none'), token: '' }), true);
});
