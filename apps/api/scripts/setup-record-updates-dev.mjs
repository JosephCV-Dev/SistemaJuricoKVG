import {
  developmentConfig,
  ownerConnection,
  DevelopmentSetupError,
  reportSetupFailure,
} from './lib/development-database.mjs';
import { readDevelopmentFixture } from './lib/development-identities.mjs';
import { applyDevelopmentMigrations } from './lib/development-migrations.mjs';

let owner;
const scope = process.argv[2];
const migrations = {
  clients: ['202611170007_client_search_and_update.sql'],
  cases: ['202611170009_case_search_and_update.sql'],
  assignments: ['202611170010_case_assignments.sql'],
  tracking: ['202611170011_case_tracking.sql'],
};
try {
  if (!Object.hasOwn(migrations, scope))
    throw new DevelopmentSetupError(
      'Indica la preparación de clientes, expedientes, asignaciones o seguimiento.',
    );
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
  await applyDevelopmentMigrations(owner, migrations[scope]);
} catch (error) {
  reportSetupFailure('REGISTROS_MIGRACION', error);
  process.exitCode = 1;
} finally {
  await owner?.end();
}
