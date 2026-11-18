import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { NestFactory } from '@nestjs/core';
import {
  developmentConfig,
  ownerConnection,
  DevelopmentSetupError,
  reportSetupFailure,
} from './lib/development-database.mjs';
import { applyDevelopmentMigrations } from './lib/development-migrations.mjs';
import {
  authenticateDevelopmentAccount,
  readDevelopmentFixture,
  saveDevelopmentFixture,
} from './lib/development-identities.mjs';

let owner, app, identity, adminAuthentication;
let stage = 'CONFIGURACION';
try {
  const config = await developmentConfig();
  const fixture = await readDevelopmentFixture(config);
  if (!process.env.SUPABASE_SECRET_KEY?.startsWith('sb_secret_'))
    throw new DevelopmentSetupError(
      'Falta SUPABASE_SECRET_KEY para la cuenta ficticia de Secretaría.',
    );
  owner = await ownerConnection(config);
  stage = 'MIGRACIONES';
  await applyDevelopmentMigrations(owner, [
    '202610280001_server_sessions.sql',
    '202610280002_identity_session_context.sql',
    '202610280003_record_creation_requests.sql',
    '202610280004_case_responsible_names.sql',
  ]);
  const { AppModule } = await import('../dist/app.module.js');
  const { IdentityService } =
    await import('../dist/modules/identity/application/identity.service.js');
  const { KvgRpcService } =
    await import('../dist/infrastructure/supabase/kvg-rpc.service.js');
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  identity = app.get(IdentityService);
  adminAuthentication = await authenticateDevelopmentAccount(
    identity,
    fixture,
    'ADMINISTRADOR',
  );
  const ordinaryRpc = app.get(KvgRpcService);
  const ordinary = (operation, data) =>
    ordinaryRpc.execute(adminAuthentication.accessToken, operation, data);
  const technical = createClient(config.api, process.env.SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, options) =>
        fetch(input, {
          ...options,
          signal: AbortSignal.timeout(10000),
          redirect: 'error',
        }),
    },
  });
  const work = async (operation, data) => {
    const result = await technical.rpc('kvg_trabajar', {
      p_operacion: operation,
      p_datos: data,
    });
    if (result.error || !result.data || result.data.correcto === false)
      throw new DevelopmentSetupError(
        'No se completó la conciliación técnica de la identidad ficticia.',
      );
    return result.data;
  };

  stage = 'SECRETARIA_FICTICIA';
  let secretary = fixture.accounts.find(
    (account) => account.role === 'SECRETARIA',
  );
  if (!secretary) {
    const email = `secretaria.kvg.${randomBytes(5).toString('hex')}@example.com`;
    const password = randomBytes(24).toString('base64url') + '!9aA';
    const result = await technical.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { development_fixture: true },
    });
    if (result.error || !result.data.user)
      throw new DevelopmentSetupError(
        'No se pudo preparar Auth para Secretaría.',
      );
    secretary = {
      role: 'SECRETARIA',
      name: 'Secretaría ficticia KVG',
      email,
      password,
      authUserId: result.data.user.id,
    };
    fixture.accounts.push(secretary);
    await saveDevelopmentFixture(fixture);
  }
  // Solo lectura administrativa para recuperar una preparación interrumpida.
  let profile = (
    await owner.query(
      'SELECT usuario_id,estado_cuenta FROM kvg.usuario WHERE correo_operativo=$1',
      [secretary.email],
    )
  ).rows[0];
  if (!profile) {
    const result = await ordinary('usuario.registrar', {
      nombre: secretary.name,
      correo: secretary.email,
    });
    profile = {
      usuario_id: result.usuario_id,
      estado_cuenta: result.estado_cuenta,
    };
  }
  secretary.userId = profile.usuario_id;
  await saveDevelopmentFixture(fixture);
  if (profile.estado_cuenta === 'INVITADO') {
    const jobs = await owner.query(
      "SELECT trabajo_id,estado,ejecutor_codigo FROM kvg.trabajo_operativo WHERE tipo='CONCILIAR_IDENTIDAD' AND objetivo_id=$1 AND estado IN ('EN_COLA','EN_EJECUCION')",
      [profile.usuario_id],
    );
    const other = await owner.query(
      "SELECT count(*)::integer AS count FROM kvg.trabajo_operativo WHERE estado IN ('EN_COLA','EN_EJECUCION') AND objetivo_id<>$1",
      [profile.usuario_id],
    );
    const policies = await owner.query(
      'SELECT count(*)::integer AS count FROM kvg.politica_respaldo WHERE activa',
    );
    if (jobs.rowCount !== 1 || other.rows[0].count || policies.rows[0].count)
      throw new DevelopmentSetupError(
        'Hay trabajos ajenos o políticas activas; no se tomarán trabajos indiscriminadamente.',
      );
    const job =
      jobs.rows[0].estado === 'EN_EJECUCION'
        ? jobs.rows[0]
        : await work('trabajo.tomar', {});
    if (job.trabajo_id !== jobs.rows[0].trabajo_id)
      throw new DevelopmentSetupError(
        'El trabajo tomado no corresponde a la preparación autorizada.',
      );
    await work('identidad.conciliar', {
      trabajo_id: job.trabajo_id,
      token: job.ejecutor_codigo,
      auth_usuario_id: secretary.authUserId,
    });
  } else if (profile.estado_cuenta !== 'ACTIVO')
    throw new DevelopmentSetupError('El perfil de prueba no está disponible.');
  const role = await owner.query(
    "SELECT count(*)::integer AS count FROM kvg.usuario_rol ur JOIN kvg.rol r USING(rol_id) WHERE ur.usuario_id=$1 AND r.codigo='SECRETARIA' AND ur.finaliza_en IS NULL",
    [secretary.userId],
  );
  if (!role.rows[0].count) {
    const current = (
      await owner.query(
        'SELECT revision FROM kvg.usuario WHERE usuario_id=$1',
        [secretary.userId],
      )
    ).rows[0];
    await ordinary('seguridad.otorgar_rol', {
      usuario_id: secretary.userId,
      rol: 'SECRETARIA',
      motivo:
        'Preparación autorizada del recorrido ficticio CU001/CU002/CU004/CU005.',
      revision: current.revision,
      referencia_autorizacion:
        'Preparación ficticia de desarrollo CU001/CU002/CU004/CU005.',
    });
  }

  stage = 'CATALOGO_FICTICIO';
  const catalogs = await ordinary('catalogos.consultar', {});
  if (
    !catalogs.tipos_identificacion.some(
      (type) => type.tipo_identificacion_codigo === 'PRUEBA_KVG',
    )
  )
    await ordinary('configuracion.identificacion', {
      codigo: 'PRUEBA_KVG',
      nombre: 'Identificación ficticia de desarrollo',
      regla: 'ALFANUMERICA_V1',
      unicidad: true,
    });
  const secretaryAuthentication = await authenticateDevelopmentAccount(
    identity,
    fixture,
    'SECRETARIA',
  );
  await identity.logout(secretaryAuthentication);
  console.log(
    JSON.stringify({
      resultado: 'preparado',
      secretaria_ficticia: true,
      catalogo_ficticio: true,
      correos_enviados: 0,
      crud_directo_negocio: false,
      credenciales_publicadas: false,
    }),
  );
} catch (error) {
  reportSetupFailure(stage, error);
  process.exitCode = 1;
} finally {
  if (identity && adminAuthentication)
    await identity.logout(adminAuthentication).catch(() => undefined);
  await owner?.end().catch(() => undefined);
  await app?.close().catch(() => undefined);
}
