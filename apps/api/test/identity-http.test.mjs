import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  APP_ORIGIN,
  application,
  firstFactor,
  authenticated,
  assertNoProviderTokens,
  PASSWORD,
  FACTOR_ID,
  KVG_USER_ID,
  AUTH_USER_ID,
  MFA_CODE,
} from './helpers/identity-application.mjs';

test('login exige origen y CSRF válidos antes de consultar las credenciales', async (t) => {
  const { browser, state } = await application(t);
  await browser.csrf();
  for (const headers of [
    {
      Origin: 'https://otra-pagina.example',
      'X-CSRF-Token': browser.csrfToken,
    },
    { Origin: APP_ORIGIN },
    { Origin: APP_ORIGIN, 'X-CSRF-Token': 'incorrecto' },
    { 'X-CSRF-Token': browser.csrfToken },
  ]) {
    const response = await browser.request('auth/login', {
      method: 'POST',
      body: { email: 'persona@example.test', password: PASSWORD },
      headers,
    });
    assert.equal(response.status, 403);
    assertNoProviderTokens(await response.json());
  }
  assert.equal(state.signIns.length, 0);
});

test('los DTO rechazan login inválido y campos de identidad no permitidos', async (t) => {
  const { browser, state } = await application(t);
  await browser.csrf();
  for (const body of [
    { email: 'correo-invalido', password: PASSWORD },
    { email: 'persona@example.test', password: '' },
    {
      email: 'persona@example.test',
      password: PASSWORD,
      role: 'ADMINISTRADOR',
    },
  ]) {
    const response = await browser.post('auth/login', body);
    assert.equal(response.status, 400);
    assertNoProviderTokens(await response.json());
  }
  assert.equal(state.signIns.length, 0);
});

test('el primer factor rota SID, protege la cookie y no habilita /auth/me', async (t) => {
  const { browser, state } = await application(t);
  const response = await firstFactor(browser);
  const cookie = response.headers.getSetCookie().join(';');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Path=\//);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(state.signIns, [
    { email: 'persona@example.test', password: PASSWORD },
  ]);
  const pendingCookie = browser.cookie;
  const me = await browser.request('auth/me');
  assert.equal(me.status, 401);
  assertNoProviderTokens(await me.json());
  assert.equal(state.starts, 0);
  assert.equal(browser.cookie, pendingCookie);
  const pendingState = await browser.request('auth/session');
  assert.equal(pendingState.status, 200);
  assert.equal((await pendingState.json()).status, 'mfa_required');
});

test('credenciales rechazadas no crean una sesión autenticada ni devuelven secretos', async (t) => {
  const { browser, state } = await application(t);
  await browser.csrf();
  const rejected = await browser.post('auth/login', {
    email: 'persona@example.test',
    password: 'password-incorrect-only-for-tests',
  });
  assert.equal(rejected.status, 401);
  assertNoProviderTokens(await rejected.json());
  const current = await browser.request('auth/session');
  assert.deepEqual(await current.json(), { status: 'anonymous' });
  assert.equal(state.starts, 0);
});

test('los intentos repetidos de acceso se limitan antes de llamar al proveedor', async (t) => {
  const { browser, state } = await application(t);
  await browser.csrf();
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await browser.post('auth/login', {
      email: 'persona@example.test',
      password: 'password-incorrect-only-for-tests',
    });
    assert.equal(response.status, 401);
    await response.json();
  }
  const limited = await browser.post('auth/login', {
    email: 'persona@example.test',
    password: PASSWORD,
  });
  assert.equal(limited.status, 429);
  assertNoProviderTokens(await limited.json());
  assert.equal(state.signIns.length, 10);
  assert.equal(state.starts, 0);
});

test('un código MFA rechazado conserva el desafío para volver a verificarlo', async (t) => {
  const { browser, state } = await application(t);
  await firstFactor(browser);
  await browser.csrf();
  const enrollment = await browser.post('auth/mfa/enroll');
  assert.equal(enrollment.status, 200);
  await enrollment.json();
  const pendingCookie = browser.cookie;
  const rejected = await browser.post('auth/mfa/verify', {
    factorId: FACTOR_ID,
    code: '000000',
  });
  assert.equal(rejected.status, 400);
  assertNoProviderTokens(await rejected.json());
  assert.equal(browser.cookie, pendingCookie);
  assert.equal(state.starts, 0);
  const accepted = await browser.post('auth/mfa/verify', {
    factorId: FACTOR_ID,
    code: MFA_CODE,
  });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).status, 'authenticated');
  assert.equal(state.starts, 1);
});

