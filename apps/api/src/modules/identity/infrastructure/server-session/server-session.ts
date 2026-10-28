import session from 'express-session';
import type { RequestHandler } from 'express';
import {
  PostgresSessionStore,
  PRE_AUTH_SESSION_MAX_AGE_MS,
} from './postgres-session.store';

export interface ServerSessionOptions {
  databaseUrl?: string | undefined;
  secret?: string | undefined;
  encryptionKey?: string | undefined;
  production: boolean;
  trustProxy?: boolean | undefined;
}

export interface ServerSessionRuntime {
  middleware: RequestHandler;
  store: PostgresSessionStore;
  cookieName: string;
}

export function createServerSession(
  options: ServerSessionOptions,
): ServerSessionRuntime | null {
  const values = [options.databaseUrl, options.secret, options.encryptionKey];
  const configured = values.filter(
    (value) => value !== undefined && value !== '',
  ).length;
  if (configured === 0) return null;
  if (configured !== values.length) {
    throw new Error(
      'Configura SESSION_DATABASE_URL, SESSION_SECRET y SESSION_ENCRYPTION_KEY juntas.',
    );
  }
  if (
    !options.secret ||
    options.secret.length < 32 ||
    options.secret.trim() !== options.secret
  ) {
    throw new Error(
      'SESSION_SECRET debe tener al menos 32 caracteres sin espacios adicionales.',
    );
  }
  if (!options.databaseUrl || !options.encryptionKey)
    throw new Error('Configuración de sesión incompleta.');

  const store = new PostgresSessionStore({
    connectionString: options.databaseUrl,
    encryptionKey: options.encryptionKey,
  });
  const cookieName = options.production ? '__Host-kvg.sid' : 'kvg.sid';
  const middleware = session({
    name: cookieName,
    secret: options.secret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: false,
    proxy: options.trustProxy ?? false,
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: options.production,
      maxAge: PRE_AUTH_SESSION_MAX_AGE_MS,
    },
  });

  return { middleware, store, cookieName };
}
