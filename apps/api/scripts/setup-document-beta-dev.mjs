import {
  developmentConfig,
  ownerConnection,
  updateLocalEnvironment,
  DevelopmentSetupError,
  reportSetupFailure,
} from './lib/development-database.mjs';
import { readDevelopmentFixture } from './lib/development-identities.mjs';
import { applyDevelopmentMigrations } from './lib/development-migrations.mjs';

let owner;
let stage = 'BETA_DOCUMENTAL_CONFIGURACION';
try {
  const [option, extra] = process.argv.slice(2);
  if (extra || !['--enable', '--disable'].includes(option))
    throw new DevelopmentSetupError('Indica --enable o --disable.');
  const enable = option === '--enable';
  const config = await developmentConfig();
  const fixture = await readDevelopmentFixture(config);
  owner = await ownerConnection(config);
  const { rows } = await owner.query(
    'SELECT correo_operativo FROM kvg.usuario',
  );
  if (
    !rows.length ||
    rows.some(
      (user) =>
        !fixture.accounts.some(
          (account) => account.email === user.correo_operativo,
        ),
    )
  )
    throw new DevelopmentSetupError(
      'Usa únicamente el proyecto con las cuentas ficticias conocidas.',
    );
  if (enable && !process.env.SUPABASE_SECRET_KEY?.startsWith('sb_secret_'))
    throw new DevelopmentSetupError(
      'Falta la clave técnica privada del trabajador.',
    );
  stage = 'BETA_DOCUMENTAL_MIGRACION';
  await applyDevelopmentMigrations(owner, [
    '202611040005_document_upload_workflow.sql',
    '202611040006_document_detail_and_failed_jobs.sql',
    '202611170008_document_beta.sql',
  ]);
  stage = 'BETA_DOCUMENTAL_ACTIVACION';
  await owner.query(
    enable
      ? 'INSERT INTO kvg_servidor.beta_documentos (habilitado) VALUES (true) ON CONFLICT DO NOTHING'
      : 'DELETE FROM kvg_servidor.beta_documentos',
  );
  await updateLocalEnvironment({
    DOCUMENT_UPLOAD_MODE: enable ? 'beta' : 'paused',
  });
  console.log(JSON.stringify({ modo: enable ? 'beta' : 'paused' }));
} catch (error) {
  reportSetupFailure(stage, error);
  process.exitCode = 1;
} finally {
  await owner?.end();
}
