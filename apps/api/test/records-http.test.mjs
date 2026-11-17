import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import {
  application,
  APP_ORIGIN,
  authenticated,
  assertNoProviderTokens,
} from './helpers/identity-application.mjs';

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CASE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FOREIGN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQUEST = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const clientRow = {
  cliente_id: CLIENT,
  nombre_presentacion: 'Cliente ficticio',
  tipo_cliente: 'PERSONA_FISICA',
  creado_en: '2026-10-28T12:00:00Z',
  revision: 1,
  creado_por: 'private-actor-not-for-the-response',
};
const caseRow = {
  expediente_id: CASE,
  folio_interno: 'KVG-2026-0000000001',
  cliente_principal_id: CLIENT,
  descripcion: 'Asunto ficticio',
  numero_externo: null,
  autoridad_externa: null,
  estado_expediente_codigo: 'NUEVO',
  creado_en: '2026-10-28T12:00:00Z',
  revision: 1,
};

async function recordsApp(t) {
  const calls = [];
  const rpc = {
    async execute(token, operation, input) {
      assert.match(token, /local-private-aal2/);
      calls.push({ operation, input });
      if (input.cliente_id === FOREIGN || input.expediente_id === FOREIGN)
        throw new ForbiddenException('Operación no autorizada.');
      switch (operation) {
        case 'cliente.registrar':
          return clientRow;
        case 'cliente.buscar':
          return [clientRow, { ...clientRow, cliente_id: FOREIGN }];
        case 'cliente.actualizar':
          return {
            ...clientRow,
            nombre_presentacion: input.nombre,
            revision: 2,
          };
        case 'cliente.consultar':
          return {
            ...clientRow,
            puede_editar: true,
            contactos: [],
            identificaciones: [],
          };
        case 'expediente.crear':
          return caseRow;
        case 'expediente.buscar':
          return [caseRow];
        case 'expediente.actualizar':
          return {
            ...caseRow,
            descripcion: input.descripcion ?? caseRow.descripcion,
            revision: 2,
          };
        case 'expediente.consultar':
          return {
            ...caseRow,
            nombre_cliente: 'Cliente ficticio',
            puede_editar: true,
            asignaciones: [],
            historial_estados: [],
            avances: [],
          };
        case 'catalogos.consultar':
          return {
            tipos_identificacion: [
              {
                tipo_identificacion_codigo: 'PRUEBA_KVG',
                nombre: 'Identificación ficticia',
                unicidad_exigida: true,
              },
            ],
            parametros: 'private-do-not-export',
          };
        default:
          throw new Error('RPC inesperada');
      }
    },
  };
  const result = await application(t, { rpc });
  result.state.capabilities = [
    ['cliente.registrar', 'GLOBAL_OPERATIVO'],
    ['cliente.consultar', 'REGISTRO_PROPIO'],
    ['cliente.actualizar', 'REGISTRO_PROPIO'],
    ['expediente.crear', 'GLOBAL_OPERATIVO'],
    ['expediente.consultar', 'EXPLICITO'],
    ['expediente.actualizar', 'EXPLICITO'],
  ].map(([permission, context]) => ({
    permission,
    context,
    requiresMfa: true,
    requiresDecision: false,
  }));
  return { ...result, calls };
}

test('clientes y expedientes requieren sesión, capacidades vigentes y CSRF al guardar', async (t) => {
  const { browser, state, calls } = await recordsApp(t);
  assert.equal((await browser.request('clients')).status, 401);
  assert.equal((await browser.request(`cases/${CASE}`)).status, 401);
  await authenticated(browser);
  assert.equal(
    (
      await browser.post(
        'clients',
        { requestId: REQUEST, name: 'Cliente' },
        { 'X-CSRF-Token': '' },
      )
    ).status,
    403,
  );
  state.capabilities = [];
  assert.equal((await browser.request('clients')).status, 403);
  assert.equal(
    (
      await browser.post('cases', {
        requestId: REQUEST,
        clientId: CLIENT,
        description: 'Asunto',
      })
    ).status,
    403,
  );
  assert.equal(calls.length, 0);
});

