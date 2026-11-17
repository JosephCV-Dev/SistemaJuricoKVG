import { readRuntimeSecrets } from './runtime-secrets';

export function validateWorkerEnvironment(raw: Record<string, unknown>) {
  const input = readRuntimeSecrets(raw, ['SUPABASE_SECRET_KEY']);
  const nodeEnv = input.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(String(nodeEnv)))
    throw new Error('NODE_ENV del trabajador no es válido.');
  let url: URL;
  try {
    url = new URL(String(input.SUPABASE_URL));
  } catch {
    throw new Error('SUPABASE_URL del trabajador no es válida.');
  }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (
    !(
      url.protocol === 'https:' ||
      (local && nodeEnv !== 'production' && url.protocol === 'http:')
    ) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('El trabajador requiere un origen Supabase HTTPS.');
  const key = input.SUPABASE_SECRET_KEY;
  if (typeof key !== 'string' || !/^sb_secret_[A-Za-z0-9_-]+$/.test(key))
    throw new Error('El trabajador requiere su clave técnica privada.');
  const host = input.CLAMAV_HOST ?? '127.0.0.1';
  const port = Number(input.CLAMAV_PORT ?? 3310);
  if (
    typeof host !== 'string' ||
    !/^[a-zA-Z0-9.:-]+$/.test(host) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error('Configura la conexión privada de ClamAV.');
  // El trabajador no recibe claves de cookies, rol SQL de sesiones ni propietario.
  return {
    NODE_ENV: nodeEnv,
    SUPABASE_URL: url.origin,
    SUPABASE_SECRET_KEY: key,
    CLAMAV_HOST: host,
    CLAMAV_PORT: port,
  };
}
