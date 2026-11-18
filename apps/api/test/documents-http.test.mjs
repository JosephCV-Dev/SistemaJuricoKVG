import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  application,
  authenticated,
  APP_ORIGIN,
} from './helpers/identity-application.mjs';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('pausa documental bloquea POST y PUT sin RPC ni Storage y protege su disponibilidad con identidad y permiso', async (t) => {
  const calls = [];
  const { browser, state, origin } = await application(t, {
    rpc: {
      execute: async (_token, op) => {
        calls.push(op);
        throw new Error('No debe llamarse');
      },
    },
    files: {
      putImmutable: async () => {
        calls.push('Storage');
        throw new Error('No debe llamarse');
      },
    },
  });
  assert.equal(
    (await browser.request('documents/upload-availability')).status,
    401,
  );
  await authenticated(browser);
  assert.equal(
    (await browser.request('documents/upload-availability')).status,
    403,
  );
  state.capabilities = [
    {
      permission: 'documento.cargar',
      context: 'EXPLICITO',
      requiresMfa: true,
      requiresDecision: false,
    },
  ];
  const availability = await browser.request('documents/upload-availability');
  assert.equal(availability.status, 200);
  assert.deepEqual(await availability.json(), { enabled: false });
  const response = await browser.post('documents/uploads', {
    requestId: id,
    caseId: id,
    categoryId: id,
    name: 'Ficticio',
    originalName: 'ficticio.png',
    reason: 'Prueba',
  });
  assert.equal(response.status, 503);
  // Los errores 5xx conservan el filtro genérico; la UI consulta disponibilidad.
  assert.equal((await response.json()).message, 'Ocurrió un error interno.');
  const put = await fetch(`${origin}/api/v1/documents/uploads/${id}/content`, {
    method: 'PUT',
    headers: {
      Cookie: browser.cookie,
      Origin: APP_ORIGIN,
      'X-CSRF-Token': browser.csrfToken,
      'Content-Type': 'application/octet-stream',
    },
    body: 'archivo ficticio',
  });
  assert.equal(put.status, 503);
  assert.deepEqual(calls, []);
  state.capabilities = [];
  assert.equal((await browser.post('documents/uploads', {})).status, 403);
});
test('documentos aplican guard, DTO, alcance y CSRF incluso al recibir bytes', async (t) => {
  const calls = [];
  const { browser, state, origin } = await application(t, {
    uploadMode: 'verified',
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
  assert.deepEqual(
    await (await browser.request('documents/upload-availability')).json(),
    { enabled: true },
  );
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

test('filtros, clasificación y traslado respetan sesión, permisos, revisión y CSRF', async (t) => {
  const calls = [];
  const destination = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const { browser, state } = await application(t, {
    rpc: {
      execute: async (token, operation, input) => {
        assert.match(token, /local-private-aal2/);
        calls.push({ operation, input });
        if (operation === 'documento.buscar') return [];
        if (operation === 'documento.destinos')
          return [
            {
              expediente_id: destination,
              folio_interno: 'KVG-FICTICIO',
              descripcion: 'no exponer',
            },
          ];
        if (operation === 'catalogos.consultar')
          return { categorias: [{ categoria_id: id, nombre: 'Ficticio' }] };
        return { documento_id: id, expediente_id: destination, revision: 3 };
      },
    },
  });
  assert.equal((await browser.request('documents?text=ficticio')).status, 401);
  await authenticated(browser);
  const permit = (permission) => ({
    permission,
    context: 'EXPLICITO',
    requiresMfa: true,
    requiresDecision: false,
  });
  state.capabilities = [permit('documento.consultar')];
  assert.equal(
    (await browser.request('documents/search-categories')).status,
    200,
  );
  assert.equal(
    (await browser.request('documents?order=arbitrario')).status,
    400,
  );
  assert.equal(
    (await browser.request('documents?from=2026-11-17&to=2026-11-01')).status,
    400,
  );
  const found = await browser.request(
    'documents?text=contrato&client=Ficticio&folio=KVG&order=nombre&limit=5',
  );
  assert.equal(found.status, 200);
  assert.deepEqual(await found.json(), {
    items: [],
    offset: 0,
    limit: 5,
    hasMore: false,
  });
  assert.deepEqual(calls.at(-1), {
    operation: 'documento.buscar',
    input: {
      texto: 'contrato',
      cliente: 'Ficticio',
      folio: 'KVG',
      orden: 'nombre',
      limite: 6,
      desplazamiento: 0,
    },
  });
  const patch = (path, body, csrf = browser.csrfToken) =>
    browser.request(`documents/${id}/${path}`, {
      method: 'PATCH',
      body,
      headers: { Origin: APP_ORIGIN, 'X-CSRF-Token': csrf },
    });
  const classification = {
    revision: 2,
    categoryId: id,
    reason: 'CORREGIR_CLASIFICACION',
  };
  assert.equal((await patch('category', classification)).status, 403);
  state.capabilities.push(
    permit('documento.clasificar'),
    permit('documento.asociar'),
  );
  assert.equal((await patch('category', classification, '')).status, 403);
  assert.equal(
    (await patch('category', { ...classification, revision: '2' })).status,
    400,
  );
  assert.equal(
    (await patch('category', { ...classification, reason: 'dato libre' }))
      .status,
    400,
  );
  assert.equal(
    (await patch('category', { ...classification, versionId: id })).status,
    400,
  );
  assert.equal((await patch('category', classification)).status, 200);
  assert.deepEqual(calls.at(-1), {
    operation: 'documento.clasificar',
    input: {
      documento_id: id,
      revision: 2,
      categoria_id: id,
      motivo: 'CORREGIR_CLASIFICACION',
    },
  });
  const catalog = await browser.request(
    `documents/${id}/destinations?text=KVG`,
  );
  assert.equal(catalog.status, 200);
  assert.deepEqual((await catalog.json()).items, [
    { id: destination, folio: 'KVG-FICTICIO' },
  ]);
  assert.equal(
    (
      await patch('association', {
        revision: 2,
        destinationId: destination,
        reason: '   ',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await patch('association', {
        revision: 2,
        destinationId: destination,
        reason: '  Traslado ficticio  ',
      })
    ).status,
    200,
  );
  assert.deepEqual(calls.at(-1), {
    operation: 'documento.asociar',
    input: {
      documento_id: id,
      revision: 2,
      expediente_destino_id: destination,
      motivo: 'Traslado ficticio',
    },
  });
});

test('metadatos, carga nueva e historial mantienen contratos y permisos separados', async (t) => {
  const calls = [];
  const versionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const { browser, state } = await application(t, {
    uploadMode: 'beta',
    rpc: {
      execute: async (token, operation, input) => {
        calls.push({ token, operation, input });
        if (operation === 'documento.actualizar')
          return { documento_id: id, expediente_id: id, revision: 4 };
        if (operation === 'documento.cargar')
          return { carga_id: id, documento_id: id, estado: 'RECIBIENDO' };
        if (operation === 'documento.versiones')
          return [
            {
              version_id: versionId,
              numero_version: 1,
              estado_documento_codigo: 'RECIBIDO',
              sha256: 'a'.repeat(64),
              formato: 'PNG',
              tamano_bytes: 500,
              publicado_en: '2026-11-17T12:00:00Z',
              autor: 'Autor ficticio',
              motivo: 'Primera entrega',
              vigente: true,
              puede_descargar: false,
              sin_antimalware: true,
              revisiones: [],
              localizador_objeto: 'Interno y excluido por el adaptador',
            },
          ];
        throw new Error('RPC inesperada');
      },
    },
  });
  const permit = (permission) => ({
    permission,
    context: 'EXPLICITO',
    requiresMfa: true,
    requiresDecision: false,
  });
  const path = `documents/${id}`;
  const list = path + '/versions';
  assert.equal((await browser.request(list)).status, 401);
  await authenticated(browser);
  state.capabilities = [permit('documento.consultar')];
  const metadata = {
    revision: 3,
    name: '  Título ficticio  ',
    reason: ' Corrección ',
  };
  const version = {
    revision: 3,
    requestId: id,
    originalName: 'Ficticio.png',
    reason: '  Otra entrega  ',
  };
  const patch = (body, token = browser.csrfToken) =>
    browser.request(path + '/metadata', {
      method: 'PATCH',
      body,
      headers: { Origin: APP_ORIGIN, 'X-CSRF-Token': token },
    });
  assert.equal((await patch(metadata)).status, 403);
  assert.equal((await browser.post(list, version)).status, 403);
  assert.equal((await browser.request(list)).status, 403);
  state.capabilities.push(permit('documento.actualizar'));
  assert.equal((await patch(metadata, '')).status, 403);
  assert.equal((await patch({ ...metadata, reason: '  ' })).status, 400);
  assert.equal((await patch({ ...metadata, categoryId: id })).status, 400);
  assert.equal(
    (await browser.post(list, { ...version, caseId: id })).status,
    400,
  );
  assert.equal(
    (await browser.post(list, { ...version, originalName: 'ficticio.exe' }))
      .status,
    400,
  );
  assert.equal(
    (await browser.post(list, { ...version, revision: '3' })).status,
    400,
  );
  assert.deepEqual(calls, []);
  assert.equal((await patch(metadata)).status, 200);
  assert.deepEqual(calls.at(-1).input, {
    documento_id: id,
    revision: 3,
    nombre: 'Título ficticio',
    motivo: 'Corrección',
  });
  assert.equal((await browser.post(list, version)).status, 201);
  assert.deepEqual(calls.at(-1).input, {
    documento_id: id,
    revision: 3,
    clave_idempotencia: id,
    nombre_original: 'Ficticio.png',
    motivo: 'Otra entrega',
  });
  state.capabilities.push(permit('documento.versiones'));
  assert.equal((await browser.request(list + '?text=texto')).status, 400);
  const page = await browser.request(list + '?limit=1');
  assert.equal(page.status, 200);
  const { items } = await page.json();
  assert.equal(items[0].id, versionId);
  assert.equal(items[0].canDownload, false);
  assert.equal(items[0].current, true);
  assert.equal(items[0].beta, true);
  assert(!JSON.stringify(items).includes('localizador'));
  assert.equal(
    (await browser.request(`documents/versions/${versionId}/download`)).status,
    403,
  );
  assert(calls.every((call) => typeof call.token === 'string' && call.token));
});

test('revisión y estado documental conservan versión, guard, CSRF y evidencia tipada', async (t) => {
  const versionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const reviewId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const calls = [];
  const { browser, state } = await application(t, {
    rpc: {
      execute: async (token, operation, input) => {
        calls.push({ token, operation, input });
        if (operation === 'documento.revision')
          return {
            version_id: versionId,
            estado: 'EN_REVISION',
            revision: 2,
            numero_version: 1,
            vigente: true,
            puede_revisar: true,
            transiciones: [{ destino: 'VALIDADO', requiere_revision: true }],
            eventos: [
              {
                tipo: 'revision',
                id: reviewId,
                autor: 'Abogacía ficticia',
                fecha: '2026-11-17T12:00:00Z',
                resultado: 'APTO_PARA_VALIDAR',
                observaciones: 'Cotejo ficticio',
                corrige_id: null,
                corregida: false,
              },
            ],
          };
        if (operation === 'documento.revisar')
          return {
            revision_juridica_id: reviewId,
            version_vigente_cambio: true,
          };
        if (operation === 'documento.cambiar_estado')
          return { version_id: versionId, estado: 'VALIDADO', revision: 3 };
        throw new Error('RPC inesperada');
      },
    },
  });
  const permit = (permission) => ({
    permission,
    context: 'PRINCIPAL',
    requiresMfa: true,
    requiresDecision: false,
  });
  const path = `documents/${id}/versions/${versionId}`;
  const review = {
    requestId: id,
    result: 'APTO_PARA_VALIDAR',
    observations: ' Cotejo ficticio ',
  };
  const status = {
    revision: 2,
    status: 'VALIDADO',
    reason: ' Evidencia aprobada ',
    reviewId,
  };
  const patch = (body, csrf = browser.csrfToken) =>
    browser.request(path + '/state', {
      method: 'PATCH',
      body,
      headers: { Origin: APP_ORIGIN, 'X-CSRF-Token': csrf },
    });
  assert.equal((await browser.request(path + '/review')).status, 401);
  await authenticated(browser);
  state.capabilities = [permit('documento.consultar')];
  assert.equal((await browser.post(path + '/review', review)).status, 403);
  assert.equal((await patch(status, '')).status, 403);
  assert.equal((await patch({ ...status, versionId })).status, 400);
  assert.equal((await patch({ ...status, revision: '2' })).status, 400);
  assert.equal((await patch({ ...status, reviewId: null })).status, 400);
  assert.equal(
    (await browser.request(`documents/${id}/versions/ajena/review`)).status,
    400,
  );
  const timeline = await browser.request(path + '/review?limit=1&offset=0');
  assert.equal(timeline.status, 200);
  const workspace = await timeline.json();
  assert.equal(workspace.versionId, versionId);
  assert.deepEqual(workspace.transitions, [
    { status: 'VALIDADO', requiresReview: true },
  ]);
  assert.equal(workspace.timeline.items[0].observations, 'Cotejo ficticio');
  assert.deepEqual(calls.at(-1).input, {
    documento_id: id,
    version_id: versionId,
    limite: 2,
    desplazamiento: 0,
  });
  state.capabilities.push(
    permit('documento.revisar'),
    permit('documento.validar'),
  );
  assert.equal(
    (
      await browser.request(path + '/review', {
        method: 'POST',
        body: review,
        headers: { Origin: APP_ORIGIN },
      })
    ).status,
    403,
  );
  assert.equal(
    (await browser.post(path + '/review', { ...review, authorId: id })).status,
    400,
  );
  assert.equal(
    (await browser.post(path + '/review', { ...review, observations: '  ' }))
      .status,
    400,
  );
  assert.equal(
    (await browser.post(path + '/review', { ...review, result: 'VALIDADO' }))
      .status,
    400,
  );
  const saved = await browser.post(path + '/review', review);
  assert.equal(saved.status, 201);
  assert.deepEqual(await saved.json(), {
    id: reviewId,
    currentVersionChanged: true,
  });
  assert.deepEqual(calls.at(-1).input, {
    documento_id: id,
    version_id: versionId,
    solicitud_id: id,
    resultado: 'APTO_PARA_VALIDAR',
    observaciones: 'Cotejo ficticio',
  });
  const changed = await patch(status);
  assert.equal(changed.status, 200);
  assert.deepEqual(await changed.json(), {
    versionId,
    status: 'VALIDADO',
    revision: 3,
  });
  assert.deepEqual(calls.at(-1).input, {
    documento_id: id,
    version_id: versionId,
    revision: 2,
    estado: 'VALIDADO',
    motivo: 'Evidencia aprobada',
    revision_juridica_id: reviewId,
  });
  assert(calls.every((call) => call.token.startsWith('local-private-aal2')));
});
