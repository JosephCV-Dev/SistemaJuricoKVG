import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, createHmac } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import {
  developmentConfig,
  ownerConnection,
  localDirectory,
  reportSetupFailure,
} from './lib/development-database.mjs';

let app;
let owner;
let sessionDatabase;
let stage = 'CONFIGURACION';
const checks = [];
const privateTokens = [];
let identity;

function check(condition, name) {
  assert.ok(condition, name);
  checks.push(name);
}

function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Formato TOTP no admitido.');
    bits += index.toString(2).padStart(5, '0');
  }
  const key = Buffer.from(
    Array.from({ length: Math.floor(bits.length / 8) }, (_, i) =>
      parseInt(bits.slice(i * 8, i * 8 + 8), 2),
    ),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, '0');
}

class Browser {
  cookie = '';
  lastSetCookie = '';
  constructor(origin, allowedOrigin) {
    this.origin = origin;
    this.allowedOrigin = allowedOrigin;
  }
  async request(
    path,
    method = 'GET',
    body,
    csrfToken,
    origin = this.allowedOrigin,
  ) {
    const response = await fetch(this.origin + '/api/v1/auth/' + path, {
      method,
      headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(method !== 'GET'
          ? { Origin: origin, 'Content-Type': 'application/json' }
          : {}),
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(25_000),
      redirect: 'error',
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) {
      this.lastSetCookie = cookies[cookies.length - 1];
      this.cookie = this.lastSetCookie.split(';')[0];
    }
    let data = null;
    if (response.status !== 204) {
      try {
        data = await response.json();
      } catch {
        /* salida sin cuerpo JSON */
      }
    }
    return { status: response.status, data, headers: response.headers };
  }
  async mutate(path, body) {
    const csrf = await this.request('csrf');
    assert.equal(csrf.status, 200);
    return this.request(path, 'POST', body, csrf.data.csrfToken);
  }
}

try {
  const config = await developmentConfig();
  const settingsResponse = await fetch(config.api + '/auth/v1/settings', {
    headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  const settings = await settingsResponse.json();
  check(
    settingsResponse.status === 200 && settings.disable_signup === true,
    'cuentas_solo_por_invitacion',
  );
  const fixturePath = `${localDirectory}/identity-development-accounts.json`;
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  if (fixture.projectReference !== config.reference)
    throw new Error('Las identidades no corresponden al proyecto.');
  const { AppModule } = await import('../dist/app.module.js');
  const { configureApp } = await import('../dist/configure-app.js');
  const { ServerSessions } =
    await import('../dist/modules/identity/presentation/server-sessions.service.js');
  const { IdentityService } =
    await import('../dist/modules/identity/application/identity.service.js');
  const { KvgRpcService } =
    await import('../dist/infrastructure/supabase/kvg-rpc.service.js');
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const allowedOrigin = process.env.APP_ORIGIN;
  const sessions = app.get(ServerSessions);
  identity = app.get(IdentityService);
  const rpc = app.get(KvgRpcService);
  owner = await ownerConnection(config);
  sessionDatabase = new pg.Client({
    connectionString: process.env.SESSION_DATABASE_URL,
    connectionTimeoutMillis: 10_000,
  });
  await sessionDatabase.connect();

  stage = 'COOKIES_CSRF';
  const probe = new Browser(origin, allowedOrigin);
  check(
    (await probe.request('me')).status === 401,
    'privado_sin_sesion_denegado',
  );
  check(
    (
      await probe.request('login', 'POST', {
        email: 'invalido',
        password: 'invalido',
      })
    ).status === 403,
    'login_sin_csrf_denegado',
  );
  const csrf = await probe.request('csrf');
  check(
    csrf.status === 200 && typeof csrf.data.csrfToken === 'string',
    'csrf_servidor_disponible',
  );
  check(
    probe.lastSetCookie.includes('HttpOnly') &&
      probe.lastSetCookie.includes('SameSite=Lax'),
    'cookie_opaca_protegida',
  );
  check(
    csrf.headers.get('cache-control') === 'no-store',
    'respuestas_identidad_sin_cache',
  );
  check(
    (
      await probe.request(
        'login',
        'POST',
        { email: 'invalido', password: 'invalido' },
        csrf.data.csrfToken,
        'https://otro-origen.invalid',
      )
    ).status === 403,
    'origen_ajeno_denegado',
  );

  async function signIn(account, negative = false) {
    const browser = new Browser(origin, allowedOrigin);
    const token = await browser.request('csrf');
    if (negative) {
      const invalid = await browser.request(
        'login',
        'POST',
        { email: account.email, password: 'clave-incorrecta-de-prueba' },
        token.data.csrfToken,
      );
      check(invalid.status === 401, 'credenciales_invalidas_denegadas');
    }
    const previousCookie = browser.cookie;
    const login = await browser.mutate('login', {
      email: account.email,
      password: account.password,
    });
    check(
      login.status === 200 && login.data.status === 'mfa_required',
      `primer_factor_${account.role}`,
    );
    check(
      browser.cookie !== previousCookie,
      `sid_rotado_login_${account.role}`,
    );
    check(
      !JSON.stringify(login.data).includes('access_token') &&
        !JSON.stringify(login.data).includes('refresh_token'),
      `tokens_fuera_del_navegador_${account.role}`,
    );
    check(
      (await browser.request('me')).status === 401,
      `sin_mfa_denegado_${account.role}`,
    );
    if (login.data.enrollmentRequired) {
      const enrollment = await browser.mutate('mfa/enroll', {});
      check(
        enrollment.status === 200 && typeof enrollment.data.secret === 'string',
        `alta_totp_${account.role}`,
      );
      account.factorId = enrollment.data.factorId;
      account.totpSecret = enrollment.data.secret;
      await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + '\n', {
        mode: 0o600,
      });
    }
    if (!account.factorId || !account.totpSecret)
      throw new Error('El factor de prueba necesita su secreto local.');
    const beforeMfa = browser.cookie;
    const verification = await browser.mutate('mfa/verify', {
      factorId: account.factorId,
      code: totp(account.totpSecret),
    });
    check(
      verification.status === 200 &&
        verification.data.status === 'authenticated',
      `mfa_y_sesion_kvg_${account.role}`,
    );
    check(browser.cookie !== beforeMfa, `sid_rotado_mfa_${account.role}`);
    const sid = decodeURIComponent(browser.cookie.split('=')[1])
      .slice(2)
      .split('.')[0];
    const internal = await new Promise((resolve, reject) =>
      sessions.runtime.store.get(sid, (error, value) =>
        error ? reject(error) : resolve(value),
      ),
    );
    if (!internal?.authentication)
      throw new Error('No se obtuvo sesión interna de prueba.');
    privateTokens.push(internal.authentication);
    return {
      browser,
      sid,
      authentication: internal.authentication,
      state: verification.data,
    };
  }

  stage = 'AUTENTICACION_REAL';
  const adminAccount = fixture.accounts.find(
    (account) => account.role === 'ADMINISTRADOR',
  );
  const legalAccount = fixture.accounts.find(
    (account) => account.role === 'ABOGADO',
  );
  const admin = await signIn(adminAccount, true);
  check(
    (await admin.browser.request('me')).status === 200,
    'identidad_propia_permitida',
  );
  stage = 'AUTORIZACION_REAL';
  const profile = await rpc.execute(
    admin.authentication.accessToken,
    'sesion.consultar',
    {},
  );
  check(
    profile.usuario.usuario_id === admin.state.user.id,
    'actor_kvg_verificado_por_rpc',
  );
  let forbidden = false;
  try {
    await rpc.execute(
      admin.authentication.accessToken,
      'cliente.registrar',
      {},
    );
  } catch (error) {
    forbidden = error.getStatus?.() === 403;
  }
  check(forbidden, 'administrador_sin_facultad_juridica_denegado');

  const hash = createHash('sha256').update(admin.sid).digest('hex');
  const stored = await owner.query(
    'SELECT payload, expires_at, created_at FROM kvg_servidor.sesion_web WHERE sid_hash=$1',
    [hash],
  );
  check(
    stored.rowCount === 1 &&
      Buffer.isBuffer(stored.rows[0].payload) &&
      !stored.rows[0].payload.includes(
        Buffer.from(admin.authentication.accessToken),
      ),
    'persistencia_cifrada_sin_token_en_claro',
  );
  check(
    Math.abs(
      Date.parse(admin.state.expiresAt) - stored.rows[0].expires_at.getTime(),
    ) < 1500,
    'expiracion_absoluta_conservada',
  );
  let businessAccess = false;
  try {
    await sessionDatabase.query('SELECT cliente_id FROM kvg.cliente LIMIT 0');
    businessAccess = true;
  } catch {
    /* esperado */
  }
  check(!businessAccess, 'rol_sesiones_sin_acceso_a_negocio');

  stage = 'RENOVACION_Y_REVOCACION';
  const csrfForRefresh = await admin.browser.request('csrf');
  const staleSession = await new Promise((resolve, reject) =>
    sessions.runtime.store.get(admin.sid, (error, value) =>
      error ? reject(error) : resolve(value),
    ),
  );
  const concurrent = await Promise.all([
    admin.browser.request('refresh', 'POST', {}, csrfForRefresh.data.csrfToken),
    admin.browser.request('refresh', 'POST', {}, csrfForRefresh.data.csrfToken),
  ]);
  check(
    concurrent.every(
      (response) =>
        response.status === 200 && response.data.status === 'authenticated',
    ),
    'renovacion_concurrente_controlada',
  );
  const refreshedSession = await new Promise((resolve, reject) =>
    sessions.runtime.store.get(admin.sid, (error, value) =>
      error ? reject(error) : resolve(value),
    ),
  );
  await new Promise((resolve, reject) =>
    sessions.runtime.store.touch(admin.sid, staleSession, (error) =>
      error ? reject(error) : resolve(),
    ),
  );
  const afterLateResponse = await new Promise((resolve, reject) =>
    sessions.runtime.store.get(admin.sid, (error, value) =>
      error ? reject(error) : resolve(value),
    ),
  );
  check(
    refreshedSession.authentication.refreshToken ===
      afterLateResponse.authentication.refreshToken,
    'respuesta_antigua_no_sobrescribe_token_renovado',
  );
  check(
    (await admin.browser.request('me')).status === 200,
    'sesion_valida_tras_renovar',
  );
  const staleCookie = admin.browser.cookie;
  check(
    (await admin.browser.mutate('logout', {})).status === 204,
    'cierre_sesion_completo',
  );
  const replay = new Browser(origin, allowedOrigin);
  replay.cookie = staleCookie;
  check(
    (await replay.request('me')).status === 401,
    'cookie_cerrada_no_reutilizable',
  );

  stage = 'REVOCACION_Y_VENCIMIENTO';
  const legal = await signIn(legalAccount);
  await rpc.execute(legal.authentication.accessToken, 'sesion.cerrar', {});
  check(
    (await legal.browser.request('me')).status === 401,
    'revocacion_kvg_con_cookie_vigente_denegada',
  );
  const expiring = await signIn(adminAccount);
  await sessionDatabase.query(
    "UPDATE kvg_servidor.sesion_web SET expires_at=clock_timestamp()-interval '1 second' WHERE sid_hash=$1",
    [createHash('sha256').update(expiring.sid).digest('hex')],
  );
  check(
    (await expiring.browser.request('me')).status === 401,
    'sesion_web_vencida_denegada',
  );
  console.log(
    JSON.stringify({
      resultado: 'correcto',
      comprobaciones: checks.length,
      detalle: checks,
      credenciales_publicadas: false,
      datos_reales_utilizados: false,
    }),
  );
  await writeFile(
    `${localDirectory}/identity-live-verification.json`,
    JSON.stringify({ date: '2026-10-28', result: 'passed', checks }, null, 2) +
      '\n',
    { mode: 0o600 },
  );
} catch (error) {
  reportSetupFailure(stage, error);
  process.exitCode = 1;
} finally {
  if (identity)
    for (const tokens of privateTokens)
      await identity.logout(tokens).catch(() => undefined);
  await sessionDatabase?.end().catch(() => undefined);
  await owner?.end().catch(() => undefined);
  await app?.close().catch(() => undefined);
}
