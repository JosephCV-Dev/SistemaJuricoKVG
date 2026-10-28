import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import session from 'express-session';
import { AppModule } from '../dist/app.module.js';
import { configureApp } from '../dist/configure-app.js';
import { validateEnvironment } from '../dist/config/environment.js';
import {
  IdentityProvider,
  OperationalSession,
} from '../dist/modules/identity/application/identity.ports.js';
import { SupabaseIdentityProvider } from '../dist/modules/identity/infrastructure/supabase-identity.provider.js';
import { SERVER_SESSION_RUNTIME } from '../dist/modules/identity/presentation/server-sessions.service.js';

const AUTH_USER_ID = '11111111-1111-4111-8111-111111111111';
const FACTOR_ID = '33333333-3333-4333-8333-333333333333';
const PRIVATE_UPSTREAM_MESSAGE = 'private-provider-detail-must-not-escape';

function providerTokens(exp = Math.floor(Date.now() / 1000) + 3600) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    accessToken: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: AUTH_USER_ID, exp })}.c2lnbmF0dXJl`,
    refreshToken: 'private-refresh-only-for-local-tests',
    expiresAt: exp * 1000,
    authUserId: AUTH_USER_ID,
  };
}

function sessionResult(tokens) {
  return {
    error: null,
    data: {
      session: {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_at: tokens.expiresAt / 1000,
        user: { id: AUTH_USER_ID },
      },
    },
  };
}

test('errores de red y 5xx se traducen a 503 en cada operación del proveedor sin filtrar detalles', async () => {
  const tokens = providerTokens();
  const operations = [
    [
      'signInWithPassword',
      (provider) => provider.signIn('person@example.test', 'private-password'),
    ],
    ['refreshSession', (provider) => provider.refresh(tokens)],
    ['getUser', (provider) => provider.verifyIdentity(tokens)],
    ['setSession', (provider) => provider.factors(tokens)],
    ['listFactors', (provider) => provider.factors(tokens)],
    ['enroll', (provider) => provider.enroll(tokens)],
    [
      'challengeAndVerify',
      (provider) => provider.verifyMfa(tokens, FACTOR_ID, '123456'),
    ],
    ['signOut', (provider) => provider.signOut(tokens)],
  ];

  for (const error of [
    new AuthRetryableFetchError(PRIVATE_UPSTREAM_MESSAGE, 0),
    new AuthApiError(PRIVATE_UPSTREAM_MESSAGE, 503, 'unexpected_failure'),
  ]) {
    for (const [method, invoke] of operations) {
      const provider = new SupabaseIdentityProvider(new ConfigService({}));
      const failed = async () => ({ error, data: null });
      const auth = {
        setSession: async () => sessionResult(tokens),
        mfa: {
          listFactors: async () => ({
            error: null,
            data: { all: [{ id: FACTOR_ID, factor_type: 'totp' }], totp: [] },
          }),
        },
      };
      if (['listFactors', 'enroll', 'challengeAndVerify'].includes(method))
        auth.mfa[method] = failed;
      else auth[method] = failed;
      provider.client = () => ({ auth });

      await assert.rejects(invoke(provider), (failure) => {
        assert.equal(failure.getStatus(), 503, method);
        assert.equal(failure.message.includes(PRIVATE_UPSTREAM_MESSAGE), false);
        return true;
      });
    }
  }
});

test('credenciales y tokens rechazados siguen siendo 401; un código MFA rechazado sigue siendo 400', async () => {
  const tokens = providerTokens();
  for (const [invoke, method, status] of [
    [
      (provider) => provider.signIn('person@example.test', 'incorrect'),
      'signInWithPassword',
      401,
    ],
    [(provider) => provider.refresh(tokens), 'refreshSession', 401],
    [(provider) => provider.verifyIdentity(tokens), 'getUser', 401],
    [
      (provider) => provider.verifyMfa(tokens, FACTOR_ID, '000000'),
      'challengeAndVerify',
      400,
    ],
  ]) {
    const provider = new SupabaseIdentityProvider(new ConfigService({}));
    const failed = async () => ({
      data: null,
      error: new AuthApiError(
        PRIVATE_UPSTREAM_MESSAGE,
        400,
        'invalid_credentials',
      ),
    });
    const auth = {
      setSession: async () => sessionResult(tokens),
      mfa: {
        listFactors: async () => ({
          error: null,
          data: { all: [{ id: FACTOR_ID, factor_type: 'totp' }], totp: [] },
        }),
      },
    };
    if (method === 'challengeAndVerify') auth.mfa[method] = failed;
    else auth[method] = failed;
    provider.client = () => ({ auth });
    await assert.rejects(
      invoke(provider),
      (failure) =>
        failure.getStatus() === status &&
        !failure.message.includes(PRIVATE_UPSTREAM_MESSAGE),
    );
  }
});

test('resume evita renovación implícita con tokens vencidos o cercanos al margen del SDK', async () => {
  const provider = new SupabaseIdentityProvider(new ConfigService({}));
  let clientsCreated = 0;
  provider.client = () => {
    clientsCreated++;
    throw new Error('No debe crear un cliente ni llamar al proveedor.');
  };
  for (const expiresInSeconds of [-1, 149]) {
    const tokens = {
      ...providerTokens(Math.floor(Date.now() / 1000) + expiresInSeconds),
      expiresAt: Date.now() + 3600_000,
    };
    await assert.rejects(
      provider.factors(tokens),
      (failure) => failure.getStatus() === 503,
    );
  }
  assert.equal(clientsCreated, 0);
});

test('un 503 Auth real sobre HTTP local conserva la sesión web y un token rechazado la invalida', async (t) => {
  let upstreamStatus = 503;
  const upstream = createServer((_request, response) => {
    response.writeHead(upstreamStatus, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        message: PRIVATE_UPSTREAM_MESSAGE,
        error_code: upstreamStatus === 503 ? 'unexpected_failure' : 'bad_jwt',
      }),
    );
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  });
  const config = validateEnvironment({
    NODE_ENV: 'test',
    APP_ORIGIN: 'http://127.0.0.1:5173',
    SUPABASE_URL: `http://127.0.0.1:${upstream.address().port}`,
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_provider_errors',
  });
  const store = new session.MemoryStore();
  // MemoryStore is confined to this HTTP test; production still requires PostgreSQL.
  store.withLock = async (_sid, action) => action();
  store.close = async () => {};
  const runtime = {
    store,
    cookieName: 'kvg.sid',
    middleware: session({
      name: 'kvg.sid',
      store,
      secret: 'only-for-local-provider-error-tests',
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', maxAge: 600_000, path: '/' },
    }),
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(new ConfigService(config))
    .overrideProvider(IdentityProvider)
    .useValue(new SupabaseIdentityProvider(new ConfigService(config)))
    .overrideProvider(OperationalSession)
    .useValue({
      current: async () => {
        throw new Error('No debe consultar KVG cuando Auth falla.');
      },
    })
    .overrideProvider(SERVER_SESSION_RUNTIME)
    .useValue(runtime)
    .compile();
  const app = module.createNestApplication({
    logger: false,
    abortOnError: false,
  });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const origin = await app.getUrl();
  const csrf = await fetch(`${origin}/api/v1/auth/csrf`);
  assert.equal(csrf.status, 200);
  await csrf.json();
  const cookie = csrf.headers.getSetCookie()[0].split(';')[0];
  const sid = decodeURIComponent(cookie.split('=')[1]).slice(2).split('.')[0];
  const getStored = () =>
    new Promise((resolve, reject) =>
      store.get(sid, (error, data) => (error ? reject(error) : resolve(data))),
    );
  const saved = await getStored();
  saved.authentication = {
    ...providerTokens(),
    phase: 'authenticated',
    absoluteExpiresAt: Date.now() + 3600_000,
  };
  await new Promise((resolve, reject) =>
    store.set(sid, saved, (error) => (error ? reject(error) : resolve())),
  );

  for (const path of ['me', 'session']) {
    const response = await fetch(`${origin}/api/v1/auth/${path}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 503);
    assert.equal(
      JSON.stringify(await response.json()).includes(PRIVATE_UPSTREAM_MESSAGE),
      false,
    );
    assert.equal(
      (await getStored()).authentication.refreshToken,
      saved.authentication.refreshToken,
    );
  }

  upstreamStatus = 401;
  const rejected = await fetch(`${origin}/api/v1/auth/me`, {
    headers: { Cookie: cookie },
  });
  assert.equal(rejected.status, 401);
  assert.equal(
    JSON.stringify(await rejected.json()).includes(PRIVATE_UPSTREAM_MESSAGE),
    false,
  );
  assert.equal(await getStored(), undefined);
});
