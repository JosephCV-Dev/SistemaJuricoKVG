import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  application,
  authenticated,
  APP_ORIGIN,
} from './helpers/identity-application.mjs';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('documentos aplican guard, DTO, alcance y CSRF incluso al recibir bytes', async (t) => {
  const calls = [];
  const { browser, state, origin } = await application(t, {
    rpc: {
      execute: async (token, op, input) => {
        calls.push({ token, op, input });
        if (op === 'documento.carga')
          return {
            carga_id: id,
            documento_id: id,
            expediente_id: id,
            estado: 'RECIBIENDO',
            version_id: null,
            resultado: null,
          };
        if (op === 'documento.cargar')
          return { carga_id: id, documento_id: id, estado: 'RECIBIENDO' };
        throw new Error('RPC inesperada');
      },
    },
    files: {
      authorizeReception: async () => {},
      putImmutable: async () => {},
      completeReception: async () => {},
    },
  });
  assert.equal((await browser.request('documents')).status, 401);
  await authenticated(browser);
  state.capabilities = [
    {
      permission: 'documento.cargar',
      context: 'EXPLICITO',
      requiresMfa: true,
      requiresDecision: false,
    },
  ];
  const input = {
    requestId: id,
    caseId: id,
    categoryId: id,
    name: 'Ficticio',
    originalName: 'ficticio.png',
    reason: 'Prueba',
  };
  assert.equal(
    (
      await browser.post('documents/uploads', {
        ...input,
        antimalware_apto: true,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await browser.post('documents/uploads', {
        ...input,
        originalName: '../ficticio.png',
      })
    ).status,
    400,
  );
  assert.equal((await browser.post('documents/uploads', input)).status, 201);
  assert.match(calls.at(-1).token, /local-private-aal2/);
  assert(!Object.hasOwn(calls.at(-1).input, 'antimalware_apto'));
  let r = await fetch(`${origin}/api/v1/documents/uploads/${id}/content`, {
    method: 'PUT',
    headers: {
      Cookie: browser.cookie,
      Origin: APP_ORIGIN,
      'Content-Type': 'application/octet-stream',
    },
    body: Buffer.from('ficticio'),
  });
  assert.equal(r.status, 403);
  await browser.csrf();
  r = await fetch(`${origin}/api/v1/documents/uploads/${id}/content`, {
    method: 'PUT',
    headers: {
      Cookie: browser.cookie,
      Origin: APP_ORIGIN,
      'X-CSRF-Token': browser.csrfToken,
      'Content-Type': 'text/plain',
    },
    body: 'ficticio',
  });
  assert.equal(r.status, 415);
  r = await fetch(`${origin}/api/v1/documents/uploads/${id}/content`, {
    method: 'PUT',
    headers: {
      Cookie: browser.cookie,
      Origin: APP_ORIGIN,
      'X-CSRF-Token': browser.csrfToken,
      'Content-Type': 'application/octet-stream',
    },
    body: Buffer.from('ficticio'),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).state, 'RECIBIENDO');
  state.capabilities = [];
  assert.equal((await browser.request(`documents/uploads/${id}`)).status, 403);
});
