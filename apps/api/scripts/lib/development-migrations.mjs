import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DevelopmentSetupError } from './development-database.mjs';

export async function applyDevelopmentMigrations(owner, files) {
  for (const name of files) {
    const source = await readFile(
      fileURLToPath(
        new URL(`../../../../database/migrations/${name}`, import.meta.url),
      ),
      'utf8',
    );
    const checksum = createHash('sha256').update(source).digest('hex');
    const exists = await owner.query(
      "SELECT to_regclass('kvg_servidor.migracion') IS NOT NULL AS present",
    );
    if (exists.rows[0].present) {
      const applied = await owner.query(
        'SELECT sha256 FROM kvg_servidor.migracion WHERE nombre=$1',
        [name],
      );
      if (applied.rowCount) {
        if (applied.rows[0].sha256 !== checksum)
          throw new DevelopmentSetupError(
            'La migración aplicada tiene otro checksum.',
          );
        console.log(JSON.stringify({ migracion: name, estado: 'ya_aplicada' }));
        continue;
      }
    }
    const begin = source.indexOf('\nBEGIN;');
    const end = source.lastIndexOf('\nCOMMIT;');
    if (begin < 0 || end <= begin || source.slice(end).trim() !== 'COMMIT;')
      throw new DevelopmentSetupError(
        'La migración no cumple el formato transaccional previsto.',
      );
    const body = source.slice(begin + '\nBEGIN;'.length, end);
    await owner.query('BEGIN');
    try {
      await owner.query(body);
      await owner.query(`CREATE TABLE IF NOT EXISTS kvg_servidor.migracion (
        nombre text PRIMARY KEY, sha256 varchar(64) NOT NULL, aplicada_en timestamptz NOT NULL DEFAULT clock_timestamp()
      )`);
      await owner.query(
        'REVOKE ALL ON kvg_servidor.migracion FROM PUBLIC, anon, authenticated, service_role, kvg_session_store',
      );
      await owner.query(
        'INSERT INTO kvg_servidor.migracion(nombre,sha256) VALUES($1,$2)',
        [name, checksum],
      );
      await owner.query('COMMIT');
    } catch (error) {
      await owner.query('ROLLBACK');
      throw error;
    }
    console.log(JSON.stringify({ migracion: name, estado: 'aplicada' }));
  }
}