test('inscripción y verificación MFA habilitan contexto; renovación y cierre invalidan la cookie anterior', async (t) => {
  const { browser, state } = await application(t);
  await authenticated(browser);
  assert.equal(state.starts, 1);
  const me = await browser.request('auth/me');
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), {
    id: KVG_USER_ID,
    name: 'Persona de prueba',
    roles: ['SECRETARIA'],
  });

  for (const path of ['auth/refresh', 'auth/logout']) {
    const rejected = await browser.post(path, {}, { 'X-CSRF-Token': '' });
    assert.equal(rejected.status, 403);
    assertNoProviderTokens(await rejected.json());
  }
  assert.equal(state.refreshes, 0);
  assert.equal(state.closes, 0);
  const refresh = await browser.post('auth/refresh');
  assert.equal(refresh.status, 200);
  assertNoProviderTokens(await refresh.json());
  assert.equal(state.refreshes, 1);

  const oldCookie = browser.cookie;
  const logout = await browser.post('auth/logout');
  assert.equal(logout.status, 204);
  assert.equal(await logout.text(), '');
  assert.equal(state.closes, 1);
  assert.equal(state.signOuts, 1);
  const replay = await browser.request('auth/me', {
    headers: { Cookie: oldCookie },
  });
  assert.equal(replay.status, 401);
  assertNoProviderTokens(await replay.json());
});

test('dos renovaciones con la misma cookie se serializan y recargan el token guardado', async (t) => {
  const { browser, state } = await application(t);
  await authenticated(browser);
  const responses = await Promise.all([
    browser.post('auth/refresh'),
    browser.post('auth/refresh'),
  ]);
  for (const response of responses) {
    assert.equal(response.status, 200);
    assertNoProviderTokens(await response.json());
  }
  assert.equal(state.refreshes, 2);
});

test('un fallo temporal posterior a renovar conserva la cookie y el token nuevo para reintentar', async (t) => {
  const { browser, state } = await application(t);
  await authenticated(browser);
  const cookie = browser.cookie;
  state.identityUnavailable = true;
  const unavailable = await browser.post('auth/refresh');
  assert.equal(unavailable.status, 503);
  assertNoProviderTokens(await unavailable.json());
  assert.equal(browser.cookie, cookie);
  const meUnavailable = await browser.request('auth/me');
  assert.equal(meUnavailable.status, 503);
  await meUnavailable.json();
  assert.equal(browser.cookie, cookie);

  state.identityUnavailable = false;
  const retry = await browser.post('auth/refresh');
  assert.equal(retry.status, 200);
  assertNoProviderTokens(await retry.json());
  assert.equal(state.refreshes, 2);
  assert.equal((await browser.request('auth/me')).status, 200);
});

for (const [description, revoke] of [
  ['cuenta desactivada', (state) => (state.active = false)],
  ['sesión KVG revocada', (state) => (state.revoked = true)],
  [
    'sesión KVG vencida',
    (state) => (state.expiresAt = new Date(Date.now() - 1_000).toISOString()),
  ],
]) {
  test(`la siguiente petición privada rechaza una ${description}`, async (t) => {
    const { browser, state } = await application(t);
    await authenticated(browser);
    revoke(state);
    const response = await browser.request('auth/me');
    assert.equal(response.status, 401);
    assertNoProviderTokens(await response.json());
    const sessionState = await browser.request('auth/session');
    assert.deepEqual(await sessionState.json(), { status: 'anonymous' });
  });
}

test('el guard aplica permiso y contexto actuales y deniega rutas privadas sin política', async (t) => {
  const { browser, state } = await application(t);
  await authenticated(browser);
  const allowed = await browser.request('test-identity-policy/allowed');
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { allowed: true });
  for (const path of ['different-context', 'without-policy']) {
    const response = await browser.request(`test-identity-policy/${path}`);
    assert.equal(response.status, 403);
    assertNoProviderTokens(await response.json());
  }
  state.capabilities = [];
  const revoked = await browser.request('test-identity-policy/allowed');
  assert.equal(revoked.status, 403);
});
