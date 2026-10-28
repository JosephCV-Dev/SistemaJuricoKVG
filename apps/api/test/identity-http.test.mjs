import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BadRequestException,
  Controller,
  Get,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import session from 'express-session';
import { AppModule } from '../dist/app.module.js';
import { configureApp } from '../dist/configure-app.js';
import { validateEnvironment } from '../dist/config/environment.js';
import {
  IdentityProvider,
  OperationalSession,
} from '../dist/modules/identity/application/identity.ports.js';
import { RequirePermission } from '../dist/modules/identity/presentation/access.decorators.js';
import { SERVER_SESSION_RUNTIME } from '../dist/modules/identity/presentation/server-sessions.service.js';

// Estas pruebas ejercitan HTTP, DTO, cookies y guards reales con puertos locales.
// MemoryStore y los tokens siguientes solo existen en la prueba; no verifican
// Supabase Auth, MFA criptográfico ni la persistencia/cifrado de producción.
const APP_ORIGIN = 'http://127.0.0.1:5173';
const PASSWORD = 'password-only-for-local-http-tests';
const MFA_CODE = '123456';
const FACTOR_ID = '33333333-3333-4333-8333-333333333333';
const AUTH_USER_ID = '11111111-1111-4111-8111-111111111111';
const KVG_USER_ID = '22222222-2222-4222-8222-222222222222';

class PolicyProbeController {
  allowed() {
    return { allowed: true };
  }

  differentContext() {
    return { allowed: true };
  }

  withoutPolicy() {
    return { allowed: true };
  }
}
Controller('test-identity-policy')(PolicyProbeController);
for (const [method, path, context] of [
  ['allowed', 'allowed', 'GLOBAL_OPERATIVO'],
  ['differentContext', 'different-context', 'PRINCIPAL'],
  ['withoutPolicy', 'without-policy', undefined],
]) {
  const descriptor = Object.getOwnPropertyDescriptor(
    PolicyProbeController.prototype,
    method,
  );
  Get(path)(PolicyProbeController.prototype, method, descriptor);
  if (context) {
    RequirePermission('cliente.registrar', context)(
      PolicyProbeController.prototype,
      method,
      descriptor,
    );
  }
}

function localPorts() {
  const state = {
    active: true,
    revoked: false,
    started: false,
    factorVerified: false,
    capabilities: [
      {
        permission: 'cliente.registrar',
        context: 'GLOBAL_OPERATIVO',
        requiresMfa: true,
        requiresDecision: false,
      },
    ],
    expiresAt: new Date(Date.now() + 8 * 60 * 60_000).toISOString(),
    signIns: [],
    refreshes: 0,
    starts: 0,
    closes: 0,
    signOuts: 0,
    identityUnavailable: false,
  };
  let sequence = 0;
  const usedRefreshTokens = new Set();
  const signedOutAccessTokens = new Set();
  const tokens = (aal) => ({
    accessToken: `local-private-${aal}-access-${++sequence}`,
    refreshToken: `local-private-${aal}-refresh-${sequence}`,
    expiresAt: Date.now() + 60 * 60_000,
    authUserId: AUTH_USER_ID,
  });
  const requireActive = (authentication) => {
    if (
      !state.active ||
      signedOutAccessTokens.has(authentication.accessToken)
    ) {
      throw new UnauthorizedException('La identidad ya no está activa.');
    }
  };
  const provider = {
    async signIn(email, password) {
      state.signIns.push({ email, password });
      if (email !== 'persona@example.test' || password !== PASSWORD) {
        throw new UnauthorizedException('Credenciales no válidas.');
      }
      return tokens('aal1');
    },
    async refresh(authentication) {
      requireActive(authentication);
      if (usedRefreshTokens.has(authentication.refreshToken)) {
        throw new UnauthorizedException('El token ya fue renovado.');
      }
      usedRefreshTokens.add(authentication.refreshToken);
      state.refreshes++;
      // Una renovación concurrente debe recargar la sesión guardada por la otra.
      await new Promise((resolve) => setImmediate(resolve));
      return tokens(
        authentication.accessToken.includes('aal2') ? 'aal2' : 'aal1',
      );
    },
    async verifyIdentity(authentication) {
      if (state.identityUnavailable)
        throw new ServiceUnavailableException('Auth no está disponible.');
      requireActive(authentication);
    },
    async factors(authentication) {
      requireActive(authentication);
      return {
        tokens: authentication,
        factors: state.factorVerified
          ? [{ id: FACTOR_ID, friendlyName: 'Factor de prueba local' }]
          : [],
      };
    },
    async enroll(authentication) {
      requireActive(authentication);
      return {
        tokens: authentication,
        factorId: FACTOR_ID,
        qrCode: '<svg aria-label="Factor de prueba"></svg>',
        secret: 'JBSWY3DPEHPK3PXP',
      };
    },
    async verifyMfa(authentication, factorId, code) {
      requireActive(authentication);
      if (factorId !== FACTOR_ID || code !== MFA_CODE) {
        throw new BadRequestException('El código no es válido.');
      }
      state.factorVerified = true;
      return tokens('aal2');
    },
    async signOut(authentication) {
      state.signOuts++;
      signedOutAccessTokens.add(authentication.accessToken);
    },
  };
  const operational = {
    async start(accessToken) {
      assert.match(accessToken, /aal2/);
      state.started = true;
      state.starts++;
    },
    async current(accessToken) {
      assert.match(accessToken, /aal2/);
      if (
        !state.started ||
        state.revoked ||
        Date.parse(state.expiresAt) <= Date.now()
      ) {
        throw new UnauthorizedException('La sesión operativa no está vigente.');
      }
      return {
        user: {
          id: KVG_USER_ID,
          name: 'Persona de prueba',
          roles: ['SECRETARIA'],
        },
        capabilities: structuredClone(state.capabilities),
        expiresAt: state.expiresAt,
        idleTimeoutSeconds: 1800,
      };
    },
    async close() {
      state.closes++;
      state.revoked = true;
    },
  };
  return { state, provider, operational };
}

