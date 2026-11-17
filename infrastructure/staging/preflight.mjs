import { readFile, stat, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { X509Certificate } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export class StagingConfigurationError extends Error {}
const fail = (message) => {
  throw new StagingConfigurationError(message);
};
export function validateStagingSettings(values, knownDevelopmentUrl) {
  const host = values.STAGING_HOST;
  if (
    typeof host !== 'string' ||
    !/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(host) ||
    /example\.(com|org|net)$/.test(host) ||
    /\.localhost$/.test(host)
  )
    fail('Indica un dominio de pruebas real, sin protocolo ni puerto.');
  let staging, development;
  try {
    staging = new URL(values.SUPABASE_URL);
    development = new URL(values.DEVELOPMENT_SUPABASE_URL);
  } catch {
    fail('Indica los orígenes Supabase de pruebas y desarrollo.');
  }
  for (const url of [staging, development])
    if (
      url.protocol !== 'https:' ||
      !/^([a-z0-9]+)\.supabase\.co$/.test(url.hostname) ||
      url.pathname !== '/' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      fail('Usa los orígenes HTTPS de los proyectos Supabase.');
  if (staging.origin === development.origin)
    fail('Pruebas debe usar otro proyecto Supabase, separado de desarrollo.');
  if (
    knownDevelopmentUrl &&
    new URL(knownDevelopmentUrl).origin !== development.origin
  )
    fail(
      'La referencia de desarrollo no coincide con la configuración local existente.',
    );
  if (
    !/^sb_publishable_[A-Za-z0-9_-]+$/.test(
      values.SUPABASE_PUBLISHABLE_KEY ?? '',
    )
  )
    fail('Falta la clave publishable del proyecto de pruebas.');
  if (!isAbsolute(values.STAGING_SECRET_DIRECTORY ?? ''))
    fail(
      'El directorio de secretos debe estar fuera del repositorio y usar ruta absoluta.',
    );
  if (!['127.0.0.1', '0.0.0.0'].includes(values.STAGING_BIND_IP ?? '127.0.0.1'))
    fail('Revisa la dirección de escucha del proxy.');
  for (const name of ['API_IMAGE', 'WEB_IMAGE'])
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]*$/.test(values[name] ?? ''))
      fail('Indica imágenes construidas y verificadas para API y web.');
  for (const name of Object.keys(values))
    if (
      /DATABASE_URL|SESSION_SECRET|SESSION_ENCRYPTION_KEY|SUPABASE_SECRET_KEY/.test(
        name,
      )
    )
      fail(
        'Los secretos se montan como archivos, no se incluyen en settings.env.',
      );
  return {
    origin: `https://${host}`,
    projectReference: staging.hostname.split('.')[0],
    secretDirectory: values.STAGING_SECRET_DIRECTORY,
  };
}
export function validateStagingSecrets(values, projectReference) {
  if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(values.supabase_secret ?? ''))
    fail('El archivo supabase_secret no contiene una clave técnica válida.');
  if (
    (values.session_secret ?? '').length < 32 ||
    /\s/.test(values.session_secret)
  )
    fail('Revisa la clave de firma de sesiones.');
  const encryption = values.session_encryption_key ?? '';
  if (
    Buffer.from(encryption, 'base64').length !== 32 ||
    Buffer.from(encryption, 'base64').toString('base64') !== encryption
  )
    fail('Revisa la clave AES de sesiones.');
  let database;
  try {
    database = new URL(values.session_database_url);
  } catch {
    fail('Revisa la conexión SQL del rol de sesiones.');
  }
  const user = decodeURIComponent(database.username);
  const sameProject =
    (user === `kvg_session_store.${projectReference}` &&
      database.hostname.endsWith('.pooler.supabase.com')) ||
    (user === 'kvg_session_store' &&
      database.hostname === `db.${projectReference}.supabase.co`);
  if (
    !sameProject ||
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !database.password ||
    (database.port && database.port !== '5432') ||
    database.searchParams.get('sslmode') !== 'verify-full' ||
    database.searchParams.get('sslrootcert') !==
      '/run/secrets/session_database_ca'
  )
    fail(
      'El rol SQL debe corresponder a pruebas, puerto 5432 y TLS verify-full con la CA montada.',
    );
  try {
    const cert = new X509Certificate(values.session_database_ca);
    if (!cert.ca || Date.parse(cert.validTo) <= Date.now()) throw new Error();
  } catch {
    fail('La CA de PostgreSQL no es válida o venció.');
  }
}
export async function preflight(path) {
  const values = parseEnv(await readFile(path, 'utf8'));
  let known;
  try {
    known = parseEnv(
      await readFile(new URL('../../apps/api/.env', import.meta.url), 'utf8'),
    ).SUPABASE_URL;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const settings = validateStagingSettings(values, known);
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  const actualDirectory = await realpath(resolve(settings.secretDirectory));
  if ((actualDirectory + '/').startsWith(repository))
    fail('Guarda los secretos del alojamiento fuera del repositorio.');
  const directory = await stat(settings.secretDirectory);
  if (!directory.isDirectory() || (directory.mode & 0o007) !== 0)
    fail('El directorio de secretos no debe ser accesible a otros usuarios.');
  const secrets = {};
  for (const name of [
    'supabase_secret',
    'session_database_url',
    'session_secret',
    'session_encryption_key',
    'session_database_ca',
  ]) {
    const path = join(settings.secretDirectory, name);
    const info = await stat(path);
    if (
      !info.isFile() ||
      info.size > 16384 ||
      (name !== 'session_database_ca' && (info.mode & 0o007) !== 0)
    )
      fail('Revisa el formato y permisos de los archivos privados.');
    if (
      name !== 'session_database_ca' &&
      !(
        (info.uid === 1000 && info.mode & 0o400) ||
        (info.gid === 1000 && info.mode & 0o040)
      )
    )
      fail(
        'Los archivos privados deben ser legibles por el UID/GID 1000 de los contenedores.',
      );
    secrets[name] = (await readFile(path, 'utf8')).replace(/\r?\n$/, '');
  }
  validateStagingSecrets(secrets, settings.projectReference);
  return settings;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await preflight(process.argv[2]);
    console.log(
      JSON.stringify({
        configuration: 'valid',
        separateProject: true,
        networkVerified: false,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        configuration: 'rejected',
        reason:
          error instanceof StagingConfigurationError
            ? error.message
            : 'No se pudo revisar la configuración privada de pruebas.',
      }),
    );
    process.exitCode = 1;
  }
}
