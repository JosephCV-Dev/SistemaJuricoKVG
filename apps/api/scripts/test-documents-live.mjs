import { documentUploadMode } from '../dist/config/document-upload-mode.js';
import { ServerSessions } from '../dist/modules/identity/presentation/server-sessions.service.js';
import { KvgRpcService } from '../dist/infrastructure/supabase/kvg-rpc.service.js';
import 'reflect-metadata';
import { writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { AppModule } from '../dist/app.module.js';
import { configureApp } from '../dist/configure-app.js';
import { PrivateFileGateway } from '../dist/modules/documents/infrastructure/private-file-gateway.js';
import { DocumentWorker } from '../dist/modules/operations/application/document-worker.js';
import { IsolatedFileVerifier } from '../dist/modules/operations/infrastructure/isolated-file-verifier.js';
import {
  developmentConfig,
  ownerConnection,
  localDirectory,
  DevelopmentSetupError,
  reportSetupFailure,
} from './lib/development-database.mjs';
import {
  isDevelopmentEmail,
  readDevelopmentFixture,
} from './lib/development-identities.mjs';
import { DevelopmentBrowser } from './lib/development-http.mjs';
let app, owner;
const browsers = [];
const checks = [];
let stage = 'CONFIGURACION';
const check = (ok, name) => {
  if (!ok) throw new DevelopmentSetupError(`Comprobación no superada: ${name}`);
  checks.push(name);
};
try {
  const config = await developmentConfig();
  if (documentUploadMode(process.env) !== 'verified')
    throw new DevelopmentSetupError(
      'Prueba documental pospuesta: las cargas están pausadas.',
    );
  const fixture = await readDevelopmentFixture(config);
  owner = await ownerConnection(config);
  const users = await owner.query('SELECT correo_operativo FROM kvg.usuario');
  check(
    users.rows.every((r) => isDevelopmentEmail(fixture, r.correo_operativo)),
    'entorno_solo_identidades_ficticias_conocidas',
  );
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const login = async (role) => {
    const b = new DevelopmentBrowser(origin);
    browsers.push(b);
    b.user = (
      await b.login(fixture.accounts.find((a) => a.role === role))
    ).user;
    return b;
  };
  const secretary = await login('SECRETARIA'),
    lawyer = await login('ABOGADO'),
    admin = await login('ADMINISTRADOR');
  check(
    (await new DevelopmentBrowser(origin).request('documents/categories'))
      .status === 401,
    'documentos_exigen_identidad',
  );
  check(
    (await admin.request('documents/categories')).status === 403,
    'administrador_sin_carga_juridica',
  );
  let r = await secretary.mutate('clients', {
    requestId: randomUUID(),
    name: `Cliente documental ficticio ${randomUUID().slice(0, 8)}`,
    identifications: [],
    contacts: [],
  });
  check(r.status === 201, 'cliente_ficticio');
  r = await secretary.mutate('cases', {
    requestId: randomUUID(),
    clientId: r.data.id,
    description: 'Expediente documental ficticio 3B.',
  });
  check(r.status === 201, 'expediente_ficticio');
  const caseId = r.data.id;
  const cats = await secretary.request('documents/categories');
  check(
    cats.status === 200 && cats.data.length > 0,
    'catalogo_real_categorias',
  );
  const data = {
    caseId,
    categoryId: cats.data[0].id,
    name: 'Documento ficticio 3B',
    originalName: 'ficticio.png',
    reason: 'Prueba funcional ficticia.',
    requestId: randomUUID(),
  };
  const created = await secretary.mutate('documents/uploads', data);
  check(created.status === 201, 'registro_carga_usuario_real');
  const id = created.data.id,
    documentId = created.data.documentId;
  const repeat = await secretary.mutate('documents/uploads', data);
  check(repeat.data.id === id, 'creacion_idempotente');
  check(
    (
      await secretary.mutate('documents/uploads', {
        ...data,
        name: 'Otro nombre',
      })
    ).status === 403,
    'misma_clave_no_cambia_metadatos',
  );
  check(
    (await lawyer.request(`documents/uploads/${id}`)).status === 403,
    'otra_identidad_no_inspecciona_carga',
  );
  check(
    (await lawyer.request(`documents/${documentId}`)).status === 403,
    'otra_identidad_no_consulta_documento',
  );
  const bytes = await sharp({
    create: { width: 12, height: 12, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer();
  async function content(browser, uploadId, payload, csrf = true) {
    const c = await browser.request('auth/csrf');
    const response = await fetch(
      `${origin}/api/v1/documents/uploads/${uploadId}/content`,
      {
        method: 'PUT',
        headers: {
          Cookie: browser.cookie,
          Origin: process.env.APP_ORIGIN,
          'Content-Type': 'application/octet-stream',
          ...(csrf ? { 'X-CSRF-Token': c.data.csrfToken } : {}),
        },
        body: payload,
      },
    );
    return { status: response.status, data: await response.json() };
  }
  check(
    (await content(secretary, id, bytes, false)).status === 403,
    'carga_binaria_exige_csrf',
  );
  check(
    (await content(lawyer, id, bytes)).status === 403,
    'otra_identidad_no_transfiere',
  );
  check(
    (await content(secretary, id, Buffer.alloc(0))).status === 400,
    'rechaza_archivo_vacio',
  );
  check(
    (await content(secretary, id, bytes)).data.state ===
      'PENDIENTE_VERIFICACION',
    'cuarentena_recibida',
  );
  check(
    (await content(secretary, id, bytes)).status === 200,
    'reintento_binario_identico',
  );
  check(
    (await content(secretary, id, Buffer.from('otro archivo'))).status === 409,
    'reintento_no_sobrescribe_contenido',
  );
  check(
    (await secretary.request(`documents/${documentId}`)).data.version === null,
    'sin_version_antes_del_analisis',
  );
  const anonymous = await fetch(
    `${config.api}/storage/v1/object/public/kvg-cuarentena/cargas/${id}/original`,
  );
  check(!anonymous.ok, 'cuarentena_sin_url_publica');
  const privateFiles = new PrivateFileGateway(new ConfigService(process.env));
  const worker = new DocumentWorker(
    privateFiles,
    new IsolatedFileVerifier('127.0.0.1', 3310),
  );
  stage = 'ANALISIS_REAL';
  check(
    (await worker.once()) === 'published',
    'clamav_y_estructura_publican_png_real',
  );
  const status = (await secretary.request(`documents/uploads/${id}`)).data;
  check(
    status.state === 'HABILITADO' && !!status.versionId,
    'version_habilitada',
  );
  check((await worker.once()) === 'idle', 'trabajo_publicado_no_se_duplica');
  const detail = (await secretary.request(`documents/${documentId}`)).data;
  check(
    detail.version?.sha256 === createHash('sha256').update(bytes).digest('hex'),
    'sha256_confiable',
  );
  check(
    !/localizador|secret|token|bucket/.test(JSON.stringify(detail)),
    'detalle_no_expone_localizadores_credenciales',
  );
  const dl = await fetch(
    `${origin}/api/v1/documents/versions/${status.versionId}/download`,
    { headers: { Cookie: secretary.cookie } },
  );
  check(
    dl.status === 200 && Buffer.from(await dl.arrayBuffer()).equals(bytes),
    'descarga_original_identica',
  );
  check(
    dl.headers.get('content-disposition').startsWith('attachment;'),
    'descarga_adjunto_no_vista_activa',
  );
  check(
    (
      await fetch(
        `${origin}/api/v1/documents/versions/${status.versionId}/download`,
        { headers: { Cookie: lawyer.cookie } },
      )
    ).status === 403,
    'descarga_denegada_otra_identidad',
  );
  check(
    (
      await fetch(
        `${origin}/api/v1/documents/versions/${status.versionId}/download`,
        { headers: { Cookie: admin.cookie } },
      )
    ).status === 403,
    'descarga_denegada_admin',
  );
  for (const [label, payload] of [
    ['estructura', Buffer.from('archivo de texto renombrado')],
    [
      'antimalware',
      Buffer.from(
        [
          'X5O!P%@AP[4',
          '\\PZX54(P^)7CC)7}$',
          'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
        ].join(''),
      ),
    ],
  ]) {
    const upload = await secretary.mutate('documents/uploads', {
      ...data,
      requestId: randomUUID(),
      name: `Prueba ficticia ${label}`,
    });
    await content(secretary, upload.data.id, payload);
    check((await worker.once()) === 'rejected', `rechazo_real_${label}`);
    check(
      (await secretary.request(`documents/uploads/${upload.data.id}`)).data
        .state === 'RECHAZADO',
      `rechazo_no_habilita_${label}`,
    );
    check(
      (await secretary.request(`documents/${upload.data.documentId}`)).data
        .version === null,
      `sin_version_${label}`,
    );
  }
  const audit = await owner.query(
    'SELECT accion FROM kvg.evento_auditoria WHERE recurso_id=ANY($1::uuid[])',
    [[documentId, status.versionId]],
  );
  check(
    audit.rows.some((a) => a.accion === 'AUTORIZACION_DESCARGA'),
    'autorizacion_descarga_auditada',
  );
  const versions = await owner.query(
    'SELECT count(*)::int AS n FROM kvg.version_documento WHERE carga_id=$1',
    [id],
  );
  check(versions.rows[0].n === 1, 'una_carga_una_version');
  const sessions = app.get(ServerSessions);
  async function userToken(browser) {
    const sid = decodeURIComponent(browser.cookie.split('=')[1])
      .slice(2)
      .split('.')[0];
    const stored = await new Promise((resolve, reject) =>
      sessions.runtime.store.get(sid, (error, value) =>
        error ? reject(error) : resolve(value),
      ),
    );
    return stored.authentication.accessToken;
  }
  const secretaryToken = await userToken(secretary);
  const direct = await fetch(
    `${config.api}/storage/v1/object/kvg-originales/versiones/${id}/original`,
    {
      headers: {
        apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${secretaryToken}`,
      },
    },
  );
  check(!direct.ok, 'usuario_autorizado_no_salta_broker_storage');
  const quarantine = await fetch(
    `${config.api}/storage/v1/object/kvg-cuarentena/cargas/${id}/original`,
    {
      headers: {
        apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${secretaryToken}`,
      },
    },
  );
  check(!quarantine.ok, 'ni_autor_descarga_cuarentena_directamente');
  const grant = await owner.query(
    'SELECT concesion_id FROM kvg.concesion_acceso WHERE expediente_id=$1 AND usuario_id=$2 AND revocado_en IS NULL',
    [caseId, secretary.user.id],
  );
  check(grant.rowCount === 1, 'concesion_explicita_del_exp_documental');
  await app
    .get(KvgRpcService)
    .execute(await userToken(admin), 'seguridad.revocar_concesion', {
      concesion_id: grant.rows[0].concesion_id,
      motivo: 'Ensayo ficticio de revocación de acceso documental.',
    });
  check(
    (await secretary.request(`documents/${documentId}`)).status === 403,
    'revocacion_impide_detalle_con_cookie_vigente',
  );
  check(
    (await secretary.request(`documents/uploads/${id}`)).status === 403,
    'revocacion_impide_estado_y_recepcion',
  );
  check(
    (
      await fetch(
        `${origin}/api/v1/documents/versions/${status.versionId}/download`,
        { headers: { Cookie: secretary.cookie } },
      )
    ).status === 403,
    'revocacion_impide_nueva_descarga',
  );
  check(
    (await secretary.request(`documents?caseId=${caseId}`)).data.items
      .length === 0,
    'revocacion_oculta_listado_sin_recuento_ajeno',
  );
  await writeFile(
    `${localDirectory}/documents-live-verification.json`,
    JSON.stringify(
      {
        date: '2026-11-04',
        result: 'passed',
        checks,
        caseId,
        documentId,
        versionId: status.versionId,
        realDataUsed: false,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      resultado: 'correcto',
      comprobaciones: checks.length,
      detalle: checks,
    }),
  );
} catch (error) {
  reportSetupFailure(stage, error);
  process.exitCode = 1;
} finally {
  for (const b of browsers)
    await b.mutate('auth/logout', {}).catch(() => undefined);
  await app?.close();
  await owner?.end();
}
