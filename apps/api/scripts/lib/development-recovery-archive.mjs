import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import {
  DevelopmentSetupError,
  localDirectory,
} from './development-database.mjs';

export const backupIdPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const archiveLimit = 128 * 1024 * 1024;
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function privateDirectory(path) {
  if (!isAbsolute(path))
    throw new DevelopmentSetupError(
      'Usa rutas absolutas para la copia y la custodia.',
    );
  await mkdir(path, { mode: 0o700, recursive: true });
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    (info.mode & 0o077) !== 0 ||
    info.uid !== process.getuid()
  )
    throw new DevelopmentSetupError(
      'Las rutas de respaldo requieren directorios propios con permisos 0700.',
    );
  return realpath(path);
}

export async function recoveryDirectories() {
  const copies = await privateDirectory(
    process.env.KVG_DEV_BACKUP_DIR ?? join(localDirectory, 'recovery-copies'),
  );
  const keys = await privateDirectory(
    process.env.KVG_DEV_BACKUP_KEY_DIR ?? join(localDirectory, 'recovery-keys'),
  );
  const within = (a, b) =>
    relative(a, b) === '' ||
    (!relative(a, b).startsWith('..' + '/') &&
      relative(a, b) !== '..' &&
      !isAbsolute(relative(a, b)));
  if (within(copies, keys) || within(keys, copies))
    throw new DevelopmentSetupError(
      'Usa directorios separados para las copias y sus claves.',
    );
  return { copies, keys };
}

function aad(id) {
  if (!backupIdPattern.test(id))
    throw new DevelopmentSetupError('Identificador de respaldo inválido.');
  return Buffer.from('KVG-development-backup-v2:' + id);
}

export function encryptBackup(id, snapshot, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(id));
  const plaintext = Buffer.from(JSON.stringify(snapshot));
  if (plaintext.length + 28 > archiveLimit)
    throw new DevelopmentSetupError(
      'La copia supera el límite del ensayo local.',
    );
  return Buffer.concat([
    iv,
    cipher.update(plaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
}

export function decryptBackup(id, archive, key) {
  const context = aad(id);
  if (archive.length < 29 || archive.length > archiveLimit || key.length !== 32)
    throw new DevelopmentSetupError(
      'El formato o tamaño de la copia es inválido.',
    );
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      archive.subarray(0, 12),
    );
    decipher.setAAD(context);
    decipher.setAuthTag(archive.subarray(-16));
    return JSON.parse(
      Buffer.concat([
        decipher.update(archive.subarray(12, -16)),
        decipher.final(),
      ]).toString('utf8'),
    );
  } catch {
    throw new DevelopmentSetupError(
      'La copia está dañada o la clave no corresponde.',
    );
  }
}

async function readPrivate(path, limit) {
  const info = await lstat(path);
  if (
    !info.isFile() ||
    (info.mode & 0o077) !== 0 ||
    info.uid !== process.getuid() ||
    info.size > limit
  )
    throw new DevelopmentSetupError(
      'El archivo de recuperación no cumple los permisos o límites del ensayo.',
    );
  return readFile(path);
}

export async function recordRecovery(path, report) {
  const temporary = join(
    dirname(path),
    '.' + randomBytes(16).toString('hex') + '.json',
  );
  await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx',
  });
  await rename(temporary, path);
}

export async function storeBackup(directories, id, snapshot) {
  const key = randomBytes(32);
  const data = encryptBackup(id, snapshot, key);
  await writeFile(join(directories.keys, id + '.key'), key, {
    mode: 0o600,
    flag: 'wx',
  });
  await writeFile(join(directories.copies, id + '.enc'), data, {
    mode: 0o600,
    flag: 'wx',
  });
  return { bytes: data.length, sha256: hash(data) };
}

export async function loadBackup(directories, id) {
  aad(id);
  const data = await readPrivate(
    join(directories.copies, id + '.enc'),
    archiveLimit,
  );
  const key = await readPrivate(join(directories.keys, id + '.key'), 32);
  return { data, snapshot: decryptBackup(id, data, key) };
}
