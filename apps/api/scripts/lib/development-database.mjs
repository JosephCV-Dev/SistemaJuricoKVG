import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { X509Certificate } from 'node:crypto';
import pg from 'pg';

export const localDirectory = fileURLToPath(
  new URL('../../.local/', import.meta.url),
);
export const envPath = fileURLToPath(new URL('../../.env', import.meta.url));

export class DevelopmentSetupError extends Error {}

export async function developmentConfig() {
  process.loadEnvFile(envPath);
  if ((process.env.NODE_ENV ?? 'development') !== 'development') {
    throw new DevelopmentSetupError(
      'Este procedimiento solo se permite en desarrollo.',
    );
  }
  let database;
  let api;
  try {
    database = new URL(process.env.DATABASE_URL);
    api = new URL(process.env.SUPABASE_URL);
  } catch {
    throw new DevelopmentSetupError('Revisa DATABASE_URL y SUPABASE_URL.');
  }
  const user = decodeURIComponent(database.username);
  const reference = user.startsWith('postgres.')
    ? user.slice(9)
    : database.hostname.startsWith('db.')
      ? database.hostname.split('.')[1]
      : null;
  if (
    !reference ||
    api.hostname !== `${reference}.supabase.co` ||
    !process.env.SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_')
  ) {
    throw new DevelopmentSetupError(
      'La configuración SQL y API debe corresponder al mismo proyecto.',
    );
  }
  await mkdir(localDirectory, { recursive: true, mode: 0o700 });
  await chmod(localDirectory, 0o700);
  const caPath = `${localDirectory}/supabase-ca.crt`;
  let ca;
  try {
    ca = await readFile(caPath);
  } catch {
    const response = await fetch(
      'https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt',
      { redirect: 'error', signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok)
      throw new DevelopmentSetupError(
        'No se pudo obtener la CA pública de Supabase.',
      );
    ca = Buffer.from(await response.arrayBuffer());
    const certificate = new X509Certificate(ca);
    if (!certificate.ca || Date.parse(certificate.validTo) <= Date.now())
      throw new DevelopmentSetupError('La CA pública requiere revisión.');
    await writeFile(caPath, ca, { mode: 0o600 });
  }
  database.searchParams.set('sslmode', 'verify-full');
  database.searchParams.set('sslrootcert', caPath);
  return { database, api: api.origin, reference, caPath };
}

export async function ownerConnection(config) {
  const client = new pg.Client({
    connectionString: config.database.toString(),
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    application_name: 'kvg-identity-development-setup',
  });
  await client.connect();
  const result = await client.query('SELECT current_user AS role');
  if (result.rows[0]?.role !== 'postgres') {
    await client.end();
    throw new DevelopmentSetupError(
      'La preparación requiere la conexión de propietario documentada.',
    );
  }
  return client;
}

export async function updateLocalEnvironment(values) {
  let text = await readFile(envPath, 'utf8');
  for (const [name, value] of Object.entries(values)) {
    if (!/^[A-Z_]+$/.test(name) || /[\r\n"]/.test(value))
      throw new DevelopmentSetupError(
        'Variable local con formato no admitido.',
      );
    const expression = new RegExp(`^\\s*${name}\\s*=.*$`, 'gm');
    const matches = [...text.matchAll(expression)];
    if (matches.length > 1)
      throw new DevelopmentSetupError('Revisa variables locales duplicadas.');
    const assignment = `${name}="${value}"`;
    text = matches.length
      ? text.replace(expression, () => assignment)
      : `${text.trimEnd()}\n${assignment}\n`;
  }
  await writeFile(envPath, text, { mode: 0o600 });
  await chmod(envPath, 0o600);
}

export function reportSetupFailure(stage, error) {
  console.error(
    JSON.stringify({
      resultado: 'fallido',
      etapa: stage,
      motivo:
        error instanceof DevelopmentSetupError
          ? error.message
          : 'La operación no se completó; detalles sensibles ocultos.',
      codigo_sql:
        typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)
          ? error.code
          : undefined,
    }),
  );
}
