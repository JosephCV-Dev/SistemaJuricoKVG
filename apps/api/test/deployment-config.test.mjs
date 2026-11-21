import assert from 'node:assert/strict';
import { test } from 'node:test';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { readRuntimeSecrets } from '../dist/config/runtime-secrets.js';
import { validateWorkerEnvironment } from '../dist/config/worker-environment.js';
import { DocumentUploadPolicy } from '../dist/modules/documents/application/document-upload-policy.js';
import { RenderDocumentWorker } from '../dist/modules/operations/infrastructure/render-document-worker.js';
import {
  validateStagingSettings,
  validateStagingSecrets,
} from '../../../infrastructure/staging/preflight.mjs';

test('secretos montados no se mezclan con valores de entorno ni filtran errores', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'kvg-secret-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'secret');
  await writeFile(path, 'private-test-only\n', { mode: 0o600 });
  assert.equal(
    readRuntimeSecrets({ SUPABASE_SECRET_KEY_FILE: path }, [
      'SUPABASE_SECRET_KEY',
    ]).SUPABASE_SECRET_KEY,
    'private-test-only',
  );
  assert.throws(() =>
    readRuntimeSecrets(
      { SUPABASE_SECRET_KEY_FILE: path, SUPABASE_SECRET_KEY: 'otra' },
      ['SUPABASE_SECRET_KEY'],
    ),
  );
  assert.throws(
    () =>
      readRuntimeSecrets(
        { SUPABASE_SECRET_KEY_FILE: join(directory, 'missing') },
        ['SUPABASE_SECRET_KEY'],
      ),
    (error) => !error.message.includes(directory),
  );
  await writeFile(path, 'clave\ncontenido');
  assert.throws(() =>
    readRuntimeSecrets({ SUPABASE_SECRET_KEY_FILE: path }, [
      'SUPABASE_SECRET_KEY',
    ]),
  );
});
test('el trabajador de producción no requiere ni conserva secretos de sesión o propietario', () => {
  const config = validateWorkerEnvironment({
    NODE_ENV: 'production',
    SUPABASE_URL: 'https://pruebas.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_only_a_fixture',
    CLAMAV_HOST: 'antivirus',
    SESSION_SECRET: 'no-pasar',
    DATABASE_URL: 'no-pasar',
  });
  assert.equal(config.CLAMAV_HOST, 'antivirus');
  assert(!Object.hasOwn(config, 'SESSION_SECRET'));
  assert(!Object.hasOwn(config, 'DATABASE_URL'));
  assert.throws(() =>
    validateWorkerEnvironment({
      NODE_ENV: 'production',
      SUPABASE_URL: 'http://localhost:8000',
      SUPABASE_SECRET_KEY: 'sb_secret_only_a_fixture',
    }),
  );
});

test('Render pausa cargas hasta que el trabajador pueda reclamar en SQL y durante reinicio o apagado', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const children = [];
  t.mock.method(childProcess, 'fork', (script, args, options) => {
    assert.match(script, /worker\.js$/);
    assert.deepEqual(args, ['--render-demo']);
    assert.equal(options.env.DOCUMENT_UPLOAD_MODE, 'beta');
    assert.equal(options.env.SUPABASE_SECRET_KEY, 'sb_secret_fixture');
    assert(!Object.hasOwn(options.env, 'SESSION_SECRET'));
    assert(!Object.hasOwn(options.env, 'DATABASE_URL'));
    const child = new EventEmitter();
    child.kill = (signal) => {
      assert.equal(signal, 'SIGTERM');
      child.emit('close');
    };
    children.push(child);
    return child;
  });
  const config = {
    RENDER_DOCUMENT_WORKER: true,
    SUPABASE_URL: 'https://fixture.supabase.co',
    SUPABASE_SECRET_KEY: '',
    SESSION_SECRET: 'no-pasar',
    DATABASE_URL: 'no-pasar',
  };
  const uploads = new DocumentUploadPolicy('beta', false);
  const unconfigured = new RenderDocumentWorker(
    new ConfigService(config),
    uploads,
  );
  unconfigured.onApplicationBootstrap();
  assert.equal(children.length, 0);
  assert.throws(() => uploads.assertEnabled(), { status: 503 });

  const render = new RenderDocumentWorker(
    new ConfigService({ ...config, SUPABASE_SECRET_KEY: 'sb_secret_fixture' }),
    uploads,
  );
  render.onApplicationBootstrap();
  assert.deepEqual(uploads.availability(), { enabled: false, beta: true });
  children[0].emit('message', 'document-worker-ready');
  assert.deepEqual(uploads.availability(), { enabled: true, beta: true });
  children[0].emit('close');
  assert.throws(() => uploads.assertEnabled(), { status: 503 });
  t.mock.timers.tick(15_000);
  assert.equal(children.length, 2);
  children[1].emit('message', 'document-worker-ready');
  assert.equal(uploads.availability().enabled, true);
  await render.beforeApplicationShutdown();
  assert.throws(() => uploads.assertEnabled(), { status: 503 });
  t.mock.timers.tick(15_000);
  assert.equal(children.length, 2);
});

const settings = {
  STAGING_HOST: 'pruebas.kvg.test',
  SUPABASE_URL: 'https://stagingfixture.supabase.co',
  DEVELOPMENT_SUPABASE_URL: 'https://developmentfixture.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
  STAGING_SECRET_DIRECTORY: '/srv/kvg-test/secrets',
  API_IMAGE: 'kvg-api:test',
  WEB_IMAGE: 'kvg-web:test',
};
test('preflight impide reutilizar desarrollo, dominios de ejemplo y secretos en settings', () => {
  assert.equal(
    validateStagingSettings(settings, settings.DEVELOPMENT_SUPABASE_URL)
      .projectReference,
    'stagingfixture',
  );
  for (const changed of [
    { SUPABASE_URL: settings.DEVELOPMENT_SUPABASE_URL },
    { STAGING_HOST: 'pruebas.example.com' },
    { DATABASE_URL: 'postgres://secret' },
    { STAGING_HOST: 'host.test:8443' },
  ])
    assert.throws(() => validateStagingSettings({ ...settings, ...changed }));
  assert.throws(() =>
    validateStagingSettings(settings, 'https://unexpected.supabase.co'),
  );
});
test('preflight rechaza SQL propietario, otro proyecto y pooler de transacciones', () => {
  const input = {
    supabase_secret: 'sb_secret_fixture',
    session_secret: 'x'.repeat(48),
    session_encryption_key: Buffer.alloc(32, 3).toString('base64'),
    session_database_url:
      'postgresql://postgres.fixture:password@aws.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=/run/secrets/session_database_ca',
  };
  for (const url of [
    input.session_database_url,
    input.session_database_url.replace(
      'postgres.fixture',
      'kvg_session_store.other',
    ),
    input.session_database_url
      .replace('postgres.fixture', 'kvg_session_store.fixture')
      .replace(':5432', ':6543'),
  ])
    assert.throws(
      () =>
        validateStagingSecrets(
          { ...input, session_database_url: url },
          'fixture',
        ),
      /rol SQL/,
    );
});
