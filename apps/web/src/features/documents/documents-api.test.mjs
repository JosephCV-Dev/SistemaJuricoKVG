import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createUpload,
  transfer,
  listDocuments,
  getDocument,
  downloadVersion,
  uploadAvailability,
} from './documents-api.ts';
const upload = { id: 'upload', documentId: 'doc', state: 'RECIBIENDO' };
test('disponibilidad de cargas exige booleano y no interpreta texto como autorización', async (t) => {
  let enabled = false;
  t.mock.method(globalThis, 'fetch', async (path) => {
    assert.equal(path, '/api/v1/documents/upload-availability');
    return new Response(JSON.stringify({ enabled }));
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await uploadAvailability(signal), { enabled: false });
  enabled = 'true';
  await assert.rejects(uploadAvailability(signal));
});
test('documentos conservan solicitud y transfieren archivo con cookie/CSRF sin JWT', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (path, init) => {
    calls.push({ path, init });
    return new Response(
      JSON.stringify(
        path.endsWith('/csrf')
          ? { csrfToken: 'csrf' }
          : path.endsWith('/content')
            ? { ...upload, caseId: 'case', versionId: null, result: null }
            : upload,
      ),
      {
        status: path.endsWith('/uploads') ? 201 : 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  });
  const input = {
    requestId: 'request',
    caseId: 'case',
    name: 'Nombre',
    originalName: 'file.pdf',
    categoryId: 'category',
    reason: 'Alta',
  };
  assert.equal(
    (await createUpload(input, new AbortController().signal)).id,
    'upload',
  );
  const file = new File(['texto ficticio'], 'file.pdf');
  await transfer('upload', file, new AbortController().signal);
  const post = calls.find((c) => c.path.endsWith('/uploads'));
  assert.equal(JSON.parse(post.init.body).requestId, 'request');
  const put = calls.find((c) => c.path.endsWith('/content'));
  assert.equal(put.init.body, file);
  assert.equal(put.init.headers['X-CSRF-Token'], 'csrf');
  assert.equal(put.init.credentials, 'same-origin');
  assert(!Object.hasOwn(put.init.headers, 'Authorization'));
});
test('rechaza respuestas documentales mal formadas y preserva 403 para limpiar datos', async (t) => {
  let response = new Response(
    JSON.stringify({
      items: [{ id: 'x' }],
      hasMore: false,
      offset: 0,
      limit: 20,
    }),
  );
  t.mock.method(globalThis, 'fetch', async () => response);
  await assert.rejects(listDocuments('case', 0, new AbortController().signal));
  response = new Response(
    JSON.stringify({ message: 'Operación no autorizada.' }),
    { status: 403 },
  );
  await assert.rejects(
    getDocument('doc', new AbortController().signal),
    (e) => e.status === 403,
  );
});
test('descarga conserva bytes del adjunto y no genera URL pública', async (t) => {
  t.mock.method(globalThis, 'fetch', async (path, init) => {
    assert.equal(path, '/api/v1/documents/versions/version/download');
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.cache, 'no-store');
    return new Response('original');
  });
  const blob = await downloadVersion('version', new AbortController().signal);
  assert.equal(await blob.text(), 'original');
});
