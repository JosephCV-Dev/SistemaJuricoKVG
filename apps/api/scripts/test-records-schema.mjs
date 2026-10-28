import { readFile } from 'node:fs/promises';
import {
  developmentConfig,
  ownerConnection,
  reportSetupFailure,
} from './lib/development-database.mjs';
let owner;
try {
  owner = await ownerConnection(await developmentConfig());
  await owner.query(
    await readFile(
      new URL('../../../database/tests/records.sql', import.meta.url),
      'utf8',
    ),
  );
  console.log(
    JSON.stringify({
      resultado: 'correcto',
      comprobacion: 'contrato_y_privilegios_privados_de_clientes_y_expedientes',
      solo_lectura: true,
    }),
  );
} catch (error) {
  reportSetupFailure('CONTRATO_SQL_CLIENTES_EXPEDIENTES', error);
  process.exitCode = 1;
} finally {
  await owner?.query('ROLLBACK').catch(() => undefined);
  await owner?.end().catch(() => undefined);
}
