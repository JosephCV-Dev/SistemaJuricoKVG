import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  AuthRequestError,
  enrollMfa,
  getSession,
  login,
  logout,
  refreshSession,
  verifyMfa,
} from './identity-api.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function queueResponses(responses) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const next = responses.shift();
    assert.ok(next, `Petición inesperada: ${url}`);
    return next;
  };
  return calls;
}

const authenticated = {
  status: 'authenticated',
  user: { id: 'user-1', name: 'Usuario de prueba', roles: ['ABOGADO'] },
  expiresAt: '2026-10-28T22:00:00.000Z',
  idleTimeoutSeconds: 1800,
};

test('consulta la sesión con cookies del mismo origen y permite cancelarla', async () => {
  const calls = queueResponses([json({ status: 'anonymous' })]);
  const controller = new AbortController();

  assert.deepEqual(await getSession(controller.signal), {
    status: 'anonymous',
  });
  assert.equal(calls[0].url, '/api/v1/auth/session');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.signal, controller.signal);
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.headers.Authorization, undefined);
});

test('solicita un CSRF nuevo antes de cada mutación, incluso después de login', async () => {
  const calls = queueResponses([
    json({ csrfToken: 'csrf-inicial' }),
    json(authenticated),
    json({ csrfToken: 'csrf-rotado' }),
    json(authenticated),
  ]);
  const signal = new AbortController().signal;

  assert.deepEqual(
    await login(
      { email: 'prueba@example.test', password: 'clave-de-prueba' },
      signal,
    ),
    authenticated,
  );
  await refreshSession(signal);

  assert.deepEqual(
    calls.map((call) => call.url),
    [
      '/api/v1/auth/csrf',
      '/api/v1/auth/login',
      '/api/v1/auth/csrf',
      '/api/v1/auth/refresh',
    ],
  );
  assert.equal(calls[1].options.headers['X-CSRF-Token'], 'csrf-inicial');
  assert.equal(calls[3].options.headers['X-CSRF-Token'], 'csrf-rotado');
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    email: 'prueba@example.test',
    password: 'clave-de-prueba',
  });
  assert.ok(calls.every((call) => call.options.credentials === 'same-origin'));
  assert.ok(calls.every((call) => call.options.signal === signal));
});

test('no envía la mutación si el servidor no devuelve un CSRF válido', async () => {
  const calls = queueResponses([json({ csrfToken: '' })]);

  await assert.rejects(
    () => refreshSession(new AbortController().signal),
    /formato inesperado/,
  );
  assert.equal(calls.length, 1);
});

test('conserva el estado HTTP 401 para que la interfaz descarte la sesión', async () => {
  queueResponses([json({ message: 'La sesión venció.' }, 401)]);

  await assert.rejects(
    () => getSession(new AbortController().signal),
    (error) =>
      error instanceof AuthRequestError &&
      error.status === 401 &&
      error.message === 'La sesión venció.',
  );
});

test('rechaza un usuario o vencimiento mal formado y descarta campos extra', async () => {
  queueResponses([
    json({ ...authenticated, expiresAt: 'fecha inválida' }),
    json({
      ...authenticated,
      extra: 'no conservar',
      user: { ...authenticated.user, extra: true },
    }),
  ]);
  const signal = new AbortController().signal;

  await assert.rejects(() => getSession(signal), /formato inesperado/);
  assert.deepEqual(await getSession(signal), authenticated);
});

test('valida factores MFA y evita un estado sin factor ni opción de alta', async () => {
  const required = {
    status: 'mfa_required',
    factors: [{ id: 'factor-1', friendlyName: 'Aplicación' }],
    enrollmentRequired: false,
  };
  queueResponses([
    json(required),
    json({ status: 'mfa_required', factors: [], enrollmentRequired: false }),
    json({ ...required, factors: [required.factors[0], required.factors[0]] }),
  ]);
  const signal = new AbortController().signal;

  assert.deepEqual(await getSession(signal), required);
  await assert.rejects(() => getSession(signal), /formato inesperado/);
  await assert.rejects(() => getSession(signal), /formato inesperado/);
});

test('el alta y la verificación MFA usan el factor y código del contrato', async () => {
  const enrollment = {
    factorId: 'factor-1',
    qrCode: '<svg xmlns="http://www.w3.org/2000/svg" />',
    secret: 'CLAVE-FICTICIA',
  };
  const calls = queueResponses([
    json({ csrfToken: 'csrf-alta' }),
    json(enrollment),
    json({ csrfToken: 'csrf-verificacion' }),
    json(authenticated),
  ]);
  const signal = new AbortController().signal;

  assert.deepEqual(await enrollMfa(signal), enrollment);
  assert.deepEqual(
    await verifyMfa({ factorId: 'factor-1', code: '123456' }, signal),
    authenticated,
  );
  assert.equal(calls[1].url, '/api/v1/auth/mfa/enroll');
  assert.equal(calls[3].url, '/api/v1/auth/mfa/verify');
  assert.deepEqual(JSON.parse(calls[1].options.body), {});
  assert.deepEqual(JSON.parse(calls[3].options.body), {
    factorId: 'factor-1',
    code: '123456',
  });
});

test('logout acepta 204 sin intentar leer una respuesta JSON', async () => {
  const calls = queueResponses([
    json({ csrfToken: 'csrf-cierre' }),
    new Response(null, { status: 204 }),
  ]);

  await logout(new AbortController().signal);
  assert.equal(calls[1].url, '/api/v1/auth/logout');
  assert.equal(calls[1].options.headers['X-CSRF-Token'], 'csrf-cierre');
});

test('los fallos sin JSON muestran un error público genérico', async () => {
  queueResponses([new Response('Fallo interno sensible', { status: 500 })]);

  await assert.rejects(
    () => getSession(new AbortController().signal),
    (error) =>
      error instanceof AuthRequestError &&
      error.status === 500 &&
      !error.message.includes('sensible'),
  );
});
