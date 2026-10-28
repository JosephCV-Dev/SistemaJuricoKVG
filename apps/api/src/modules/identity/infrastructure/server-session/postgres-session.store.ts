import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Store, type SessionData } from 'express-session';
import { Pool, type PoolClient } from 'pg';
import { SessionPayloadCipher } from './session-payload-cipher';

export const PRE_AUTH_SESSION_MAX_AGE_MS = 10 * 60 * 1000;
export const MAX_SERVER_SESSION_AGE_MS = 8 * 60 * 60 * 1000;

export class SessionStoreUnavailableError extends Error {
  constructor() {
    super('La persistencia de sesión no está disponible.');
    this.name = 'SessionStoreUnavailableError';
  }
}

interface SessionStoreOptions {
  connectionString: string;
  encryptionKey: string;
}

type WriteCallback = (error?: unknown) => void;

export class PostgresSessionStore extends Store {
  private readonly logger = new Logger(PostgresSessionStore.name);
  private readonly dataPool: Pool;
  private readonly lockPool: Pool;
  private readonly cipher: SessionPayloadCipher;
  private closePromise: Promise<void> | undefined;

  constructor(options: SessionStoreOptions) {
    super();
    validateSessionDatabaseUrl(options.connectionString);
    this.cipher = new SessionPayloadCipher(options.encryptionKey);

    const poolOptions = {
      connectionString: options.connectionString,
      max: 4,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 10_000,
      lock_timeout: 10_000,
      allowExitOnIdle: true,
      application_name: 'kvg-server-session',
    };
    // A lock holder must still be able to reload/save using the data pool.
    // Sharing one exhausted pool between locks and data can deadlock concurrent requests.
    this.dataPool = new Pool(poolOptions);
    this.lockPool = new Pool(poolOptions);
    for (const pool of [this.dataPool, this.lockPool]) {
      pool.on('error', () => {
        this.logger.error('Falló una conexión del almacenamiento de sesiones.');
      });
    }
  }

  override get(
    sid: string,
    callback: (error: unknown, session?: SessionData | null) => void,
  ): void {
    void this.read(sid).then(
      (session) => callback(null, session),
      () => callback(new SessionStoreUnavailableError()),
    );
  }

  override set(
    sid: string,
    session: SessionData,
    callback?: WriteCallback,
  ): void {
    this.completeWrite(this.write(sid, session, true), callback);
  }

  override touch(
    sid: string,
    session: SessionData,
    callback?: WriteCallback,
  ): void {
    // A late response must not overwrite renewed tokens or extend a shorter expiry.
    this.completeWrite(this.write(sid, session, false), callback);
  }

  override destroy(sid: string, callback?: WriteCallback): void {
    this.completeWrite(this.revoke(sid), callback);
  }

  async withLock<T>(sid: string, action: () => Promise<T>): Promise<T> {
    const lockId = createHash('sha256')
      .update(sessionHash(sid))
      .digest()
      .readBigInt64BE();
    let connection: PoolClient;
    try {
      connection = await this.lockPool.connect();
    } catch {
      throw new SessionStoreUnavailableError();
    }

    let acquired = false;
    let destroyConnection = false;
    try {
      // lock_timeout and statement_timeout on this dedicated connection bound the wait.
      await connection.query('SELECT pg_advisory_lock($1::bigint)', [
        lockId.toString(),
      ]);
      acquired = true;
      return await action();
    } catch (error: unknown) {
      if (!acquired) {
        destroyConnection = true;
        throw new SessionStoreUnavailableError();
      }
      throw error;
    } finally {
      if (acquired) {
        try {
          const result = await connection.query<{ unlocked: boolean }>(
            'SELECT pg_advisory_unlock($1::bigint) AS unlocked',
            [lockId.toString()],
          );
          if (result.rows[0]?.unlocked !== true) throw new Error();
        } catch {
          destroyConnection = true;
        }
      }
      connection.release(destroyConnection);
      if (destroyConnection) throw new SessionStoreUnavailableError();
    }
  }

  async pruneExpired(): Promise<number> {
    try {
      // Retain tombstones after expiry so an old in-flight request cannot resurrect a SID.
      const result = await this.dataPool.query(
        `DELETE FROM kvg_servidor.sesion_web
         WHERE expires_at < clock_timestamp() - interval '8 hours'`,
      );
      return result.rowCount ?? 0;
    } catch {
      throw new SessionStoreUnavailableError();
    }
  }

