import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEnvironment } from '../dist/config/environment.js';
import { DocumentUploadPolicy } from '../dist/modules/documents/application/document-upload-policy.js';
import { DocumentsService } from '../dist/modules/documents/application/documents.service.js';

test('cargas pausadas por defecto; valores ambiguos no habilitan recepción', () => {
  assert.equal(validateEnvironment({}).DOCUMENT_UPLOAD_MODE, 'paused');
  assert.equal(
    validateEnvironment({ DOCUMENT_UPLOAD_MODE: 'verified' })
      .DOCUMENT_UPLOAD_MODE,
    'verified',
  );
  for (const value of ['', true, 'true', 'disabled', 'skip', 'verified '])
    assert.throws(
      () => validateEnvironment({ DOCUMENT_UPLOAD_MODE: value }),
      /DOCUMENT_UPLOAD_MODE/,
    );
});

test('la capa de aplicación también impide crear y recibir durante la pausa', async () => {
  const repository = {
    create() {
      assert.fail('No crear carga');
    },
  };
  const files = {
    putImmutable() {
      assert.fail('No escribir objetos');
    },
  };
  const service = new DocumentsService(
    repository,
    files,
    new DocumentUploadPolicy(),
  );
  assert.throws(
    () => service.create('usuario', {}),
    (e) => e.status === 503,
  );
  await assert.rejects(
    service.receive('usuario', 'id', Buffer.from('ficticio')),
    (e) => e.status === 503,
  );
});

test('trabajador pausado sale sin leer secretos montados ni reclamar trabajos incluso en producción', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'kvg-paused-worker-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const { stdout, stderr } = await promisify(execFile)(
    process.execPath,
    [fileURLToPath(new URL('../dist/worker.js', import.meta.url)), '--once'],
    {
      cwd,
      timeout: 10000,
      env: {
        NODE_ENV: 'production',
        SUPABASE_SECRET_KEY_FILE: '/missing-private-file',
      },
    },
  );
  assert.match(stdout, /Cargas pausadas/);
  assert.equal(stderr, '');
});

test('beta es explícita y se rechaza fuera de desarrollo y pruebas', () => {
  assert.equal(
    validateEnvironment({ DOCUMENT_UPLOAD_MODE: 'beta' }).DOCUMENT_UPLOAD_MODE,
    'beta',
  );
  const key = Buffer.alloc(32).toString('base64');
  assert.throws(
    () =>
      validateEnvironment({
        NODE_ENV: 'production',
        DOCUMENT_UPLOAD_MODE: 'beta',
        APP_ORIGIN: 'https://fixture.test',
        SUPABASE_URL: 'https://fixture.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
        SESSION_DATABASE_URL: 'postgresql://fixture',
        SESSION_SECRET: key,
        SESSION_ENCRYPTION_KEY: key,
      }),
    /solo se admite en desarrollo/,
  );
});

test('el arranque de la demo en Render habilita solo el trabajador beta previsto', () => {
  const env = {
    NODE_ENV: 'production',
    RENDER: 'true',
    RENDER_SERVICE_TYPE: 'web',
    RENDER_EXTERNAL_URL: 'https://kvg-demo.onrender.com',
    DOCUMENT_UPLOAD_MODE: 'paused',
    SUPABASE_URL: 'https://fixture.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
    SESSION_DATABASE_URL: 'postgresql://fixture',
    SESSION_SECRET: 'x'.repeat(32),
    SESSION_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  };
  const render = validateEnvironment(env, true);
  assert.equal(render.NODE_ENV, 'production');
  assert.equal(render.APP_ORIGIN, env.RENDER_EXTERNAL_URL);
  assert.equal(render.DOCUMENT_UPLOAD_MODE, 'beta');
  assert.equal(render.RENDER_DOCUMENT_WORKER, true);

  for (const other of [
    validateEnvironment(env),
    validateEnvironment({ ...env, RENDER: 'false' }, true),
    validateEnvironment({ ...env, RENDER_SERVICE_TYPE: 'worker' }, true),
    validateEnvironment({ ...env, RENDER_DEMO_UPLOADS: 'paused' }, true),
  ]) {
    assert.equal(other.DOCUMENT_UPLOAD_MODE, 'paused');
    assert.equal(other.RENDER_DOCUMENT_WORKER, false);
  }
  const verified = validateEnvironment(
    { ...env, DOCUMENT_UPLOAD_MODE: 'verified' },
    true,
  );
  assert.equal(verified.DOCUMENT_UPLOAD_MODE, 'verified');
  assert.equal(verified.RENDER_DOCUMENT_WORKER, false);
  assert.throws(
    () => validateEnvironment({ ...env, RENDER_DEMO_UPLOADS: 'true' }, true),
    /RENDER_DEMO_UPLOADS/,
  );
});
