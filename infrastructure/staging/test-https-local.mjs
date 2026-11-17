import { spawn } from 'node:child_process';
import { request } from 'node:https';
import {
  readFile,
  writeFile,
  mkdtemp,
  rm,
  chmod,
  mkdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';

// Solo infraestructura local: TLS real, proxy y persistencia de cookie. No simula
// negocio/Auth/Storage ni acredita un despliegue remoto del prototipo.
const postgresImage =
  'postgres@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab';
const prefix = `kvg-https-${randomUUID().slice(0, 8)}`;
const testPort = Number(process.env.HTTPS_SMOKE_PORT ?? 18443);
const names = [],
  checks = [];
let directory,
  networkCreated = false,
  stage = 'PREPARACION';
const root = fileURLToPath(new URL('../../', import.meta.url));
function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error());
    }, 120000);
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error());
    });
    child.stdout.on('data', (b) => {
      out += b.toString();
      if (out.length > 4_000_000) child.kill();
    });
    child.stderr.on('data', () => undefined);
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out) : reject(new Error('command_failed'));
    });
  });
}
const docker = (args, input) => run('docker', args, input);
const check = (ok, name) => {
  if (!ok) throw new Error(name);
  checks.push(name);
};
async function wait(action) {
  let last;
  for (let i = 0; i < 45; i++) {
    try {
      return await action();
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw last ?? new Error('wait_failed');
}
try {
  check(
    Number.isInteger(testPort) && testPort > 1024 && testPort < 65536,
    'puerto_local_valido',
  );
  directory = await mkdtemp(join(tmpdir(), 'kvg-https-'));
  await chmod(directory, 0o700);
  await run('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '2',
    '-keyout',
    join(directory, 'pg.key'),
    '-out',
    join(directory, 'pg.crt'),
    '-subj',
    '/CN=sessions',
    '-addext',
    'subjectAltName=DNS:sessions',
  ]);
  const password = randomBytes(32).toString('hex');
  const secrets = {
    supabase_secret: 'sb_secret_unused_local_smoke_fixture',
    session_secret: randomBytes(48).toString('hex'),
    session_encryption_key: randomBytes(32).toString('base64'),
    session_database_url: `postgresql://kvg_session_store:${password}@sessions:5432/postgres?sslmode=verify-full&sslrootcert=/run/secrets/session_database_ca`,
    pg_password: randomBytes(32).toString('hex'),
  };
  for (const [name, value] of Object.entries(secrets))
    await writeFile(join(directory, name), value, { mode: 0o600 });
  // El usuario node de la imagen tiene UID 1000; el runner de CI puede usar otro.
  if (process.getuid?.() !== 1000)
    await docker([
      'run',
      '--rm',
      '--network',
      'none',
      '-v',
      `${directory}:/fixture`,
      '--entrypoint',
      'sh',
      postgresImage,
      '-c',
      'chown 1000:1000 /fixture/*',
    ]);
  await docker(['network', 'create', prefix]);
  networkCreated = true;
  const database = prefix + '-sessions';
  names.push(database);
  await docker([
    'run',
    '-d',
    '--name',
    database,
    '--network',
    prefix,
    '--network-alias',
    'sessions',
    '--memory',
    '256m',
    '--tmpfs',
    '/var/lib/postgresql/data:rw,nosuid,size=128m',
    '--tmpfs',
    '/private:rw,nosuid,size=8m',
    '-v',
    `${directory}:/fixture:ro`,
    '-e',
    'POSTGRES_PASSWORD_FILE=/fixture/pg_password',
    '--entrypoint',
    'sh',
    postgresImage,
    '-c',
    'cp /fixture/pg.key /private/server.key && cp /fixture/pg.crt /private/server.crt && chown postgres:postgres /private/server.key /private/server.crt && chmod 600 /private/server.key && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/private/server.crt -c ssl_key_file=/private/server.key',
  ]);
  await wait(() => docker(['exec', database, 'pg_isready', '-U', 'postgres']));
  const sql = (source) =>
    docker(
      [
        'exec',
        '-i',
        database,
        'psql',
        '-U',
        'postgres',
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      source,
    );
  await sql(
    'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;',
  );
  await sql(
    await readFile(
      new URL(
        '../../database/migrations/202610280001_server_sessions.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  await sql(`ALTER ROLE kvg_session_store PASSWORD '${password}';`);
  check(true, 'postgres_efimero_con_rol_restringido_y_tls');
  const api = prefix + '-api';
  names.push(api);
  const mounts = [
    'supabase_secret',
    'session_secret',
    'session_encryption_key',
    'session_database_url',
  ].flatMap((name) => [
    '-v',
    `${join(directory, name)}:/run/secrets/${name}:ro`,
  ]);
  stage = 'API_PRODUCCION';
  await docker([
    'run',
    '-d',
    '--name',
    api,
    '--network',
    prefix,
    '--network-alias',
    'api',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--tmpfs',
    '/tmp:rw,nosuid,size=16m',
    ...mounts,
    '-v',
    `${join(directory, 'pg.crt')}:/run/secrets/session_database_ca:ro`,
    '-e',
    'NODE_ENV=production',
    '-e',
    'API_HOST=0.0.0.0',
    '-e',
    'API_PORT=3000',
    '-e',
    `APP_ORIGIN=https://localhost:${testPort}`,
    '-e',
    'TRUST_PROXY=true',
    '-e',
    'SUPABASE_URL=https://unused-smoke.supabase.co',
    '-e',
    'SUPABASE_PUBLISHABLE_KEY=sb_publishable_unused_smoke',
    ...[
      'SUPABASE_SECRET_KEY:supabase_secret',
      'SESSION_SECRET:session_secret',
      'SESSION_ENCRYPTION_KEY:session_encryption_key',
      'SESSION_DATABASE_URL:session_database_url',
    ].flatMap((pair) => {
      const [key, name] = pair.split(':');
      return ['-e', `${key}_FILE=/run/secrets/${name}`];
    }),
    process.env.API_IMAGE ?? 'kvg-api:staging',
  ]);
  await wait(async () => {
    const r = await docker([
      'exec',
      api,
      'node',
      '-e',
      "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
    ]);
    return r;
  });
  check(
    (await docker(['exec', api, 'id', '-u'])).trim() === '1000',
    'api_sin_root',
  );
  const web = prefix + '-web';
  names.push(web);
  stage = 'HTTPS';
  await docker([
    'run',
    '-d',
    '--name',
    web,
    '--network',
    prefix,
    '-p',
    `127.0.0.1:${testPort}:443`,
    '-e',
    'STAGING_HOST=localhost',
    process.env.WEB_IMAGE ?? 'kvg-web:staging',
  ]);
  stage = 'HTTPS_INSPECT';
  const info = JSON.parse(await docker(['inspect', web]))[0];
  const port = Number(info.NetworkSettings.Ports['443/tcp'][0].HostPort);
  stage = 'HTTPS_CERTIFICATE';
  const ca = await wait(() =>
    docker(['exec', web, 'cat', '/data/caddy/pki/authorities/local/root.crt']),
  );
  function https(path, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port,
          servername: 'localhost',
          ca,
          rejectUnauthorized: true,
          path,
          method,
          headers: { Host: `localhost:${port}`, ...headers },
          timeout: 15000,
        },
        (res) => {
          const verified = res.socket.authorized;
          const chunks = [];
          res.on('data', (b) => chunks.push(b));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks),
              certificateVerified: verified,
            }),
          );
        },
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy());
      req.end(body);
    });
  }
  stage = 'HTTPS_REQUEST';
  const index = await wait(async () => {
    const r = await https('/');
    if (r.status !== 200) throw new Error(`https_status_${r.status}`);
    return r;
  });
  check(index.certificateVerified, 'https_valida_ca_sin_desactivar_tls');
  check(
    index.body.toString().includes('<div id="root">'),
    'web_estatica_real_compilada',
  );
  check(
    Boolean(index.headers['content-security-policy']) &&
      index.headers['x-content-type-options'] === 'nosniff',
    'cabeceras_web_seguras',
  );
  const health = await https('/api/v1/health');
  check(
    health.status === 200 && JSON.parse(health.body).service === 'kvg-api',
    'web_y_api_mismo_origen',
  );
  check(health.headers['cache-control'] === 'no-store', 'api_no_cache');
  check((await https('/.env')).status === 404, 'archivos_privados_no_servidos');
  const csrf = await https('/api/v1/auth/csrf');
  const cookies = csrf.headers['set-cookie'] ?? [];
  check(
    csrf.status === 200 && JSON.parse(csrf.body).csrfToken,
    'csrf_usa_persistencia_real',
  );
  const cookie = cookies.find((c) => c.startsWith('__Host-kvg.sid='));
  check(
    Boolean(cookie) &&
      /; Secure/i.test(cookie) &&
      /; HttpOnly/i.test(cookie) &&
      /; SameSite=Lax/i.test(cookie) &&
      /; Path=\//i.test(cookie) &&
      !/; Domain=/i.test(cookie),
    'cookie_host_secure_httponly_samesite',
  );
  const again = await https('/api/v1/auth/csrf', {
    headers: { Cookie: cookie.split(';')[0] },
  });
  check(
    again.status === 200 &&
      JSON.parse(again.body).csrfToken === JSON.parse(csrf.body).csrfToken,
    'cookie_recupera_estado_cifrado_de_postgresql',
  );
  const runtime = JSON.parse(
    await docker([
      'exec',
      api,
      'node',
      '-e',
      "const fs=require('node:fs');console.log(JSON.stringify({env:fs.existsSync('/app/apps/api/.env'),owner:Boolean(process.env.DATABASE_URL),secretEnv:Boolean(process.env.SUPABASE_SECRET_KEY)}))",
    ]),
  );
  check(
    !runtime.env && !runtime.owner && !runtime.secretEnv,
    'imagen_sin_env_ni_owner_ni_secreto_en_variables',
  );
  const identity = await https('/api/v1/auth/session', {
    headers: { Cookie: cookie.split(';')[0] },
  });
  check(
    identity.status === 200 && JSON.parse(identity.body).status === 'anonymous',
    'cookie_opaca_se_recupera_por_proxy_https',
  );
  const forbidden = await https('/api/v1/auth/login', {
    method: 'POST',
    headers: {
      Origin: 'https://foreign.invalid',
      Cookie: cookie.split(';')[0],
      'X-CSRF-Token': JSON.parse(csrf.body).csrfToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: 'fixture@example.com', password: 'fixture' }),
  });
  check(forbidden.status === 403, 'origen_ajeno_denegado_antes_del_proveedor');
  check(
    !Object.values(info.NetworkSettings.Ports).some((x) =>
      x?.some((p) => p.HostIp !== '127.0.0.1'),
    ),
    'ensayo_solo_loopback',
  );
  const apiInfo = JSON.parse(await docker(['inspect', api]))[0];
  check(
    !apiInfo.HostConfig.PortBindings ||
      Object.keys(apiInfo.HostConfig.PortBindings).length === 0,
    'api_sin_puerto_publicado',
  );
  const allowed = await https('/api/v1/auth/login', {
    method: 'POST',
    headers: {
      Origin: `https://localhost:${testPort}`,
      Cookie: cookie.split(';')[0],
      'X-CSRF-Token': JSON.parse(csrf.body).csrfToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: 'invalid', password: '' }),
  });
  check(allowed.status === 400, 'origen_valido_y_csrf_llegan_a_validacion_dto');
  await mkdir(join(root, 'apps/api/.local'), { recursive: true, mode: 0o700 });
  const result = {
    date: '2026-11-10',
    result: 'passed',
    checks,
    providerAuthenticated: false,
    remoteDeployment: false,
    scope: 'local-https-proxy-session-store-only',
  };
  await writeFile(
    join(root, 'apps/api/.local/staging-https-verification.json'),
    JSON.stringify(result, null, 2) + '\n',
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      result: 'passed',
      checks: checks.length,
      detail: checks,
      remoteDeployment: false,
      providerAuthenticated: false,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      result: 'failed',
      stage,
      reason: /^[a-z0-9_]+$/.test(error.message ?? '')
        ? error.message
        : 'No se completó la verificación local; detalles privados ocultos.',
      code: /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : undefined,
    }),
  );
  process.exitCode = 1;
} finally {
  for (const name of names.reverse())
    await docker(['rm', '-f', '-v', name]).catch(() => undefined);
  if (networkCreated)
    await docker(['network', 'rm', prefix]).catch(() => undefined);
  if (directory) await rm(directory, { recursive: true, force: true });
}
