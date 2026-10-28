import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  createClient,
  createCase,
  searchClients,
  getClient,
  getCase,
  getCapabilities,
} from './records-api.ts';
import { AuthRequestError } from '../../shared/api/session-http.ts';
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const client = {
  id: 'client',
  name: 'Ficticio',
  type: 'PERSONA_FISICA',
  createdAt: '2026-10-28T12:00:00Z',
  revision: 1,
};
const caseRow = {
  id: 'case',
  folio: 'KVG-2026-1',
  clientId: 'client',
  description: 'Asunto',
  status: 'NUEVO',
  externalNumber: null,
  externalAuthority: null,
  createdAt: '2026-10-28T12:00:00Z',
  revision: 1,
};
function responses(values) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    assert.ok(values.length);
    return values.shift();
  };
  return calls;
}
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status });

test('las altas conservan requestId y usan cookie/CSRF sin tokens ni reintentos automáticos', async () => {
  const calls = responses([
    json({ csrfToken: 'csrf-1' }),
    json(client, 201),
    json({ csrfToken: 'csrf-2' }),
    json(caseRow, 201),
  ]);
  const signal = new AbortController().signal;
  await createClient(
    {
      requestId: 'request-1',
      name: 'Ficticio',
      identifications: [],
      contacts: [],
    },
    signal,
  );
  await createCase(
    { requestId: 'request-2', clientId: 'client', description: 'Asunto' },
    signal,
  );
  assert.equal(calls[0].url, '/api/v1/auth/csrf');
  assert.equal(calls[1].options.credentials, 'same-origin');
  assert.equal(calls[1].options.headers['X-CSRF-Token'], 'csrf-1');
  assert.equal(JSON.parse(calls[1].options.body).requestId, 'request-1');
  assert.equal(calls[3].options.headers['X-CSRF-Token'], 'csrf-2');
  assert.equal(calls[3].options.headers.Authorization, undefined);
});
test('consulta paginada valida la forma y conserva únicamente el contrato público', async () => {
  const calls = responses([
    json({
      items: [{ ...client, access_token: 'no-exportar' }],
      limit: 20,
      offset: 20,
      hasMore: false,
    }),
  ]);
  const result = await searchClients(
    'Nombre & otro',
    20,
    new AbortController().signal,
  );
  assert.equal(result.items[0].access_token, undefined);
  assert.match(calls[0].url, /text=Nombre\+%26\+otro/);
  assert.equal(calls[0].options.cache, 'no-store');
});
test('la denegación 401/403 se conserva para limpiar la sesión y el contenido privado', async () => {
  responses([
    json({ message: 'Operación no autorizada.' }, 403),
    json({ message: 'Sesión vencida.' }, 401),
  ]);
  const signal = new AbortController().signal;
  await assert.rejects(
    getClient('client', signal),
    (error) => error instanceof AuthRequestError && error.status === 403,
  );
  await assert.rejects(
    getCase('case', signal),
    (error) => error instanceof AuthRequestError && error.status === 401,
  );
});
test('rechaza datos incompletos y capacidades no válidas', async () => {
  responses([
    json({ items: [client], limit: 0, offset: 0, hasMore: false }),
    json({ ...caseRow, history: [], assignments: [], progress: null }),
    json({ capabilities: [{ permission: 12 }] }),
  ]);
  const signal = new AbortController().signal;
  await assert.rejects(searchClients('', 0, signal));
  await assert.rejects(getCase('case', signal));
  await assert.rejects(getCapabilities(signal));
});
