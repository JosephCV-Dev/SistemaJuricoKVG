import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { applyDevelopmentMigrations } from './lib/development-migrations.mjs';
import { createClient } from '@supabase/supabase-js';
import {
  developmentConfig,
  ownerConnection,
  updateLocalEnvironment,
  localDirectory,
  DevelopmentSetupError,
  reportSetupFailure,
} from './lib/development-database.mjs';

let owner;
let stage = 'CONFIGURACION';
try {
  const config = await developmentConfig();
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret?.startsWith('sb_secret_'))
    throw new DevelopmentSetupError(
      'Configura SUPABASE_SECRET_KEY para crear las identidades ficticias sin correos.',
    );
  owner = await ownerConnection(config);
  stage = 'REVISION_BOOTSTRAP';
  const before = await owner.query(
    'SELECT (SELECT count(*) FROM kvg.usuario)::integer AS perfiles, (SELECT count(*) FROM auth.users)::integer AS identidades',
  );
  console.log(JSON.stringify({ preflight: before.rows[0] }));
  const credentialsPath = `${localDirectory}/identity-development-accounts.json`;
  let fixture;
  try {
    fixture = JSON.parse(await readFile(credentialsPath, 'utf8'));
  } catch {
    fixture = null;
  }
  if (fixture && fixture.projectReference !== config.reference)
    throw new DevelopmentSetupError(
      'El archivo de identidades pertenece a otro proyecto.',
    );
  if (before.rows[0].perfiles > 0 && !fixture)
    throw new DevelopmentSetupError(
      'Ya existe bootstrap. Se requieren identidades de desarrollo existentes; no se sustituirán perfiles.',
    );

  stage = 'MIGRACIONES';
  await applyDevelopmentMigrations(owner, [
    '202610280001_server_sessions.sql',
    '202610280002_identity_session_context.sql',
  ]);

  stage = 'ALMACEN_SESIONES';
  let sessionUrl = process.env.SESSION_DATABASE_URL;
  if (!sessionUrl) {
    const password = randomBytes(40).toString('base64url');
    const encoded = config.database.toString();
    const generated = new URL(encoded);
    generated.username = decodeURIComponent(
      config.database.username,
    ).startsWith('postgres.')
      ? `kvg_session_store.${config.reference}`
      : 'kvg_session_store';
    generated.password = password;
    const statement = await owner.query(
      "SELECT format('ALTER ROLE kvg_session_store PASSWORD %L', $1::text) AS statement",
      [password],
    );
    await owner.query(statement.rows[0].statement);
    sessionUrl = generated.toString();
  }
  await updateLocalEnvironment({
    SESSION_DATABASE_URL: sessionUrl,
    SESSION_SECRET:
      process.env.SESSION_SECRET || randomBytes(48).toString('base64url'),
    SESSION_ENCRYPTION_KEY:
      process.env.SESSION_ENCRYPTION_KEY || randomBytes(32).toString('base64'),
    APP_ORIGIN: process.env.APP_ORIGIN || 'http://127.0.0.1:5173',
    TRUST_PROXY: process.env.TRUST_PROXY || 'false',
  });

  stage = 'IDENTIDADES_FICTICIAS';
  const admin = createClient(config.api, secret, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  fixture ??= {
    environment: 'development',
    projectReference: config.reference,
    approvalReference:
      'DESARROLLO-CU023-CU024-2026-10-28: identidades ficticias autorizadas para pruebas; sin habilitación de producción',
    accounts: [],
  };
  const persistFixture = () =>
    writeFile(credentialsPath, JSON.stringify(fixture, null, 2) + '\n', {
      mode: 0o600,
    });
  for (const [role, label] of [
    ['ADMINISTRADOR', 'Administrador de prueba KVG'],
    ['ABOGADO', 'Responsable jurídico de prueba KVG'],
  ]) {
    if (fixture.accounts.some((account) => account.role === role)) continue;
    const email = `${role.toLowerCase()}.kvg.${randomBytes(5).toString('hex')}@example.com`;
    const password = randomBytes(24).toString('base64url') + '!9aA';
    const result = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { development_fixture: true },
    });
    if (result.error || !result.data.user?.id)
      throw new DevelopmentSetupError(
        'No se pudo crear una identidad ficticia mediante Auth Admin.',
      );
    fixture.accounts.push({
      role,
      name: label,
      email,
      password,
      authUserId: result.data.user.id,
    });
    await persistFixture();
  }
  const technical = fixture.accounts.find(
    (account) => account.role === 'ADMINISTRADOR',
  );
  const legal = fixture.accounts.find((account) => account.role === 'ABOGADO');
  stage = 'BOOTSTRAP_DESARROLLO';
  if (before.rows[0].perfiles === 0) {
    const result = await owner.query(
      'SELECT public.kvg_inicializar($1::uuid,$2::uuid,$3::text,$4::text,$5::text) AS result',
      [
        technical.authUserId,
        legal.authUserId,
        technical.name,
        legal.name,
        fixture.approvalReference,
      ],
    );
    fixture.operationalIds = result.rows[0].result;
    await persistFixture();
    console.log(
      JSON.stringify({ bootstrap: 'realizado_con_dos_identidades_ficticias' }),
    );
  } else console.log(JSON.stringify({ bootstrap: 'se_conserva_el_existente' }));
  console.log(
    JSON.stringify({
      resultado: 'preparado',
      credenciales_locales:
        'apps/api/.local/identity-development-accounts.json',
      env: 'apps/api/.env',
      correos_enviados: 0,
    }),
  );
} catch (error) {
  reportSetupFailure(stage, error);
  process.exitCode = 1;
} finally {
  await owner?.end().catch(() => undefined);
}