  close(): Promise<void> {
    this.closePromise ??= Promise.allSettled([
      this.dataPool.end(),
      this.lockPool.end(),
    ]).then((results) => {
      if (results.some((result) => result.status === 'rejected')) {
        throw new SessionStoreUnavailableError();
      }
    });
    return this.closePromise;
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  private async read(sid: string): Promise<SessionData | null> {
    const hash = sessionHash(sid);
    const result = await this.dataPool.query<{ payload: Buffer }>(
      `SELECT payload FROM kvg_servidor.sesion_web
       WHERE sid_hash = $1 AND revoked_at IS NULL AND expires_at > clock_timestamp()`,
      [hash],
    );
    const row = result.rows[0];
    return row ? this.cipher.decrypt(hash, row.payload) : null;
  }

  private async write(
    sid: string,
    session: SessionData,
    insert: boolean,
  ): Promise<void> {
    const hash = sessionHash(sid);
    const expiration = session.cookie.expires;
    const requestedExpiry = expiration
      ? expiration instanceof Date
        ? expiration.getTime()
        : new Date(expiration).getTime()
      : Date.now() + sessionDuration(session);
    if (!Number.isFinite(requestedExpiry))
      throw new SessionStoreUnavailableError();

    // cookie.expires preserves the absolute deadline selected by authentication.
    // originalMaxAge may contain only the remaining lifetime, so it must never be
    // added to created_at again when refreshing an existing session.
    if (insert) {
      const payload = this.cipher.encrypt(hash, session);
      const values = [
        hash,
        payload,
        new Date(requestedExpiry),
        MAX_SERVER_SESSION_AGE_MS,
      ];
      const result = await this.dataPool.query(
        `WITH timing AS (SELECT clock_timestamp() AS now)
         INSERT INTO kvg_servidor.sesion_web
           (sid_hash, payload, expires_at, created_at, updated_at)
         SELECT $1, $2, LEAST($3::timestamptz, now + $4::double precision * interval '1 millisecond'), now, now
         FROM timing
         ON CONFLICT (sid_hash) DO UPDATE
           SET payload = EXCLUDED.payload,
               expires_at = LEAST(EXCLUDED.expires_at,
                 kvg_servidor.sesion_web.created_at + $4::double precision * interval '1 millisecond'),
               updated_at = clock_timestamp()
         WHERE kvg_servidor.sesion_web.revoked_at IS NULL
           AND kvg_servidor.sesion_web.expires_at > clock_timestamp()`,
        values,
      );
      if (result.rowCount !== 1) throw new SessionStoreUnavailableError();
    } else {
      await this.dataPool.query(
        `UPDATE kvg_servidor.sesion_web
         SET expires_at = LEAST(expires_at, $2::timestamptz,
             created_at + $3::double precision * interval '1 millisecond'),
           updated_at = clock_timestamp()
         WHERE sid_hash = $1 AND revoked_at IS NULL AND expires_at > clock_timestamp()`,
        [hash, new Date(requestedExpiry), MAX_SERVER_SESSION_AGE_MS],
      );
    }
  }

  private async revoke(sid: string): Promise<void> {
    await this.dataPool.query(
      `WITH timing AS (SELECT clock_timestamp() AS now)
       INSERT INTO kvg_servidor.sesion_web
         (sid_hash, payload, expires_at, created_at, updated_at, revoked_at)
       SELECT $1, NULL, now, now, now, now FROM timing
       ON CONFLICT (sid_hash) DO UPDATE
         SET payload = NULL, expires_at = LEAST(kvg_servidor.sesion_web.expires_at, EXCLUDED.expires_at),
             updated_at = clock_timestamp(), revoked_at = clock_timestamp()`,
      [sessionHash(sid)],
    );
  }

  private completeWrite(action: Promise<void>, callback?: WriteCallback): void {
    void action.then(
      () => callback?.(),
      () => {
        if (callback) callback(new SessionStoreUnavailableError());
        else this.logger.error('No se pudo persistir un cambio de sesión.');
      },
    );
  }
}

export function validateSessionDatabaseUrl(connectionString: string): void {
  try {
    const url = new URL(connectionString);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const allowedParameters = new Set([
      'sslmode',
      'sslrootcert',
      'sslcert',
      'sslkey',
      'sslpassword',
      'connect_timeout',
    ]);
    const parameterNames = [...url.searchParams.keys()];
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !/^kvg_session_store(?:\.[a-z0-9]+)?$/.test(url.username) ||
      parameterNames.some((name) => !allowedParameters.has(name)) ||
      new Set(parameterNames).size !== parameterNames.length ||
      (!local && url.searchParams.get('sslmode') !== 'verify-full')
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(
      'SESSION_DATABASE_URL debe usar kvg_session_store y TLS verify-full fuera de loopback.',
    );
  }
}

export function sessionHash(sid: string): string {
  if (typeof sid !== 'string' || sid.length === 0 || sid.length > 512) {
    throw new Error('El identificador de sesión no es válido.');
  }
  return createHash('sha256').update(sid, 'utf8').digest('hex');
}

function sessionDuration(session: SessionData): number {
  const maxAge = session.cookie.originalMaxAge ?? PRE_AUTH_SESSION_MAX_AGE_MS;
  if (!Number.isFinite(maxAge) || maxAge <= 0)
    throw new SessionStoreUnavailableError();
  return Math.min(maxAge, MAX_SERVER_SESSION_AGE_MS);
}
