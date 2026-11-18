import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import {
  developmentConfig,
  ownerConnection,
  localDirectory,
  reportSetupFailure,
  DevelopmentSetupError,
} from './lib/development-database.mjs';
import {
  isDevelopmentEmail,
  readDevelopmentFixture,
} from './lib/development-identities.mjs';
import { DevelopmentBrowser } from './lib/development-http.mjs';

let app,
  owner,
  stage = 'CONFIGURACION';
const browsers = [];
const checks = [];
function check(condition, description) {
  if (!condition)
    throw new DevelopmentSetupError(`Comprobación no superada: ${description}`);
  checks.push(description);
}
try {
  const config = await developmentConfig();
  const fixture = await readDevelopmentFixture(config);
  owner = await ownerConnection(config);
  const known = await owner.query('SELECT correo_operativo FROM kvg.usuario');
  check(
    known.rows.length > 0 &&
      known.rows.every((user) =>
        isDevelopmentEmail(fixture, user.correo_operativo),
      ),
    'entorno_solo_identidades_ficticias_conocidas',
  );
  const { AppModule } = await import('../dist/app.module.js');
  const { configureApp } = await import('../dist/configure-app.js');
  const { ServerSessions } =
    await import('../dist/modules/identity/presentation/server-sessions.service.js');
  const { KvgRpcService } =
    await import('../dist/infrastructure/supabase/kvg-rpc.service.js');
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const rpc = app.get(KvgRpcService);
  const sessions = app.get(ServerSessions);
  async function login(role) {
    const browser = new DevelopmentBrowser(origin);
    browsers.push(browser);
    const state = await browser.login(
      fixture.accounts.find((account) => account.role === role),
    );
    check(state.user.roles.includes(role), `rol_${role}_con_mfa_real`);
    const sid = decodeURIComponent(browser.cookie.split('=')[1])
      .slice(2)
      .split('.')[0];
    const stored = await new Promise((resolve, reject) =>
      sessions.runtime.store.get(sid, (error, value) =>
        error ? reject(error) : resolve(value),
      ),
    );
    return {
      browser,
      token: stored.authentication.accessToken,
      user: state.user,
    };
  }
  stage = 'IDENTIDADES';
  const secretary = await login('SECRETARIA');
  const legal = await login('ABOGADO');
  const admin = await login('ADMINISTRADOR');
  const anonymous = new DevelopmentBrowser(origin);
  check(
    (await anonymous.request('clients')).status === 401,
    'consulta_anonima_denegada',
  );
  check(
    (await secretary.browser.request('clients', 'POST', {})).status === 403,
    'alta_sin_csrf_denegada',
  );
  const tag = randomUUID().replaceAll('-', '').slice(0, 12);
  const input = {
    requestId: randomUUID(),
    name: `Cliente ficticio recorrido ${tag}`,
    identifications: [{ type: 'PRUEBA_KVG', value: `dev-${tag}` }],
    contacts: [
      { type: 'CORREO', value: `ficticio.${tag}@example.com`, preferred: true },
    ],
  };
  check(
    (await admin.browser.mutate('clients', input)).status === 403,
    'administrador_no_registra_clientes',
  );
  check(
    (await legal.browser.mutate('clients', input)).status === 403,
    'abogado_sin_permiso_de_alta_denegado',
  );
  check(
    (await secretary.browser.mutate('clients', { ...input, name: '  ' }))
      .status === 400,
    'nombre_vacio_rechazado',
  );
  check(
    (
      await secretary.browser.mutate('clients', {
        ...input,
        creado_por: admin.user.id,
      })
    ).status === 400,
    'autoria_falsificada_rechazada',
  );

  stage = 'CLIENTE';
  const concurrent = await Promise.all([
    secretary.browser.mutate('clients', input),
    secretary.browser.mutate('clients', input),
  ]);
  check(
    concurrent.every((item) => item.status === 201),
    'alta_cliente_concurrente_correcta',
  );
  check(
    concurrent[0].data.id === concurrent[1].data.id,
    'reintento_cliente_conserva_identificador',
  );
  const client = concurrent[0].data;
  const readClient = await secretary.browser.request(`clients/${client.id}`);
  check(
    readClient.status === 200 && readClient.data.contacts.length === 1,
    'cliente_y_contacto_persistidos',
  );
  check(
    !JSON.stringify(readClient.data).includes('auth_usuario_id') &&
      !JSON.stringify(readClient.data).includes('accessToken'),
    'salida_cliente_sin_datos_tecnicos',
  );
  check(
    (await legal.browser.request(`clients/${client.id}`)).status === 403,
    'abogado_no_ve_cliente_sin_alcance',
  );
  check(
    (
      await secretary.browser.mutate('clients', {
        ...input,
        name: 'Contenido distinto',
      })
    ).status === 409,
    'uuid_reutilizado_con_otro_contenido_rechazado',
  );
  const duplicate = await secretary.browser.mutate('clients', {
    ...input,
    requestId: randomUUID(),
    identifications: [
      { type: 'PRUEBA_KVG', value: `DEV ${tag.toUpperCase()}` },
    ],
  });
  check(duplicate.status === 409, 'identificacion_unica_normalizada_rechazada');
  const equalName = await secretary.browser.mutate('clients', {
    ...input,
    requestId: randomUUID(),
    identifications: [],
  });
  check(
    equalName.status === 201 && equalName.data.id !== client.id,
    'nombre_igual_no_impide_cliente_distinto',
  );
  const clientsCount = await owner.query(
    'SELECT count(*)::integer AS count FROM kvg.cliente WHERE nombre_presentacion=$1',
    [input.name],
  );
  check(
    clientsCount.rows[0].count === 2,
    'rechazos_y_reintentos_sin_cliente_parcial',
  );
  const firstPage = await secretary.browser.request(
    `clients?text=${encodeURIComponent(tag)}&limit=1&offset=0`,
  );
  const nextPage = await secretary.browser.request(
    `clients?text=${encodeURIComponent(tag)}&limit=1&offset=1`,
  );
  check(
    firstPage.status === 200 &&
      firstPage.data.hasMore &&
      firstPage.data.items[0].id !== nextPage.data.items[0].id,
    'paginacion_clientes_sin_repetir_filas',
  );

  stage = 'CONSULTA_Y_EDICION_CLIENTE';
  const clientPath = `clients/${client.id}`;
  const filter = new URLSearchParams({
    text: tag,
    identification: `DEV ${tag.toUpperCase()}`,
    limit: '1',
  });
  const found = await secretary.browser.request(`clients?${filter}`);
  check(
    found.status === 200 &&
      found.data.items[0]?.id === client.id &&
      !found.data.hasMore,
    'filtro_nombre_e_identificacion_normalizada',
  );
  const hidden = await legal.browser.request(`clients?${filter}`);
  check(
    hidden.status === 200 && hidden.data.items.length === 0,
    'identificacion_no_revela_cliente_ajeno',
  );
  const literal = await secretary.browser.request(
    `clients?text=${encodeURIComponent(tag + '%')}`,
  );
  check(
    literal.status === 200 && literal.data.items.length === 0,
    'nombre_busca_texto_literal',
  );
  check(
    readClient.data.canEdit === true,
    'detalle_indica_edicion_recurso_propio',
  );
  const editCatalog = await secretary.browser.request(
    `${clientPath}/edit-identification-types`,
  );
  check(
    editCatalog.status === 200 &&
      editCatalog.data.some((item) => item.code === 'PRUEBA_KVG'),
    'catalogo_de_edicion_autorizado',
  );
  const edit = (browser, data, path = clientPath) =>
    browser.mutate(path, data, 'PATCH');
  const expected = {
    revision: client.revision,
    name: `Nombre corregido ${tag}`,
  };
  check(
    (await edit(admin.browser, expected)).status === 403,
    'administrador_no_edita_cliente',
  );
  check(
    (await edit(legal.browser, expected)).status === 403,
    'abogado_sin_permiso_no_edita_cliente',
  );
  check(
    (await secretary.browser.request(clientPath, 'PATCH', expected)).status ===
      403,
    'edicion_sin_csrf_denegada',
  );
  check(
    (
      await edit(secretary.browser, {
        ...expected,
        contacts: [{ type: 'CORREO', value: 'incorrecto' }],
      })
    ).status === 400,
    'edicion_contacto_invalido_rechazado',
  );
  check(
    (await edit(secretary.browser, { ...expected, type: 'OTRO' })).status ===
      400,
    'edicion_campo_protegido_rechazado',
  );
  check(
    (
      await edit(
        secretary.browser,
        {
          revision: equalName.data.revision,
          name: 'No debe persistir',
          identifications: [
            { type: 'PRUEBA_KVG', value: `DEV ${tag.toUpperCase()}` },
          ],
        },
        `clients/${equalName.data.id}`,
      )
    ).status === 409,
    'edicion_identificacion_normalizada_duplicada',
  );
  const unchanged = await secretary.browser.request(
    `clients/${equalName.data.id}`,
  );
  check(
    unchanged.data?.name === input.name &&
      unchanged.data?.revision === equalName.data.revision &&
      unchanged.data?.identifications.length === 0,
    'duplicado_revierte_edicion_completa',
  );
  const revisions = await Promise.all([
    edit(secretary.browser, expected),
    edit(secretary.browser, { ...expected, name: `Otra corrección ${tag}` }),
  ]);
  check(
    revisions
      .map((r) => r.status)
      .sort()
      .join(',') === '200,409',
    'edicion_concurrente_solo_una_revision_gana',
  );
  const latest = await secretary.browser.request(clientPath);
  check(
    latest.data?.revision === client.revision + 1 &&
      latest.data?.name === revisions.find((r) => r.status === 200).data.name &&
      latest.data?.contacts.length === 1 &&
      latest.data?.identifications.length === 1,
    'revision_vigente_conserva_colecciones_omitidas',
  );
  const media = await edit(secretary.browser, {
    revision: latest.data.revision,
    identifications: [{ type: 'PRUEBA_KVG', value: `nuevo-${tag}` }],
    contacts: [
      {
        type: 'TELEFONO',
        value: '+52 555 010 1234',
        label: 'Oficina',
        preferred: true,
      },
    ],
  });
  const persisted = await secretary.browser.request(clientPath);
  check(
    media.status === 200 &&
      persisted.data?.identifications[0]?.value === `nuevo-${tag}` &&
      persisted.data?.contacts[0]?.label === 'Oficina' &&
      persisted.data?.contacts.length === 1,
    'actualizacion_persiste_identificacion_y_contacto',
  );
  const retired = await secretary.browser.request(`clients?${filter}`);
  check(
    retired.status === 200 && retired.data.items.length === 0,
    'identificacion_retirada_no_aparece',
  );
  const newMatch = await secretary.browser.request(
    `clients?identification=nuevo-${tag}`,
  );
  check(
    newMatch.status === 200 && newMatch.data.items[0]?.id === client.id,
    'identificacion_nueva_es_localizable',
  );

  stage = 'EXPEDIENTE';
  const caseInput = {
    requestId: randomUUID(),
    clientId: client.id,
    description: `Asunto ficticio ${tag}`,
    externalNumber: `EXT-${tag}`,
    externalAuthority: 'Autoridad ficticia de desarrollo',
  };
  const noClient = await secretary.browser.mutate('cases', {
    ...caseInput,
    requestId: randomUUID(),
    clientId: randomUUID(),
  });
  check(noClient.status === 403, 'cliente_no_accesible_no_crea_expediente');
  check(
    (
      await secretary.browser.mutate('cases', {
        ...caseInput,
        folio: 'FORZADO',
        status: 'CONCLUIDO',
      })
    ).status === 400,
    'folio_y_estado_no_se_aceptan_del_navegador',
  );
  const casesCreated = await Promise.all([
    secretary.browser.mutate('cases', caseInput),
    secretary.browser.mutate('cases', caseInput),
  ]);
  check(
    casesCreated.every((item) => item.status === 201),
    'alta_expediente_concurrente_correcta',
  );
  check(
    casesCreated[0].data.id === casesCreated[1].data.id,
    'reintento_expediente_sin_duplicacion',
  );
  const caseRecord = casesCreated[0].data;
  check(
    caseRecord.status === 'NUEVO' &&
      /^KVG-\d{4}-\d{10}$/.test(caseRecord.folio) &&
      caseRecord.folio !== caseRecord.externalNumber,
    'folio_servidor_y_estado_nuevo',
  );
  const detail = await secretary.browser.request(`cases/${caseRecord.id}`);
  check(
    detail.status === 200 &&
      detail.data.history.length === 1 &&
      detail.data.history[0].to === 'NUEVO',
    'detalle_y_historial_inicial',
  );
  const grants = await owner.query(
    'SELECT concesion_id FROM kvg.concesion_acceso WHERE expediente_id=$1 AND usuario_id=$2 AND revocado_en IS NULL',
    [caseRecord.id, secretary.user.id],
  );
  check(grants.rowCount === 1, 'concesion_inicial_explicita');
  check(
    (await legal.browser.request(`cases/${caseRecord.id}`)).status === 403,
    'otro_actor_con_capacidad_no_ve_expediente',
  );
  const hiddenCases = await legal.browser.request(
    `cases?text=${encodeURIComponent(tag)}`,
  );
  const hiddenClients = await legal.browser.request(
    `clients?text=${encodeURIComponent(tag)}`,
  );
  check(
    hiddenCases.data.items.length === 0 &&
      hiddenClients.data.items.length === 0,
    'listados_sin_relaciones_ni_cantidades_ajenas',
  );
  check(
    (await admin.browser.request(`cases/${caseRecord.id}`)).status === 403,
    'administrador_no_obtiene_lectura_juridica',
  );

  stage = 'EDICION_EXPEDIENTE';
  const casePath = `cases/${caseRecord.id}`;
  const caseEdit = (browser, data) => browser.mutate(casePath, data, 'PATCH');
  const caseInputFilter = new URLSearchParams({
    client: tag,
    text: caseRecord.externalNumber,
    status: 'NUEVO',
    limit: '1',
  });
  const ownFiltered = await secretary.browser.request(
    `cases?${caseInputFilter}`,
  );
  const foreignFiltered = await legal.browser.request(
    `cases?${caseInputFilter}`,
  );
  check(
    ownFiltered.status === 200 &&
      ownFiltered.data.items[0]?.id === caseRecord.id &&
      foreignFiltered.status === 200 &&
      !foreignFiltered.data.items.length,
    'filtros_combinados_de_expediente_con_alcance',
  );
  check(
    detail.data.canEdit && detail.data.clientName === persisted.data.name,
    'ficha_muestra_nombre_cliente_y_edicion_autorizada',
  );
  const editData = {
    revision: caseRecord.revision,
    reason: 'CORREGIR_CAPTURA',
    description: `Expediente actualizado ${tag}`,
  };
  check(
    (await secretary.browser.request(casePath, 'PATCH', editData)).status ===
      403,
    'expediente_edicion_sin_csrf',
  );
  check(
    (await caseEdit(legal.browser, editData)).status === 403,
    'abogado_con_capacidad_sin_alcance_no_edita',
  );
  check(
    (await caseEdit(admin.browser, editData)).status === 403,
    'administrador_no_edita_expediente',
  );
  check(
    (await caseEdit(secretary.browser, { ...editData, status: 'ARCHIVADO' }))
      .status === 400,
    'expediente_rechaza_estado_protegido',
  );
  check(
    (
      await caseEdit(secretary.browser, {
        ...editData,
        externalNumber: 'FALTA-AUTORIDAD',
      })
    ).status === 400,
    'expediente_rechaza_referencia_incompleta',
  );
  let protectedCode;
  try {
    await rpc.execute(secretary.token, 'expediente.actualizar', {
      expediente_id: caseRecord.id,
      revision: caseRecord.revision,
      motivo: editData.reason,
      cliente_id: equalName.data.id,
    });
  } catch (failure) {
    protectedCode = failure.getStatus?.();
  }
  check(protectedCode === 400, 'rpc_directa_protege_cliente_principal');
  const caseCsrf = await secretary.browser.request('auth/csrf');
  check(
    caseCsrf.status === 200,
    'expediente_csrf_disponible_antes_de_concurrencia',
  );
  const concurrentCaseEdit = (data) =>
    secretary.browser.request(casePath, 'PATCH', data, {
      'X-CSRF-Token': caseCsrf.data.csrfToken,
    });
  const race = await Promise.all([
    concurrentCaseEdit(editData),
    concurrentCaseEdit({ ...editData, description: `Otra corrección ${tag}` }),
  ]);
  check(
    race
      .map((r) => r.status)
      .sort()
      .join(',') === '200,409',
    'expediente_ediciones_concurrentes',
  );
  const winning = race.find((r) => r.status === 200).data;
  check(
    winning.revision === caseRecord.revision + 1 &&
      winning.folio === caseRecord.folio &&
      winning.clientId === caseRecord.clientId &&
      winning.status === caseRecord.status,
    'edicion_conserva_folio_cliente_y_estado',
  );
  const clearedReference = await caseEdit(secretary.browser, {
    revision: winning.revision,
    reason: 'ACTUALIZAR_REFERENCIA',
    externalNumber: null,
    externalAuthority: null,
  });
  const updatedCase = await secretary.browser.request(casePath);
  check(
    clearedReference.status === 200 &&
      updatedCase.data.externalNumber === null &&
      updatedCase.data.externalAuthority === null &&
      updatedCase.data.history.length === detail.data.history.length &&
      updatedCase.data.progress.length === detail.data.progress.length,
    'edicion_retira_referencia_y_conserva_historial_y_avances',
  );

  stage = 'ASIGNACION_Y_REVOCACION';
  await rpc.execute(secretary.token, 'expediente.asignar', {
    expediente_id: caseRecord.id,
    revision: updatedCase.data.revision,
    abogado_id: legal.user.id,
    funcion: 'PRINCIPAL',
    motivo:
      'Asignación ficticia para verificar consulta por alcance en el paso 3.',
  });
  const assigned = await legal.browser.request(`cases/${caseRecord.id}`);
  check(
    assigned.status === 200 &&
      assigned.data.assignments.some(
        (item) =>
          item.userId === legal.user.id &&
          item.active &&
          item.name === legal.user.name,
      ),
    'principal_consulta_expediente_y_nombre',
  );
  const byPrincipal = await legal.browser.request(
    `cases?${new URLSearchParams({ client: tag, responsible: legal.user.name, status: 'NUEVO' })}`,
  );
  const wrongPrincipal = await legal.browser.request(
    `cases?${new URLSearchParams({ client: tag, responsible: 'sin coincidencias ' + tag })}`,
  );
  check(
    byPrincipal.status === 200 &&
      byPrincipal.data.items.some((item) => item.id === caseRecord.id) &&
      wrongPrincipal.status === 200 &&
      !wrongPrincipal.data.items.length,
    'filtro_abogado_principal_vigente',
  );
  check(assigned.data.canEdit, 'abogado_principal_puede_editar');
  const legalClient = await legal.browser.request(clientPath);
  check(
    legalClient.status === 200 && legalClient.data.canEdit === false,
    'principal_consulta_cliente_del_expediente_sin_edicion',
  );
  await rpc.execute(admin.token, 'seguridad.revocar_concesion', {
    concesion_id: grants.rows[0].concesion_id,
    motivo: 'Ensayo ficticio de revocación inmediata por recurso.',
  });
  check(
    (await secretary.browser.request(`cases/${caseRecord.id}`)).status === 403,
    'concesion_revocada_denegada_con_cookie_vigente',
  );
  check(
    (await secretary.browser.request(`clients/${client.id}`)).status === 403,
    'cliente_de_expediente_revocado_denegado',
  );
  check(
    (await secretary.browser.mutate('cases', caseInput)).status === 403,
    'reintento_idempotente_revalida_alcance',
  );
  check(
    (
      await edit(secretary.browser, {
        revision: persisted.data.revision,
        name: 'Cambio sin alcance',
      })
    ).status === 403,
    'edicion_denegada_tras_revocar_alcance_con_cookie_vigente',
  );
  check(
    (
      await caseEdit(secretary.browser, {
        revision: assigned.data.revision,
        reason: 'CORREGIR_CAPTURA',
        description: 'Cambio revocado',
      })
    ).status === 403,
    'edicion_expediente_denegada_tras_revocacion',
  );
  const caseAudit = await owner.query(
    `SELECT usuario_id, detalle_controlado FROM kvg.evento_auditoria
    WHERE recurso_id=$1 AND accion='EXPEDIENTE_DATOS_ACTUALIZADOS'`,
    [caseRecord.id],
  );
  check(
    caseAudit.rows.length === 2 &&
      caseAudit.rows.every((entry) => entry.usuario_id === secretary.user.id) &&
      caseAudit.rows.some(
        (entry) =>
          entry.detalle_controlado.codigo === 'CORREGIR_CAPTURA' &&
          entry.detalle_controlado.campos.includes('descripcion'),
      ) &&
      caseAudit.rows.some(
        (entry) => entry.detalle_controlado.codigo === 'ACTUALIZAR_REFERENCIA',
      ),
    'auditoria_edicion_expediente_con_actor_motivo_y_campos',
  );
  const audit = await owner.query(
    'SELECT accion,usuario_id FROM kvg.evento_auditoria WHERE recurso_id IN ($1::uuid,$2::uuid)',
    [client.id, caseRecord.id],
  );
  check(
    audit.rows.some(
      (item) =>
        item.accion === 'cliente.insert' &&
        item.usuario_id === secretary.user.id,
    ) &&
      audit.rows.some(
        (item) =>
          item.accion === 'expediente.insert' &&
          item.usuario_id === secretary.user.id,
      ),
    'auditoria_de_altas_con_actor_real',
  );
  check(
    audit.rows.some((item) => item.accion === 'CLIENTE_CONSULTAR') &&
      audit.rows.some((item) => item.accion === 'EXPEDIENTE_CONSULTAR'),
    'auditoria_de_consultas_reales',
  );
  check(
    audit.rows.filter(
      (item) =>
        item.accion === 'cliente.update' &&
        item.usuario_id === secretary.user.id,
    ).length === 2,
    'auditoria_registra_solo_ediciones_confirmadas_con_actor_real',
  );
  const requests = await owner.query(
    'SELECT count(*)::integer AS count FROM kvg_privado.solicitud_creacion WHERE usuario_id=$1 AND solicitud_id IN ($2::uuid,$3::uuid)',
    [secretary.user.id, input.requestId, caseInput.requestId],
  );
  check(
    requests.rows[0].count === 2,
    'solicitudes_confirmadas_una_vez_por_alta',
  );
  const report = {
    date: new Date().toISOString(),
    result: 'passed',
    checks,
    realDataUsed: false,
    deploymentVerified: false,
  };
  await writeFile(
    `${localDirectory}/records-live-verification.json`,
    JSON.stringify(report, null, 2) + '\n',
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      resultado: 'correcto',
      comprobaciones: checks.length,
      detalle: checks,
      datos_reales: false,
      credenciales_publicadas: false,
    }),
  );
} catch (error) {
  reportSetupFailure(stage, error);
  process.exitCode = 1;
} finally {
  for (const browser of browsers)
    await browser.mutate('auth/logout', {}).catch(() => undefined);
  await owner?.end().catch(() => undefined);
  await app?.close().catch(() => undefined);
}