test('el alta usa solo el JWT validado y campos admitidos y transforma la salida SQL', async (t) => {
  const { browser, calls } = await recordsApp(t);
  await authenticated(browser);
  const response = await browser.post('clients', {
    requestId: REQUEST,
    name: '  Cliente ficticio  ',
    identifications: [{ type: 'PRUEBA_KVG', value: '  DEV-001  ' }],
    contacts: [
      { type: 'CORREO', value: 'cliente@example.com', preferred: true },
    ],
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.id, CLIENT);
  assert.equal(body.name, 'Cliente ficticio');
  assert.equal(body.creado_por, undefined);
  assertNoProviderTokens(body);
  assert.deepEqual(calls[0], {
    operation: 'cliente.registrar',
    input: {
      solicitud_id: REQUEST,
      nombre: 'Cliente ficticio',
      identificaciones: [{ tipo: 'PRUEBA_KVG', valor: 'DEV-001' }],
      contactos: [
        { tipo: 'CORREO', valor: 'cliente@example.com', preferente: true },
      ],
    },
  });
});

test('las validaciones rechazan nulos, colecciones inválidas, autoría y formatos antes del RPC', async (t) => {
  const { browser, calls } = await recordsApp(t);
  await authenticated(browser);
  for (const input of [
    { requestId: REQUEST, name: '  ' },
    { requestId: REQUEST, name: 'Cliente', creado_por: FOREIGN },
    { requestId: REQUEST, name: 'Cliente', contacts: null },
    {
      requestId: REQUEST,
      name: 'Cliente',
      identifications: [{ type: 'X', value: null }],
    },
    {
      requestId: REQUEST,
      name: 'Cliente',
      contacts: [{ type: 'CORREO', value: 'invalido' }],
    },
    {
      requestId: REQUEST,
      name: 'Cliente',
      contacts: [{ type: 'TELEFONO', value: 'abc' }],
    },
    {
      requestId: REQUEST,
      name: 'Cliente',
      contacts: Array(21).fill({
        type: 'CORREO',
        value: 'ficticio@example.com',
      }),
    },
  ])
    assert.equal((await browser.post('clients', input)).status, 400);
  for (const input of [
    {
      requestId: REQUEST,
      clientId: CLIENT,
      description: 'Asunto',
      folio: 'FORZADO',
    },
    { requestId: REQUEST, clientId: 'invalido', description: 'Asunto' },
    { requestId: REQUEST, clientId: CLIENT, description: '  ' },
    {
      requestId: REQUEST,
      clientId: CLIENT,
      description: 'Asunto',
      externalNumber: '10',
    },
    {
      requestId: REQUEST,
      clientId: CLIENT,
      description: 'Asunto',
      externalAuthority: null,
    },
  ])
    assert.equal((await browser.post('cases', input)).status, 400);
  assert.equal(calls.length, 0);
});

test('los contactos preferentes se limitan por tipo conforme al modelo', async (t) => {
  const { browser } = await recordsApp(t);
  await authenticated(browser);
  const input = {
    requestId: REQUEST,
    name: 'Cliente',
    contacts: [
      { type: 'CORREO', value: 'cliente@example.com', preferred: true },
      { type: 'TELEFONO', value: '123456', preferred: true },
    ],
  };
  assert.equal((await browser.post('clients', input)).status, 201);
  assert.equal(
    (
      await browser.post('clients', {
        ...input,
        contacts: [
          input.contacts[0],
          { ...input.contacts[0], value: 'otro@example.com' },
        ],
      })
    ).status,
    400,
  );
});

test('el folio y estado vienen de SQL; detalles y catálogos no exponen filas internas', async (t) => {
  const { browser, calls } = await recordsApp(t);
  await authenticated(browser);
  const created = await browser.post('cases', {
    requestId: REQUEST,
    clientId: CLIENT,
    description: 'Asunto ficticio',
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).status, 'NUEVO');
  assert.equal(calls[0].input.folio_interno, undefined);
  for (const path of [
    `clients/${CLIENT}`,
    `cases/${CASE}`,
    'clients/identification-types',
  ]) {
    const response = await browser.request(path);
    assert.equal(response.status, 200);
    const body = await response.json();
    assertNoProviderTokens(body);
    assert.doesNotMatch(
      JSON.stringify(body),
      /private-|creado_por|auth_usuario_id/,
    );
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('búsquedas acotadas y paginación usan solo filas autorizadas sin inventar totales', async (t) => {
  const { browser, calls } = await recordsApp(t);
  await authenticated(browser);
  const response = await browser.request(
    'clients?text=Ficticio&limit=1&offset=0',
  );
  assert.deepEqual(await response.json(), {
    items: [
      {
        id: CLIENT,
        name: 'Cliente ficticio',
        type: 'PERSONA_FISICA',
        createdAt: '2026-10-28T12:00:00Z',
        revision: 1,
      },
    ],
    limit: 1,
    offset: 0,
    hasMore: true,
  });
  assert.equal(calls[0].input.limite, 2);
  for (const path of [
    'clients?limit=999',
    'clients?offset=-1',
    'clients?rol=ADMINISTRADOR',
    'cases?status=INVENTADO',
    'clients/not-a-uuid',
  ])
    assert.equal((await browser.request(path)).status, 400);
  assert.equal(calls.length, 1);
});

test('la denegación de recurso no revela datos ni invalida otra consulta permitida', async (t) => {
  const { browser } = await recordsApp(t);
  await authenticated(browser);
  for (const path of [`clients/${FOREIGN}`, `cases/${FOREIGN}`]) {
    const response = await browser.request(path);
    assert.equal(response.status, 403);
    assert.doesNotMatch(
      JSON.stringify(await response.json()),
      /Cliente ficticio|Asunto ficticio|KVG-2026/,
    );
  }
  assert.equal((await browser.request(`clients/${CLIENT}`)).status, 200);
});

test('edición exige revisión, CSRF y alcance y envía solo campos editables', async (t) => {
  const { browser, calls } = await recordsApp(t);
  await authenticated(browser);
  const patch = (id, body, csrf = browser.csrfToken) =>
    browser.request(`clients/${id}`, {
      method: 'PATCH',
      body,
      headers: { Origin: APP_ORIGIN, 'X-CSRF-Token': csrf },
    });
  const initial = calls.length;
  assert.equal(
    (await patch(CLIENT, { revision: 1, name: 'Nuevo' }, '')).status,
    403,
  );
  for (const invalid of [
    { name: 'Nuevo' },
    { revision: '1', name: 'Nuevo' },
    { revision: 1 },
    { revision: 1, name: null },
    { revision: 1, contacts: null },
    { revision: 1, name: 'Nuevo', createdBy: FOREIGN },
    { revision: 1, contacts: [{ type: 'CORREO', value: 'incorrecto' }] },
  ])
    assert.equal((await patch(CLIENT, invalid)).status, 400);
  assert.equal(calls.length, initial);
  assert.equal(
    (await patch(FOREIGN, { revision: 1, name: 'Nuevo' })).status,
    403,
  );
  const result = await patch(CLIENT, { revision: 1, name: '  Nuevo  ' });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).revision, 2);
  assert.deepEqual(calls.at(-1), {
    operation: 'cliente.actualizar',
    input: { cliente_id: CLIENT, nombre: 'Nuevo', revision: 1 },
  });
  assert.equal(
    (await browser.request('clients?identification=FIC-123')).status,
    200,
  );
  assert.equal(calls.at(-1).input.identificacion, 'FIC-123');
  assert.equal(
    (await browser.request('clients?identification=' + 'x'.repeat(101))).status,
    400,
  );
});

test('editar expediente valida campos protegidos, permiso, contexto y referencia externa', async (t) => {
  const { browser, calls, state } = await recordsApp(t);
  await authenticated(browser);
  const patch = (id, body, csrf = browser.csrfToken) =>
    browser.request(`cases/${id}`, {
      method: 'PATCH',
      body,
      headers: { Origin: APP_ORIGIN, 'X-CSRF-Token': csrf },
    });
  const metadata = { revision: 1, reason: 'CORREGIR_CAPTURA' };
  const initial = calls.length;
  assert.equal(
    (await patch(CASE, { ...metadata, description: 'Revisión' }, '')).status,
    403,
  );
  for (const changes of [
    { folio: 'KVG-FORZADO', description: 'Revisión' },
    { clientId: FOREIGN, description: 'Revisión' },
    { status: 'ARCHIVADO', description: 'Revisión' },
    { responsibleId: FOREIGN, description: 'Revisión' },
    { description: null },
    { reason: 'otro', description: 'Revisión' },
    { revision: '1', description: 'Revisión' },
    { externalNumber: 'EXT' },
    { externalNumber: null, externalAuthority: 'Autoridad' },
    {},
  ])
    assert.equal((await patch(CASE, { ...metadata, ...changes })).status, 400);
  assert.equal(calls.length, initial);
  assert.equal(
    (await patch(FOREIGN, { ...metadata, description: 'Revisión' })).status,
    403,
  );
  const updated = await patch(CASE, {
    ...metadata,
    description: '  Refinada  ',
    externalNumber: null,
    externalAuthority: null,
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).revision, 2);
  assert.deepEqual(calls.at(-1), {
    operation: 'expediente.actualizar',
    input: {
      expediente_id: CASE,
      revision: 1,
      motivo: 'CORREGIR_CAPTURA',
      descripcion: 'Refinada',
      numero_externo: null,
      autoridad_externa: null,
    },
  });
  state.capabilities = state.capabilities.filter(
    ({ permission }) => permission !== 'expediente.actualizar',
  );
  assert.equal(
    (await patch(CASE, { ...metadata, description: 'Revisión' })).status,
    403,
  );
  assert.equal(
    (
      await browser.request(
        'cases?client=Ficticio&responsible=Abogado&status=NUEVO',
      )
    ).status,
    200,
  );
  assert.deepEqual(calls.at(-1).input, {
    texto: null,
    estado: 'NUEVO',
    cliente: 'Ficticio',
    responsable: 'Abogado',
    limite: 21,
    desplazamiento: 0,
  });
});
