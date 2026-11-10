import {
  developmentConfig,
  ownerConnection,
  reportSetupFailure,
} from './lib/development-database.mjs';
import { applyDevelopmentMigrations } from './lib/development-migrations.mjs';
let owner;
try {
  const config = await developmentConfig();
  owner = await ownerConnection(config);
  await applyDevelopmentMigrations(owner, [
    '202611040005_document_upload_workflow.sql',
    '202611040006_document_detail_and_failed_jobs.sql',
  ]);
} catch (error) {
  reportSetupFailure('DOCUMENTOS_MIGRACION', error);
  process.exitCode = 1;
} finally {
  await owner?.end();
}
