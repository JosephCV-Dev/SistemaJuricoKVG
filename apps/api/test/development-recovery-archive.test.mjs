import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  decryptBackup,
  encryptBackup,
  loadBackup,
  storeBackup,
} from '../scripts/lib/development-recovery-archive.mjs';

test('el archivo cifrado detecta corrupción, sustitución de ID y claves incorrectas', () => {
  const id = randomUUID();
  const key = randomBytes(32);
  const snapshot = {
    clientes: ['Cliente ficticio'],
    originales: ['contenido ficticio'],
  };
  const data = encryptBackup(id, snapshot, key);
  assert.deepEqual(decryptBackup(id, data, key), snapshot);
  assert.equal(data.includes('Cliente ficticio'), false);
  assert.throws(
    () => decryptBackup(randomUUID(), data, key),
    /copia está dañada/,
  );
  assert.throws(
    () => decryptBackup(id, data, randomBytes(32)),
    /copia está dañada/,
  );
  const damaged = Buffer.from(data);
  damaged[18] ^= 1;
  assert.throws(() => decryptBackup(id, damaged, key), /copia está dañada/);
  assert.throws(
    () => decryptBackup(id, data.subarray(0, 12), key),
    /formato o tamaño/,
  );
});

test('las copias usan archivos privados, claves separadas y se pueden abrir por identificador', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kvg-backup-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const copies = join(root, 'copias');
  const keys = join(root, 'claves');
  await Promise.all([
    mkdir(copies, { mode: 0o700 }),
    mkdir(keys, { mode: 0o700 }),
  ]);
  const id = randomUUID();
  const snapshot = { tablas: [], objetos: [] };
  const info = await storeBackup({ copies, keys }, id, snapshot);
  const key = join(keys, id + '.key');
  const copy = join(copies, id + '.enc');
  assert.equal((await stat(key)).mode & 0o777, 0o600);
  assert.equal((await stat(copy)).mode & 0o777, 0o600);
  assert.equal((await stat(copy)).size, info.bytes);
  assert.deepEqual((await loadBackup({ copies, keys }, id)).snapshot, snapshot);
  await assert.rejects(() => storeBackup({ copies, keys }, id, {}), {
    code: 'EEXIST',
  });
  await chmod(copy, 0o644);
  await assert.rejects(() => loadBackup({ copies, keys }, id), /permisos/);
  await assert.rejects(
    () => loadBackup({ copies, keys }, '../datos'),
    /Identificador/,
  );
});
