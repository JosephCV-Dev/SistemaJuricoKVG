import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { SessionPayloadCipher } from '../dist/modules/identity/infrastructure/server-session/session-payload-cipher.js';
import { createServerSession } from '../dist/modules/identity/infrastructure/server-session/server-session.js';
import {
  MAX_SERVER_SESSION_AGE_MS,
  PostgresSessionStore,
  validateSessionDatabaseUrl,
} from '../dist/modules/identity/infrastructure/server-session/postgres-session.store.js';

test('la carga de sesión cifra tokens y recupera sus datos sin exponerlos en el payload', () => {
  const cipher = new SessionPayloadCipher(randomBytes(32).toString('base64'));
  const sidHash = createHash('sha256')
    .update('random-session-id')
    .digest('hex');
  const session = {
    cookie: { originalMaxAge: 600_000, httpOnly: true, path: '/' },
    identity: {
      accessToken: 'private-access-token',
      refreshToken: 'private-refresh-token',
    },
  };
  const encrypted = cipher.encrypt(sidHash, session);
  assert.equal(encrypted.includes(Buffer.from('private-access-token')), false);
  assert.equal(encrypted.includes(Buffer.from('private-refresh-token')), false);
  assert.deepEqual(cipher.decrypt(sidHash, encrypted), session);
  assert.notDeepEqual(cipher.encrypt(sidHash, session), encrypted);
});

test('rechaza alteraciones, intercambio entre SID y claves de cifrado diferentes', () => {
  const cipher = new SessionPayloadCipher(randomBytes(32).toString('base64'));
  const sidHash = createHash('sha256').update('session-a').digest('hex');
  const otherHash = createHash('sha256').update('session-b').digest('hex');
  const encrypted = cipher.encrypt(sidHash, { cookie: {} });
  const tampered = Buffer.from(encrypted);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => cipher.decrypt(sidHash, tampered), /no es válida/);
  assert.throws(() => cipher.decrypt(otherHash, encrypted), /no es válida/);
  assert.throws(
    () =>
      new SessionPayloadCipher(randomBytes(32).toString('base64')).decrypt(
        sidHash,
        encrypted,
      ),
    /no es válida/,
  );
  assert.throws(() => new SessionPayloadCipher('invalid'), /32 bytes/);
});

test('sin configuración se deshabilita y una configuración parcial no cae en MemoryStore', () => {
  assert.equal(createServerSession({ production: false }), null);
  assert.throws(
    () => createServerSession({ production: false, secret: 'x'.repeat(32) }),
    /juntas/,
  );
  assert.throws(
    () =>
      createServerSession({
        production: false,
        databaseUrl: 'postgresql://kvg_session_store:local@127.0.0.1/kvg',
        encryptionKey: randomBytes(32).toString('base64'),
        secret: 'short',
      }),
    /32 caracteres/,
  );
});

test('la conexión técnica exige su rol y TLS validado fuera del equipo local', () => {
  assert.doesNotThrow(() =>
    validateSessionDatabaseUrl(
      'postgresql://kvg_session_store:local@127.0.0.1/kvg',
    ),
  );
  assert.doesNotThrow(() =>
    validateSessionDatabaseUrl(
      'postgresql://kvg_session_store:secret@example.com/kvg?sslmode=verify-full',
    ),
  );
  for (const url of [
    'postgresql://postgres:secret@example.com/kvg?sslmode=verify-full',
    'postgresql://kvg_session_store:secret@example.com/kvg',
    'postgresql://kvg_session_store:secret@example.com/kvg?sslmode=no-verify',
  ]) {
    assert.throws(
      () => validateSessionDatabaseUrl(url),
      /kvg_session_store.*TLS/,
    );
  }
});

test('touch de una respuesta antigua conserva los tokens renovados y no alarga el vencimiento', async () => {
  const encryptionKey = randomBytes(32).toString('base64');
  const cipher = new SessionPayloadCipher(encryptionKey);
  const store = new PostgresSessionStore({
    connectionString: 'postgresql://kvg_session_store:local@127.0.0.1/kvg',
    encryptionKey,
  });
  const originalQuery = store.dataPool.query;
  const sid = 'concurrent-session-id';
  const hash = createHash('sha256').update(sid).digest('hex');
  const createdAt = Date.now();
  const currentDeadline = createdAt + 2 * 60 * 60_000;
  const oldDeadline = createdAt + 3 * 60 * 60_000;
  let row;
  let touches = 0;

  // Controlled SQL boundary only: this test does not claim PostgreSQL persistence.
  store.dataPool.query = async (sql, parameters) => {
    if (sql.includes('INSERT INTO')) {
      row = {
        payload: Buffer.from(parameters[1]),
        expiresAt: parameters[2].getTime(),
      };
    } else {
      touches++;
      assert.match(sql, /^UPDATE\s+kvg_servidor\.sesion_web/);
      assert.doesNotMatch(sql, /\bpayload\s*=/i);
      assert.match(sql, /LEAST\(expires_at,\s*\$2::timestamptz/);
      assert.equal(parameters.length, 3);
      assert.equal(parameters[0], hash);
      assert.equal(parameters[2], MAX_SERVER_SESSION_AGE_MS);
      row.expiresAt = Math.min(
        row.expiresAt,
        parameters[1].getTime(),
        createdAt + parameters[2],
      );
    }
    return { rows: [], rowCount: 1 };
  };
  const persist = (method, data) =>
    new Promise((resolve, reject) =>
      store[method](sid, data, (error) => (error ? reject(error) : resolve())),
    );
  const oldSnapshot = {
    cookie: {
      expires: new Date(oldDeadline),
      originalMaxAge: 3 * 60 * 60_000,
    },
    authentication: { accessToken: 'A1', refreshToken: 'R1' },
  };

  try {
    await persist('set', oldSnapshot);
    await persist('set', {
      cookie: {
        expires: new Date(currentDeadline),
        originalMaxAge: 2 * 60 * 60_000,
      },
      authentication: { accessToken: 'A2', refreshToken: 'R2' },
    });
    const latestPayload = Buffer.from(row.payload);

    await persist('touch', oldSnapshot);

    assert.deepEqual(row.payload, latestPayload);
    assert.equal(
      cipher.decrypt(hash, row.payload).authentication.refreshToken,
      'R2',
    );
    assert.equal(row.expiresAt, currentDeadline);

    const shorterDeadline = createdAt + 60 * 60_000;
    await persist('touch', {
      ...oldSnapshot,
      cookie: {
        expires: new Date(shorterDeadline),
        originalMaxAge: 60 * 60_000,
      },
    });
    assert.deepEqual(row.payload, latestPayload);
    assert.equal(row.expiresAt, shorterDeadline);
    assert.equal(touches, 2);
  } finally {
    store.dataPool.query = originalQuery;
    await store.close();
  }
});
