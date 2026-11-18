import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  APP_ORIGIN,
  application,
  authenticated,
} from './helpers/identity-application.mjs';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const at = '2026-11-18T05:22:13.123456+00:00';
const auditRow = {
  evento_id: id,
  ocurrido_en: at,
  tipo_actor: 'USUARIO',
  usuario_id: second,
  actor: 'Administración ficticia',
  accion: 'AUTORIZACION_DESCARGA',
  recurso_tipo: 'VERSION',
  recurso_id: id,
  resultado: 'EXITO',
  correlacion_id: second,
  sesion_id: 'no debe aparecer',
};

function permit(permission, context = 'GLOBAL_OPERATIVO') {
  return { permission, context, requiresMfa: true, requiresDecision: false };
}

test('bitácora aplica permiso y alcance, conserva el cursor exacto y proyecta el detalle seguro', async (t) => {
  const calls = [];
  const { browser, state } = await application(t, {
    rpc: {
      async execute(token, op, input) {
        assert.match(token, /^local-private-aal2-access-/);
        calls.push({ op, input });
        if (op === 'auditoria.consultar')
          return [auditRow, { ...auditRow, evento_id: second }];
        if (op === 'auditoria.detalle')
          return {
            ...auditRow,
            revision: 2,
            cantidad: null,
            detalle_controlado: { campos: ['privado'] },
          };
        throw new Error('RPC inesperado');
      },
    },
  });
  assert.equal((await browser.request('audit')).status, 401);
  await authenticated(browser);
  state.capabilities = [
    permit('configuracion.administrar'),
    permit('auditoria.consultar', 'PRINCIPAL'),
  ];
  assert.equal((await browser.request('audit')).status, 403);
  assert.equal((await browser.request('audit/' + id)).status, 403);
  state.capabilities.push(permit('auditoria.consultar'));
  assert.equal(
    (await browser.request('audit?from=2026-11-19&to=2026-11-18')).status,
    400,
  );
  assert.equal((await browser.request('audit?beforeId=' + id)).status, 400);
  assert.equal((await browser.request('audit?from=2026-02-30')).status, 400);
  assert.deepEqual(calls, []);

  const query = new URLSearchParams({
    from: '2026-11-18',
    to: '2026-11-18',
    actor: ' Administración ',
    action: 'DESCARGA',
    resource: 'VERSION',
    result: 'EXITO',
    limit: '1',
  });
  const list = await browser.request('audit?' + query);
  assert.equal(list.status, 200);
  const page = await list.json();
  assert.equal(page.items.length, 1);
  assert.deepEqual(page.next, { beforeAt: at, beforeId: id });
  assert.equal(page.items[0].correlationId, second);
  assert.equal(Object.hasOwn(page.items[0], 'sesion_id'), false);
  assert.deepEqual(calls.shift(), {
    op: 'auditoria.consultar',
    input: {
      limite: 2,
      desde: '2026-11-18T00:00:00Z',
      hasta: '2026-11-19T00:00:00.000Z',
      actor: 'Administración',
      accion: 'DESCARGA',
      recurso: 'VERSION',
      resultado: 'EXITO',
    },
  });
  assert.equal(
    (await browser.request('audit?' + new URLSearchParams(page.next))).status,
    200,
  );
  assert.deepEqual(calls.shift().input, {
    limite: 21,
    antes_de: at,
    antes_id: id,
  });

  const detail = await browser.request('audit/' + id);
  assert.equal(detail.status, 200);
  const data = await detail.json();
  assert.equal(data.revision, 2);
  assert.equal(data.quantity, null);
  assert.doesNotMatch(
    JSON.stringify(data),
    /sesion_id|detalle_controlado|privado/,
  );
  state.capabilities = [];
  assert.equal((await browser.request('audit/' + id)).status, 403);
});

test('configuración requiere sesión, permiso, CSRF, confirmación, motivo y revisión válida', async (t) => {
  const calls = [];
  const { browser, state } = await application(t, {
    rpc: {
      async execute(token, op, input) {
        assert.match(token, /^local-private-aal2-access-/);
        calls.push({ op, input });
        if (op === 'configuracion.catalogos')
          return {
            parametros: [
              {
                parametro_codigo: 'sistema.bloqueado',
                valor: 'false',
                regla_validacion: 'INTERNO',
                editable: false,
                revision: 1,
                modificado_por: id,
              },
            ],
            categorias: [],
            identificaciones: [],
            matriz: ['no debe aparecer'],
          };
        return {};
      },
    },
  });
  const category = {
    code: 'FICTICIO',
    name: ' Prueba ',
    confirmed: true,
    reason: ' Motivo ficticio ',
  };
  const parameter = 'configuration/parameters/sesion.duracion_horas';
  function patch(
    path,
    body,
    headers = { Origin: APP_ORIGIN, 'X-CSRF-Token': browser.csrfToken },
  ) {
    return browser.request(path, { method: 'PATCH', body, headers });
  }
  await authenticated(browser);
  state.capabilities = [permit('auditoria.consultar')];
  assert.equal((await browser.request('configuration')).status, 403);
  assert.equal(
    (await browser.post('configuration/categories', category)).status,
    403,
  );
  state.capabilities.push(permit('configuracion.administrar'));
  const snapshot = await browser.request('configuration');
  assert.equal(snapshot.status, 200);
  assert.deepEqual(await snapshot.json(), {
    parameters: [
      {
        code: 'sistema.bloqueado',
        value: 'false',
        rule: 'INTERNO',
        editable: false,
        revision: 1,
      },
    ],
    categories: [],
    identifications: [],
  });
  calls.length = 0;
  assert.equal(
    (
      await browser.post('configuration/categories', {
        ...category,
        confirmed: false,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await browser.post('configuration/categories', {
        ...category,
        reason: '  ',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await patch(
        parameter,
        { confirmed: true, reason: 'Prueba', revision: 1, value: 8 },
        { Origin: APP_ORIGIN },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await patch(parameter, {
        confirmed: true,
        reason: 'Prueba',
        revision: 1,
        value: 9,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await patch('configuration/parameters/sistema.bloqueado', {
        confirmed: true,
        reason: 'Prueba',
        revision: 1,
        value: 1,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await patch('configuration/identification-types/FICTICIO', {
        confirmed: true,
        reason: 'Prueba',
        revision: 1,
        active: false,
        name: 'Prueba',
        unique: false,
      })
    ).status,
    400,
  );
  assert.deepEqual(calls, []);

  assert.equal(
    (await browser.post('configuration/categories', category)).status,
    204,
  );
  assert.equal(
    (
      await patch('configuration/categories/' + id, {
        confirmed: true,
        reason: 'Desactivación',
        revision: 2,
        active: false,
        name: 'Prueba',
        description: null,
      })
    ).status,
    204,
  );
  assert.equal(
    (
      await patch(parameter, {
        confirmed: true,
        reason: 'Prueba',
        revision: 1,
        value: 8,
      })
    ).status,
    204,
  );
  assert.deepEqual(calls, [
    {
      op: 'configuracion.categoria',
      input: {
        codigo: 'FICTICIO',
        nombre: 'Prueba',
        motivo: 'Motivo ficticio',
      },
    },
    {
      op: 'configuracion.categoria',
      input: {
        categoria_id: id,
        revision: 2,
        activo: false,
        nombre: 'Prueba',
        descripcion: null,
        motivo: 'Desactivación',
      },
    },
    {
      op: 'configuracion.parametro',
      input: {
        codigo: 'sesion.duracion_horas',
        revision: 1,
        valor: 8,
        motivo: 'Prueba',
      },
    },
  ]);
});
