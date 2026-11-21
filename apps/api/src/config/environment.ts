import { API_SECRET_NAMES, readRuntimeSecrets } from './runtime-secrets';
import { documentUploadMode } from './document-upload-mode';

export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  API_HOST: string;
  API_PORT: number;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  CLAMAV_HOST: string;
  CLAMAV_PORT: number;
  DOCUMENT_UPLOAD_MODE: ReturnType<typeof documentUploadMode>;
  RENDER_DOCUMENT_WORKER: boolean;
  APP_ORIGIN: string;
  TRUST_PROXY: boolean;
  SESSION_DATABASE_URL?: string;
  SESSION_SECRET?: string;
  SESSION_ENCRYPTION_KEY?: string;
}

export function validateEnvironment(
  input: Record<string, unknown>,
  renderDemo = false,
): Environment {
  input = readRuntimeSecrets(input, API_SECRET_NAMES);
  const nodeEnv = input.NODE_ENV ?? 'development';
  if (
    nodeEnv !== 'development' &&
    nodeEnv !== 'test' &&
    nodeEnv !== 'production'
  ) {
    throw new Error('NODE_ENV debe ser development, test o production.');
  }

  const rawPort = String(input.API_PORT ?? input.PORT ?? '3000');
  const port = Number(rawPort);
  if (
    !/^\d+$/.test(rawPort) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('API_PORT debe ser un entero entre 1 y 65535.');
  }

  const host = input.API_HOST ?? '127.0.0.1';
  if (typeof host !== 'string' || host.trim().length === 0) {
    throw new Error('API_HOST debe contener una dirección válida.');
  }

  const supabaseUrl = optionalText(input.SUPABASE_URL, 'SUPABASE_URL');
  const publishableKey = optionalText(
    input.SUPABASE_PUBLISHABLE_KEY,
    'SUPABASE_PUBLISHABLE_KEY',
  );
  const originText =
    optionalText(input.APP_ORIGIN, 'APP_ORIGIN') ??
    optionalText(input.RENDER_EXTERNAL_URL, 'RENDER_EXTERNAL_URL') ??
    'http://127.0.0.1:5173';
  let origin: URL;
  try {
    origin = new URL(originText);
  } catch {
    throw new Error('APP_ORIGIN debe ser un origen válido.');
  }
  const localOrigin = ['localhost', '127.0.0.1', '[::1]'].includes(
    origin.hostname,
  );
  if (
    (origin.protocol !== 'https:' &&
      !(
        localOrigin &&
        nodeEnv !== 'production' &&
        origin.protocol === 'http:'
      )) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  ) {
    throw new Error(
      'APP_ORIGIN debe ser un origen HTTPS; HTTP solo en desarrollo local.',
    );
  }
  const trustProxyInput = String(input.TRUST_PROXY ?? 'false');
  if (!['true', 'false', '1', '0'].includes(trustProxyInput))
    throw new Error('TRUST_PROXY debe ser true o false.');
  const sessionDatabase = optionalText(
    input.SESSION_DATABASE_URL,
    'SESSION_DATABASE_URL',
  );
  const sessionSecret = optionalText(input.SESSION_SECRET, 'SESSION_SECRET');
  const sessionEncryption = optionalText(
    input.SESSION_ENCRYPTION_KEY,
    'SESSION_ENCRYPTION_KEY',
  );
  const sessionCount = [
    sessionDatabase,
    sessionSecret,
    sessionEncryption,
  ].filter(Boolean).length;
  if (sessionCount !== 0 && sessionCount !== 3)
    throw new Error(
      'Configura SESSION_DATABASE_URL, SESSION_SECRET y SESSION_ENCRYPTION_KEY juntas.',
    );
  if (sessionCount && (!supabaseUrl || !publishableKey))
    throw new Error('Las sesiones requieren configurar Supabase.');
  if (nodeEnv === 'production' && sessionCount !== 3)
    throw new Error(
      'Producción requiere persistencia y claves de sesión configuradas.',
    );
  if (sessionSecret && sessionSecret.length < 32)
    throw new Error('SESSION_SECRET debe tener al menos 32 caracteres.');
  if (
    sessionEncryption &&
    (Buffer.from(sessionEncryption, 'base64').length !== 32 ||
      Buffer.from(sessionEncryption, 'base64').toString('base64') !==
        sessionEncryption)
  ) {
    throw new Error(
      'SESSION_ENCRYPTION_KEY debe contener 32 bytes codificados en base64.',
    );
  }
  const technicalKey = optionalText(
    input.SUPABASE_SECRET_KEY,
    'SUPABASE_SECRET_KEY',
  );
  if (technicalKey && !/^sb_secret_[A-Za-z0-9_-]+$/.test(technicalKey))
    throw new Error('SUPABASE_SECRET_KEY debe ser una clave técnica secret.');
  const clamHost =
    optionalText(input.CLAMAV_HOST, 'CLAMAV_HOST') ?? '127.0.0.1';
  const clamPort = Number(input.CLAMAV_PORT ?? 3310);
  if (!Number.isInteger(clamPort) || clamPort < 1 || clamPort > 65535)
    throw new Error('CLAMAV_PORT inválido.');
  const uploadMode = documentUploadMode(input, renderDemo);
  const base: Environment = {
    DOCUMENT_UPLOAD_MODE: uploadMode,
    RENDER_DOCUMENT_WORKER: nodeEnv === 'production' && uploadMode === 'beta',
    ...(technicalKey ? { SUPABASE_SECRET_KEY: technicalKey } : {}),
    CLAMAV_HOST: clamHost,
    CLAMAV_PORT: clamPort,
    NODE_ENV: nodeEnv,
    API_HOST: host,
    API_PORT: port,
    APP_ORIGIN: origin.origin,
    TRUST_PROXY: ['true', '1'].includes(trustProxyInput),
    ...(sessionDatabase ? { SESSION_DATABASE_URL: sessionDatabase } : {}),
    ...(sessionSecret ? { SESSION_SECRET: sessionSecret } : {}),
    ...(sessionEncryption ? { SESSION_ENCRYPTION_KEY: sessionEncryption } : {}),
  };
  if (Boolean(supabaseUrl) !== Boolean(publishableKey)) {
    throw new Error(
      'Configura SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY juntas.',
    );
  }

  if (supabaseUrl && publishableKey) {
    let url: URL;
    try {
      url = new URL(supabaseUrl);
    } catch {
      throw new Error('SUPABASE_URL debe ser una URL válida.');
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    ) {
      throw new Error(
        'SUPABASE_URL debe ser el origen HTTPS del proyecto; HTTP solo en loopback local.',
      );
    }
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
      throw new Error(
        'SUPABASE_PUBLISHABLE_KEY debe ser una clave publishable; no se admiten claves administrativas.',
      );
    }

    return {
      ...base,
      SUPABASE_URL: url.origin,
      SUPABASE_PUBLISHABLE_KEY: publishableKey,
    };
  }

  return base;
}

function optionalText(value: unknown, name: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length === 0
  ) {
    throw new Error(`${name} debe ser texto sin espacios adicionales.`);
  }
  return value;
}
