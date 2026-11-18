import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  application,
  authenticated,
  APP_ORIGIN,
} from './helpers/identity-application.mjs';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const authId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const permit = (permission, context = 'GLOBAL_OPERATIVO') => ({
  permission,
  context,
  requiresMfa: true,
  requiresDecision: false,
});

test('las operaciones de personal usan el JWT administrativo y acotan datos, permisos y proveedor', async (t) => {
  const calls = [];
  const profile = {
    usuario_id: id,
    nombre: 'Abogacía ficticia',
    correo_operativo: 'ficticio@example.test',
    estado_cuenta: 'INVITADO',
    revision: 1,
  };
  const { browser, state } = await application(t, {
    rpc: {
      async execute(token, op, input) {
        calls.push({ token, op, input });
        if (op === 'usuario.invitar') return profile;
        if (op === 'usuario.listar') {
          if (
            !state.capabilities.some((item) =>
              item.permission.startsWith('usuario.'),
            )
          )
            throw new ForbiddenException();
          return [profile];
        }
        if (op === 'usuario.destino_invitacion')
          return { correo: profile.correo_operativo };
        if (op === 'usuario.desactivar')
          return {
            ...profile,
            estado_cuenta: 'DESACTIVADO',
            revision: 2,
            auth_id: authId,
          };
        if (op === 'seguridad.otorgar_rol') return {};
        throw new Error('RPC inesperado');
      },
    },
    staffAuth: {
      async invite(email) {
        calls.push({ provider: 'invite', email });
      },
      async block(id) {
        calls.push({ provider: 'block', id });
        return false;
      },
    },
  });
  const form = {
    name: ' Persona ficticia ',
    email: '  FICTICIO@example.test ',
    reason: ' Alta ficticia ',
    requestId: id,
  };
  assert.equal((await browser.request('staff/users')).status, 401);
  await authenticated(browser);
  state.capabilities = [];
  assert.equal((await browser.post('staff/users', form)).status, 403);
  assert.equal((await browser.request('staff/users')).status, 403);
  state.capabilities.push(permit('usuario.administrar'));
  assert.equal(
    (await browser.post('staff/users', { ...form, role: 'ADMINISTRADOR' }))
      .status,
    400,
  );
  const created = await browser.post('staff/users', form);
  assert.equal(created.status, 201);
  assert.equal((await created.json()).email, 'ficticio@example.test');
  assert(calls.at(-1).token.startsWith('local-private-aal2'));
  assert.deepEqual(calls.at(-1).input, {
    nombre: 'Persona ficticia',
    correo: 'ficticio@example.test',
    motivo: 'Alta ficticia',
    solicitud_id: id,
  });
  assert.equal(
    calls.some((call) => call.provider),
    false,
  );
  assert.equal(
    (
      await browser.request(`staff/users/${id}/invite`, {
        method: 'POST',
        headers: { Origin: APP_ORIGIN },
        body: {},
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await browser.post(`staff/users/${id}/invite`, {
        email: 'ajeno@example.test',
      })
    ).status,
    400,
  );
  assert.equal(
    (await browser.post(`staff/users/${id}/invite`, {})).status,
    200,
  );
  assert.deepEqual(calls.at(-1), {
    provider: 'invite',
    email: profile.correo_operativo,
  });
  const change = (body) =>
    browser.request(`staff/users/${id}/roles`, {
      method: 'PATCH',
      body,
      headers: { Origin: APP_ORIGIN, 'X-CSRF-Token': browser.csrfToken },
    });
  const role = {
    role: 'ABOGADO',
    revision: 1,
    action: 'grant',
    approval: 'Acta de prueba',
    reason: 'Autorización ficticia',
  };
  assert.equal((await change(role)).status, 403);
  state.capabilities.push(permit('usuario.permisos'));
  assert.equal((await change({ ...role, approval: ' ' })).status, 400);
  assert.equal((await change(role)).status, 204);
  assert.equal(calls.at(-1).op, 'seguridad.otorgar_rol');
  const disabled = await browser.post(`staff/users/${id}/deactivate`, {
    revision: 1,
    reason: 'Baja ficticia',
  });
  assert.equal(disabled.status, 200);
  const result = await disabled.json();
  assert.equal(result.providerBlocked, false);
  assert.equal(result.account.status, 'DESACTIVADO');
  assert(!JSON.stringify(result).includes(authId));
});

test('aceptar la invitación exige CSRF y revalida la identidad al reintentar la contraseña', async (t) => {
  const calls = [];
  let fail = true;
  const { browser } = await application(t, {
    rpc: {
      async execute(token, op) {
        calls.push(op);
        assert.equal(token, 'private-invitation-token');
        return {};
      },
    },
    staffAuth: {
      async verifyInvite() {
        calls.push('provider.verify');
        return 'private-invitation-token';
      },
      async setInvitedPassword(token) {
        assert.equal(token, 'private-invitation-token');
        calls.push('provider.password');
        if (fail)
          throw new BadRequestException(
            'Contraseña descartada por el proveedor.',
          );
      },
    },
  });
  const path = 'auth/invitation/complete';
  const body = {
    tokenHash: 'b'.repeat(56),
    password: 'ficticio-solamente-local',
  };
  assert.equal(
    (
      await browser.request(path, {
        method: 'POST',
        body,
        headers: { Origin: APP_ORIGIN },
      })
    ).status,
    403,
  );
  await browser.csrf();
  const failed = await browser.post(path, body);
  assert.equal(failed.status, 400);
  assert.deepEqual(calls, [
    'provider.verify',
    'identidad.validar_invitacion',
    'provider.password',
  ]);
  fail = false;
  const saved = await browser.post(path, { password: body.password });
  assert.equal(saved.status, 204);
  assert.deepEqual(calls.slice(3), [
    'identidad.validar_invitacion',
    'provider.password',
  ]);
  assert.equal((await browser.request('auth/me')).status, 401);
  assert.equal(
    (await browser.post(path, { password: body.password })).status,
    401,
  );
});
