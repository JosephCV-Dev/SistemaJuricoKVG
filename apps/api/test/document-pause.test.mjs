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
