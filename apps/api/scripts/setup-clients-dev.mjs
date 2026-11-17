import {
  developmentConfig,
  ownerConnection,
  DevelopmentSetupError,
  reportSetupFailure,
} from './lib/development-database.mjs';
import { readDevelopmentFixture } from './lib/development-identities.mjs';
import { applyDevelopmentMigrations } from './lib/development-migrations.mjs';

let owner;
try {
  const config = await developmentConfig();
  const fixture = await readDevelopmentFixture(config);
  owner = await ownerConnection(config);
  const { rows } = await owner.query(
    'SELECT correo_operativo FROM kvg.usuario',
  );
  if (
    !rows.length ||
    rows.some(
      (row) =>
        !fixture.accounts.some(
          (account) => account.email === row.correo_operativo,
        ),
    )
  ) {
    throw new DevelopmentSetupError(
      'Usa el entorno de desarrollo con sus identidades ficticias conocidas.',
    );
  }
  await applyDevelopmentMigrations(owner, [
    '202611170007_client_search_and_update.sql',
  ]);
} catch (error) {
  reportSetupFailure('CLIENTES_MIGRACION', error);
  process.exitCode = 1;
} finally {
  await owner?.end();
}