function testSessionRuntime() {
  const store = new session.MemoryStore();
  const pending = new Map();
  store.withLock = async (sid, action) => {
    const previous = pending.get(sid) ?? Promise.resolve();
    let release;
    const barrier = new Promise((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => barrier);
    pending.set(sid, tail);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (pending.get(sid) === tail) pending.delete(sid);
    }
  };
  store.close = async () => {};
  return {
    cookieName: 'kvg.sid',
    store,
    middleware: session({
      store,
      name: 'kvg.sid',
      secret: 'session-secret-only-for-local-http-tests',
      resave: false,
      saveUninitialized: false,
      cookie: {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: 10 * 60_000,
      },
    }),
  };
}

async function application(t) {
  const ports = localPorts();
  const module = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [PolicyProbeController],
  })
    .overrideProvider(ConfigService)
    .useValue(
      new ConfigService(validateEnvironment({ NODE_ENV: 'test', APP_ORIGIN })),
    )
    .overrideProvider(IdentityProvider)
    .useValue(ports.provider)
    .overrideProvider(OperationalSession)
    .useValue(ports.operational)
    .overrideProvider(SERVER_SESSION_RUNTIME)
    .useValue(testSessionRuntime())
    .compile();
  const app = module.createNestApplication({
    logger: false,
    abortOnError: false,
  });
  configureApp(app);
  t.after(() => app.close());
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const browser = {
    cookie: '',
    csrfToken: '',
    async request(path, { method = 'GET', body, headers = {} } = {}) {
      const response = await fetch(`${origin}/api/v1/${path}`, {
        method,
        headers: {
          ...(this.cookie ? { Cookie: this.cookie } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const setCookie = response.headers
        .getSetCookie()
        .find((value) => value.startsWith('kvg.sid='));
      if (setCookie) this.cookie = setCookie.split(';')[0];
      return response;
    },
    async csrf() {
      const response = await this.request('auth/csrf');
      assert.equal(response.status, 200);
      this.csrfToken = (await response.json()).csrfToken;
      assert.match(this.csrfToken, /^[A-Za-z0-9_-]{43}$/);
      return response;
    },
    post(path, body = {}, headers = {}) {
      return this.request(path, {
        method: 'POST',
        body,
        headers: {
          Origin: APP_ORIGIN,
          'X-CSRF-Token': this.csrfToken,
          ...headers,
        },
      });
    },
  };
  return { ...ports, browser };
}

function assertNoProviderTokens(body) {
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /local-private-|accessToken|refreshToken/);
}

async function firstFactor(browser) {
  await browser.csrf();
  const previousCookie = browser.cookie;
  const response = await browser.post('auth/login', {
    email: '  Persona@Example.Test  ',
    password: PASSWORD,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    status: 'mfa_required',
    factors: [],
    enrollmentRequired: true,
  });
  assertNoProviderTokens(body);
  assert.notEqual(browser.cookie, previousCookie);
  return response;
}

async function authenticated(browser) {
  await firstFactor(browser);
  await browser.csrf();
  const enrollment = await browser.post('auth/mfa/enroll');
  assert.equal(enrollment.status, 200);
  const enrolled = await enrollment.json();
  assert.equal(enrolled.factorId, FACTOR_ID);
  assert.equal(typeof enrolled.qrCode, 'string');
  assert.equal(typeof enrolled.secret, 'string');
  assertNoProviderTokens(enrolled);
  const previousCookie = browser.cookie;
  const response = await browser.post('auth/mfa/verify', {
    factorId: FACTOR_ID,
    code: MFA_CODE,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'authenticated');
  assert.equal(body.user.id, KVG_USER_ID);
  assert.notEqual(body.user.id, AUTH_USER_ID);
  assert.equal(body.idleTimeoutSeconds, 1800);
  assertNoProviderTokens(body);
  assert.notEqual(browser.cookie, previousCookie);
  await browser.csrf();
  return body;
}

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
