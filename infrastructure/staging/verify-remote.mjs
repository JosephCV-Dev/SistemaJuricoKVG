import sharp from 'sharp';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { validateStagingSettings } from './preflight.mjs';
import { developmentTotp } from '../../apps/api/scripts/lib/development-identities.mjs';

// Prueba de aceptación explícita. Escribe únicamente clientes/expedientes/archivos
// ficticios en el entorno de pruebas identificado; no ejecuta migraciones ni usa owner.
let stage = 'CONFIGURATION';
const checks = [],
  sessions = [];
const check = (ok, name) => {
  if (!ok) throw new Error(name);
  checks.push(name);
};
try {
  check(
    process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
    'validacion_tls_activada',
  );
  const config = parseEnv(await readFile(process.argv[2], 'utf8'));
  const target = validateStagingSettings(config);
  const fixture = JSON.parse(await readFile(process.argv[3], 'utf8'));
  check(
    fixture.environment === 'staging' &&
      fixture.projectReference === target.projectReference,
    'fixture_exclusiva_del_proyecto_de_pruebas',
  );
  for (const role of ['SECRETARIA', 'ABOGADO', 'ADMINISTRADOR'])
    check(
      fixture.accounts?.some(
        (a) =>
          a.role === role &&
          a.email.endsWith('@example.com') &&
          a.password &&
          a.totpSecret &&
          a.factorId,
      ),
      `identidad_ficticia_${role}`,
    );
  async function request(
    path,
    { cookie = '', method = 'GET', body, headers = {}, binary = false } = {},
  ) {
    const r = await fetch(target.origin + '/api/v1/' + path, {
      method,
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(45000),
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined
          ? {
              Origin: target.origin,
              'Content-Type': binary
                ? 'application/octet-stream'
                : 'application/json',
            }
          : {}),
        ...headers,
      },
      ...(body === undefined
        ? {}
        : { body: binary ? body : JSON.stringify(body) }),
    });
    const bytes = Buffer.from(await r.arrayBuffer());
    let json = null;
    if (r.headers.get('content-type')?.includes('application/json'))
      json = JSON.parse(bytes.toString());
    return {
      status: r.status,
      headers: r.headers,
      bytes,
      json,
      cookie: r.headers.getSetCookie().at(-1)?.split(';')[0],
    };
  }
  async function browser(role) {
    const account = fixture.accounts.find((a) => a.role === role);
    const b = {
      cookie: '',
      async get(path) {
        const r = await request(path, { cookie: this.cookie });
        if (r.cookie) this.cookie = r.cookie;
        return r;
      },
      async mutate(path, body, method = 'POST', binary = false) {
        const csrf = await this.get('auth/csrf');
        check(csrf.status === 200, 'csrf_remoto_disponible');
        const r = await request(path, {
          cookie: this.cookie,
          method,
          body,
          binary,
          headers: { 'X-CSRF-Token': csrf.json.csrfToken },
        });
        if (r.cookie) this.cookie = r.cookie;
        return r;
      },
    };
    sessions.push(b);
    const login = await b.mutate('auth/login', {
      email: account.email,
      password: account.password,
    });
    check(
      login.status === 200 && login.json.status === 'mfa_required',
      `password_y_desafio_${role}`,
    );
    const mfa = await b.mutate('auth/mfa/verify', {
      factorId: account.factorId,
      code: developmentTotp(account.totpSecret),
    });
    check(
      mfa.status === 200 && mfa.json.status === 'authenticated',
      `mfa_real_${role}`,
    );
    check(
      mfa.headers
        .getSetCookie()
        .some(
          (c) =>
            c.startsWith('__Host-kvg.sid=') &&
            /; Secure/i.test(c) &&
            /; HttpOnly/i.test(c) &&
            /; SameSite=Lax/i.test(c) &&
            !/; Domain=/i.test(c),
        ),
      `cookie_segura_${role}`,
    );
    return b;
  }
  stage = 'IDENTITY';
  check(
    (await request('documents/categories')).status === 401,
    'anonimo_denegado',
  );
  const secretary = await browser('SECRETARIA'),
    lawyer = await browser('ABOGADO'),
    admin = await browser('ADMINISTRADOR');
  stage = 'BUSINESS';
  const availability = await secretary.get('documents/upload-availability');
  check(
    availability.status === 200 && availability.json.enabled === true,
    'cargas_habilitadas_para_ensayo_completo',
  );
  let r = await secretary.mutate('clients', {
    requestId: randomUUID(),
    name: `Cliente ficticio HTTPS ${randomUUID().slice(0, 8)}`,
    identifications: [],
    contacts: [],
  });
  check(r.status === 201, 'cliente_creado');
  r = await secretary.mutate('cases', {
    requestId: randomUUID(),
    clientId: r.json.id,
    description: 'Ensayo ficticio HTTPS del prototipo RUP 16.6.',
  });
  check(r.status === 201, 'expediente_creado');
  const caseId = r.json.id;
  check(
    (await lawyer.get(`cases/${caseId}`)).status === 403,
    'otro_usuario_sin_alcance_denegado',
  );
  check(
    (await admin.get(`cases/${caseId}`)).status === 403,
    'admin_sin_lectura_juridica',
  );
  const catalog = await secretary.get('documents/categories');
  check(
    catalog.status === 200 && catalog.json.length > 0,
    'catalogo_documental_real',
  );
  const input = {
    requestId: randomUUID(),
    caseId,
    name: 'Original ficticio HTTPS',
    categoryId: catalog.json[0].id,
    originalName: 'ficticio.png',
    reason: 'Ensayo de despliegue con datos ficticios.',
  };
  const upload = await secretary.mutate('documents/uploads', input);
  check(upload.status === 201, 'autorizacion_carga_real');
  const bytes = await sharp({
    create: { width: 12, height: 12, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer();
  r = await secretary.mutate(
    `documents/uploads/${upload.json.id}/content`,
    bytes,
    'PUT',
    true,
  );
  check(r.status === 200, 'recepcion_privada_real');
  check(
    (await lawyer.get(`documents/uploads/${upload.json.id}`)).status === 403,
    'otra_identidad_no_consulta_carga',
  );
  stage = 'ANALYSIS';
  let status;
  for (let attempt = 0; attempt < 40; attempt++) {
    const result = await secretary.get(`documents/uploads/${upload.json.id}`);
    status = result.json;
    if (status?.state === 'HABILITADO' || status?.state === 'RECHAZADO') break;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  check(
    status?.state === 'HABILITADO',
    'trabajador_y_antimalware_habilitan_original',
  );
  const download = await secretary.get(
    `documents/versions/${status.versionId}/download`,
  );
  check(
    download.status === 200 && download.bytes.equals(bytes),
    'descarga_integra_autorizada',
  );
  check(
    (await lawyer.get(`documents/versions/${status.versionId}/download`))
      .status === 403,
    'descarga_ajena_denegada',
  );
  check(
    (await admin.get(`documents/versions/${status.versionId}/download`))
      .status === 403,
    'descarga_admin_denegada',
  );
  const hash = createHash('sha256').update(bytes).digest('hex');
  const detail = await secretary.get(`documents/${upload.json.documentId}`);
  check(
    detail.status === 200 && detail.json.version.sha256 === hash,
    'hash_de_servidor_verificado',
  );
  stage = 'LOGOUT';
  for (const b of sessions) {
    await b.mutate('auth/logout', {});
    check((await b.get('cases')).status === 401, 'logout_invalida_cookie');
  }
  const output = {
    date: new Date().toISOString(),
    origin: target.origin,
    result: 'passed',
    checks,
    remoteDeployment: true,
    providerAuthenticated: true,
    recoveryVerified: false,
    fullStep3Complete: false,
    realDataUsed: false,
  };
  const path = resolve(
    process.argv[4] ?? '/tmp/kvg-staging-remote-verification.json',
  );
  await writeFile(path, JSON.stringify(output, null, 2) + '\n', {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      result: 'passed',
      checks: checks.length,
      recoveryVerified: false,
      fullStep3Complete: false,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      result: 'failed',
      stage,
      reason: /^[a-z0-9_]+$/.test(error.message ?? '')
        ? error.message
        : 'Prueba incompleta; detalles privados ocultos.',
    }),
  );
  process.exitCode = 1;
} finally {
  for (const b of sessions)
    await b.mutate('auth/logout', {}).catch(() => undefined);
}
