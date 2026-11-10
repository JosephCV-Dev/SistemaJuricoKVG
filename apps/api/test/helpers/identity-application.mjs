import { PrivateFiles } from '../../dist/modules/documents/application/private-files.port.js';
import { KvgRpcService } from '../../dist/infrastructure/supabase/kvg-rpc.service.js';
import 'reflect-metadata';
import assert from 'node:assert/strict';
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
import { AppModule } from '../../dist/app.module.js';
import { configureApp } from '../../dist/configure-app.js';
import { validateEnvironment } from '../../dist/config/environment.js';
import {
  IdentityProvider,
  OperationalSession,
} from '../../dist/modules/identity/application/identity.ports.js';
import { RequirePermission } from '../../dist/modules/identity/presentation/access.decorators.js';
import { SERVER_SESSION_RUNTIME } from '../../dist/modules/identity/presentation/server-sessions.service.js';

// Estas pruebas ejercitan HTTP, DTO, cookies y guards reales con puertos locales.
// MemoryStore y los tokens siguientes solo existen en la prueba; no verifican
// Supabase Auth, MFA criptográfico ni la persistencia/cifrado de producción.
export const APP_ORIGIN = 'http://127.0.0.1:5173';
export const PASSWORD = 'password-only-for-local-http-tests';
export const MFA_CODE = '123456';
export const FACTOR_ID = '33333333-3333-4333-8333-333333333333';
export const AUTH_USER_ID = '11111111-1111-4111-8111-111111111111';
export const KVG_USER_ID = '22222222-2222-4222-8222-222222222222';

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

export async function application(t, options = {}) {
  const ports = localPorts();
  const builder = Test.createTestingModule({
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
    .useValue(testSessionRuntime());
  if (options.rpc)
    builder.overrideProvider(KvgRpcService).useValue(options.rpc);
  if (options.files)
    builder.overrideProvider(PrivateFiles).useValue(options.files);
  const module = await builder.compile();
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
  return { ...ports, browser, origin };
}

export function assertNoProviderTokens(body) {
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /local-private-|accessToken|refreshToken/);
}

export async function firstFactor(browser) {
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

export async function authenticated(browser) {
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
