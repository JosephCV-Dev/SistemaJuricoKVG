import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { validateEnvironment } from '../dist/config/environment.js';
import { SupabaseClientFactory } from '../dist/infrastructure/supabase/supabase-client.factory.js';
import { KvgRpcService } from '../dist/infrastructure/supabase/kvg-rpc.service.js';
import { checkSupabaseConnection } from '../dist/infrastructure/supabase/connection-diagnostics.js';

const requests = [];
const replies = [];
const key = 'sb_publishable_local_test';
let server;
let config;
let rpc;

before(async () => {
  server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body,
    });
    const reply = replies.shift() ?? { status: 500, body: {} };
    response.writeHead(reply.status, {
      'content-type': 'application/json',
      ...reply.headers,
    });
    response.end(JSON.stringify(reply.body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  config = validateEnvironment({
    SUPABASE_URL: `http://127.0.0.1:${server.address().port}`,
    SUPABASE_PUBLISHABLE_KEY: key,
  });
  rpc = new KvgRpcService(new SupabaseClientFactory(new ConfigService(config)));
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test('la configuración rechaza claves privilegiadas, pares incompletos y destinos inseguros', () => {
  assert.throws(
    () => validateEnvironment({ SUPABASE_URL: 'https://example.supabase.co' }),
    /juntas/,
  );
  assert.throws(
    () => validateEnvironment({ SUPABASE_PUBLISHABLE_KEY: key }),
    /juntas/,
  );
  for (const SUPABASE_URL of [
    'http://example.com',
    'https://user:password@example.com',
    'https://example.com?key=secret',
    'https://example.com/rest/v1',
  ]) {
    assert.throws(
      () =>
        validateEnvironment({ SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: key }),
      /SUPABASE_URL/,
    );
  }
  for (const SUPABASE_PUBLISHABLE_KEY of [
    'sb_secret_fake',
    'service-role-key',
    'eyJ.fake.jwt',
  ]) {
    assert.throws(
      () =>
        validateEnvironment({
          SUPABASE_URL: 'https://example.supabase.co',
          SUPABASE_PUBLISHABLE_KEY,
        }),
      /publishable/,
    );
  }
  assert.equal(validateEnvironment({}).SUPABASE_URL, undefined);
});

test('el adaptador conserva la identidad de dos peticiones sin compartir sesión', async () => {
  requests.length = 0;
  replies.push(
    { status: 200, body: { correcto: true, datos: {} } },
    { status: 200, body: { correcto: true, datos: {} } },
  );
  const results = await Promise.all([
    rpc.execute('token-user-a', 'cliente.consultar', { cliente_id: 'test-a' }),
    rpc.execute('token-user-b', 'cliente.consultar', { cliente_id: 'test-b' }),
  ]);
  assert.deepEqual(results, [{}, {}]);
  assert.equal(
    requests.find(
      (request) => JSON.parse(request.body).p_datos.cliente_id === 'test-a',
    ).headers.authorization,
    'Bearer token-user-a',
  );
  assert.equal(
    requests.find(
      (request) => JSON.parse(request.body).p_datos.cliente_id === 'test-b',
    ).headers.authorization,
    'Bearer token-user-b',
  );
  for (const request of requests) {
    assert.equal(request.url, '/rest/v1/rpc/kvg_operar');
    assert.equal(request.headers.apikey, key);
    assert.equal(request.method, 'POST');
    assert.equal(JSON.parse(request.body).p_operacion, 'cliente.consultar');
    assert.equal('actor' in JSON.parse(request.body).p_datos, false);
  }
});

test('HTTP 200 con correcto:false es rechazo y no filtra el mensaje del proveedor', async () => {
  for (const [codigo, status] of [
    ['42501', 403],
    ['40001', 409],
    ['23505', 409],
    ['P0002', 404],
    ['23514', 400],
    ['XX000', 502],
  ]) {
    replies.push({
      status: 200,
      body: { correcto: false, codigo, mensaje: 'private upstream detail' },
    });
    await assert.rejects(
      rpc.execute('token-user', 'cliente.consultar', {}),
      (error) => {
        assert.equal(error.getStatus(), status);
        assert.equal(error.message.includes('private upstream detail'), false);
        return true;
      },
    );
  }
});

test('distingue errores HTTP y rechaza envoltorios incompletos sin reintentos', async () => {
  requests.length = 0;
  replies.push({
    status: 401,
    body: { code: 'PGRST301', message: 'private token detail' },
  });
  await assert.rejects(
    rpc.execute('expired-token', 'cliente.consultar', {}),
    (error) => error.getStatus() === 401,
  );
  for (const body of [
    null,
    [],
    { correcto: true },
    { correcto: 'true', datos: {} },
    { correcto: false },
  ]) {
    replies.push({ status: 200, body });
    await assert.rejects(
      rpc.execute('token-user', 'cliente.consultar', {}),
      (error) => error.getStatus() === 502,
    );
  }
  assert.equal(requests.length, 6);
});

test('no llama al proveedor sin token o sin configuración de Supabase', async () => {
  requests.length = 0;
  await assert.rejects(
    rpc.execute('', 'cliente.consultar', {}),
    (error) => error.getStatus() === 401,
  );
  const unconfigured = new KvgRpcService(
    new SupabaseClientFactory(new ConfigService(validateEnvironment({}))),
  );
  await assert.rejects(
    unconfigured.execute('token-user', 'cliente.consultar', {}),
    (error) => error.getStatus() === 503,
  );
  assert.equal(requests.length, 0);
});

test('un fallo transitorio no reintenta una operación RPC que puede modificar datos', async () => {
  requests.length = 0;
  replies.push({
    status: 503,
    body: { code: 'XX000', message: 'upstream unavailable' },
  });
  await assert.rejects(
    rpc.execute('token-user', 'cliente.registrar', {}),
    (error) => error.getStatus() === 502,
  );
  assert.equal(requests.length, 1);
});

test('el diagnóstico usa solo GET y distingue acceso restringido de permiso verificado', async () => {
  requests.length = 0;
  replies.push({ status: 200, body: {} }, { status: 403, body: {} });
  const checks = await checkSupabaseConnection(config);
  assert.deepEqual(checks, [
    { component: 'Auth', result: 'available', status: 200 },
    { component: 'Data API', result: 'restricted', status: 403 },
  ]);
  assert.deepEqual(
    requests.map((request) => request.url),
    ['/auth/v1/settings', '/rest/v1/'],
  );
  for (const request of requests) {
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.apikey, key);
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.body, '');
  }
});

test('el diagnóstico rechaza redirecciones y fallos de la clave sin consultar el destino', async () => {
  requests.length = 0;
  replies.push(
    {
      status: 302,
      headers: { location: `${config.SUPABASE_URL}/redirect-target` },
      body: {},
    },
    { status: 401, body: {} },
  );
  const checks = await checkSupabaseConnection(config);
  assert.equal(checks[0].result, 'failed');
  assert.equal(checks[1].result, 'restricted');
  assert.deepEqual(
    requests.map((request) => request.url),
    ['/auth/v1/settings', '/rest/v1/'],
  );
});
