import {
  developmentConfig,
  ownerConnection,
  DevelopmentSetupError,
  reportSetupFailure,
} from './lib/development-database.mjs';
import {
  isDevelopmentEmail,
  readDevelopmentFixture,
} from './lib/development-identities.mjs';
import { applyDevelopmentMigrations } from './lib/development-migrations.mjs';

let owner;
const scope = process.argv[2];
const migrations = {
  clients: ['202611170007_client_search_and_update.sql'],
  cases: ['202611170009_case_search_and_update.sql'],
  assignments: ['202611170010_case_assignments.sql'],
  tracking: ['202611170011_case_tracking.sql'],
  documentOrganization: ['202611170012_document_organization.sql'],
  documentVersions: ['202611170013_document_versions.sql'],
  documentReview: ['202611170014_document_legal_review.sql'],
  documentRecovery: ['202611170015_document_retirement_recovery.sql'],
  staff: ['202611170016_staff_administration.sql'],
  auditConfiguration: ['202611180017_audit_configuration.sql'],
  documentReadProjection: [
    '202611180018_document_read_projection.sql',
    '202611180019_version_integrity_for_review.sql',
  ],
};
try {
  if (!Object.hasOwn(migrations, scope))
    throw new DevelopmentSetupError(
      'Indica la preparación de clientes, expedientes, asignaciones, seguimiento, organización documental, versiones, revisión jurídica, recuperación, personal, bitácora y configuración o proyección documental.',
    );
  const config = await developmentConfig();
  const fixture = await readDevelopmentFixture(config);
  owner = await ownerConnection(config);
  const { rows } = await owner.query(
    'SELECT correo_operativo FROM kvg.usuario',
  );
  if (
    !rows.length ||
    rows.some((row) => !isDevelopmentEmail(fixture, row.correo_operativo))
  ) {
    throw new DevelopmentSetupError(
      'Usa el entorno de desarrollo con las identidades del fixture o correos reservados example.test.',
    );
  }
  await applyDevelopmentMigrations(owner, migrations[scope]);
} catch (error) {
  reportSetupFailure('REGISTROS_MIGRACION', error);
  process.exitCode = 1;
} finally {
  await owner?.end();
}
