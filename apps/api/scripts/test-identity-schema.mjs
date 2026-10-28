import { readFile } from 'node:fs/promises';
import {
  developmentConfig,
  ownerConnection,
  reportSetupFailure,
} from './lib/development-database.mjs';

let owner;
try {
  const config = await developmentConfig();
  owner = await ownerConnection(config);
  const query = await readFile(
    new URL('../../../database/tests/identity-session.sql', import.meta.url),
    'utf8',
  );
  await owner.query(query);
  console.log(
    JSON.stringify({
      resultado: 'correcto',
      comprobacion: 'contrato_sql_identidad_y_denegacion_sin_identidad',
      datos_negocio_creados: false,
    }),
  );
} catch (error) {
  reportSetupFailure('PRUEBAS_SQL_IDENTIDAD', error);
  process.exitCode = 1;
} finally {
  await owner?.query('ROLLBACK').catch(() => undefined);
  await owner?.end().catch(() => undefined);
}
