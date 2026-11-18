import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  archiveLimit,
  backupIdPattern,
  hash,
  loadBackup,
  recordRecovery,
  recoveryDirectories,
  storeBackup,
} from './lib/development-recovery-archive.mjs';
import { ConfigService } from '@nestjs/config';
import { PrivateFileGateway } from '../dist/modules/documents/infrastructure/private-file-gateway.js';
import {
  developmentConfig,
  envPath,
  ownerConnection,
  localDirectory,
  DevelopmentSetupError,
  reportSetupFailure,
} from './lib/development-database.mjs';
import {
  isDevelopmentEmail,
  readDevelopmentFixture,
} from './lib/development-identities.mjs';

const IMAGE =
  'postgres@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab';
const root = new URL('../../../', import.meta.url);
const migrationsDirectory = new URL('database/migrations/', root);
const privateTables = [
  'solicitud_creacion',
  'decision_personal',
  'cambio_catalogo',
];
const tablePattern =
  /^(?:kvg\.[a-z_]+|kvg_privado\.(?:solicitud_creacion|decision_personal|cambio_catalogo))$/;
const baselinePath = new URL(
  'database/baseline/Modelo_Fisico_KVG_PostgreSQL.sql',
  root,
);
const container = `kvg-recovery-${randomUUID()}`;
let owner,
  created = false,
  stage = 'CONFIGURACION';
const checks = [];
const check = (ok, name) => {
  if (!ok) throw new DevelopmentSetupError(`Comprobación no superada: ${name}`);
  checks.push(name);
};
function docker(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '',
      size = 0;
    const timeout = setTimeout(() => {
      p.kill();
      reject(new Error());
    }, 120000);
    p.on('error', () => {
      clearTimeout(timeout);
      reject(new Error());
    });
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (b) => {
      size += Buffer.byteLength(b);
      if (size > 16_000_000) p.kill();
      else output += b.toString();
    });
    p.stderr.on('data', () => undefined);
    p.stdin.on('error', () => undefined);
    p.on('close', (code) => {
      clearTimeout(timeout);
      code === 0 ? resolve(output) : reject(new Error());
    });
    p.stdin.end(input);
  });
}
const sql = (source) =>
  docker(
    [
      'exec',
      '-i',
      container,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-X',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    source,
  );
const literal = (v) => `'${String(v).replaceAll("'", "''")}'`;
async function captureBackup(config) {
  const fixture = await readDevelopmentFixture(config);
  owner = await ownerConnection(config);
  await owner.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const users = await owner.query('SELECT correo_operativo FROM kvg.usuario');
  check(
    fixture.accounts.every((account) =>
      users.rows.some((row) => row.correo_operativo === account.email),
    ) &&
      users.rows.every((r) => isDevelopmentEmail(fixture, r.correo_operativo)),
    'solo_entorno_ficticio_conocido',
  );
  const migrations = (
    await owner.query(
      'SELECT nombre, sha256 FROM kvg_servidor.migracion ORDER BY nombre',
    )
  ).rows;
  await migrationSources(migrations);
  const tables = (
    await owner.query(
      `SELECT schemaname || '.' || tablename AS name FROM pg_tables
       WHERE schemaname='kvg' OR (schemaname='kvg_privado' AND tablename=ANY($1::text[]))
       ORDER BY 1`,
      [privateTables],
    )
  ).rows.map((row) => row.name);
  check(
    tables.length >= 37 && tables.every((table) => tablePattern.test(table)),
    'tablas_modelo',
  );
  const rows = {};
  for (const table of tables)
    rows[table] = (
      await owner.query(`SELECT to_jsonb(t) AS row FROM ${table} t`)
    ).rows.map((r) => r.row);
  const sequence = (
    await owner.query(
      'SELECT last_value::text,is_called FROM kvg.folio_expediente_seq',
    )
  ).rows[0];
  const snapshotTime = (
    await owner.query('SELECT transaction_timestamp() AS time')
  ).rows[0].time.toISOString();
  const files = new PrivateFileGateway(new ConfigService(process.env));
  const objects = [];
  let objectBytes = 0;
  for (const version of rows['kvg.version_documento']) {
    objectBytes += Number(version.tamano_bytes);
    check(objectBytes <= archiveLimit * 0.7, 'limite_de_originales_del_ensayo');
    const bytes = await files.read(
      'kvg-originales',
      version.localizador_objeto,
    );
    check(
      hash(bytes) === version.sha256 &&
        bytes.length === Number(version.tamano_bytes),
      'integridad_origen_version',
    );
    objects.push({
      versionId: version.version_id,
      path: version.localizador_objeto,
      sha256: hash(bytes),
      size: bytes.length,
      base64: bytes.toString('base64'),
    });
  }
  await owner.query('ROLLBACK');
  return {
    rows,
    sequence,
    objects,
    migrations,
    baselineSha256: hash(await readFile(baselinePath)),
    snapshotTime,
  };
}

async function migrationSources(migrations) {
  const available = new Set(await readdir(migrationsDirectory));
  const sources = [];
  let previous = '';
  for (const migration of migrations) {
    const { nombre, sha256 } = migration;
    check(
      /^\d{12}_[a-z0-9_]+\.sql$/.test(nombre) &&
        available.has(nombre) &&
        nombre > previous,
      'migracion_registrada',
    );
    const source = await readFile(new URL(nombre, migrationsDirectory), 'utf8');
    check(hash(source) === sha256, 'compatibilidad_de_migracion');
    sources.push(source);
    previous = nombre;
  }
  return sources;
}

async function restoreIsolated(restored) {
  const baseline = await readFile(baselinePath, 'utf8');
  check(restored.baselineSha256 === hash(baseline), 'baseline_verificada');
  const migrations = await migrationSources(restored.migrations);
  const tables = Object.keys(restored.rows);
  check(
    tables.every((table) => tablePattern.test(table)),
    'tablas_permitidas',
  );
  check(
    restored.objects.length === restored.rows['kvg.version_documento'].length,
    'cobertura_versiones',
  );
  const inventory = new Map(
    restored.rows['kvg.version_documento'].map((version) => [
      version.version_id,
      version,
    ]),
  );
  for (const object of restored.objects) {
    const version = inventory.get(object.versionId);
    check(
      version &&
        version.localizador_objeto === object.path &&
        version.sha256 === object.sha256 &&
        Number(version.tamano_bytes) === object.size,
      'manifiesto_de_originales',
    );
    inventory.delete(object.versionId);
  }
  check(!inventory.size, 'inventario_completo');
  check(/^\d+$/.test(restored.sequence.last_value), 'secuencia_valida');
  stage = 'RESTAURACION_AISLADA';
  await docker([
    'run',
    '-d',
    '--name',
    container,
    '--network',
    'none',
    '--memory',
    '768m',
    '--tmpfs',
    '/var/lib/postgresql/data:rw,nosuid,size=512m',
    '--tmpfs',
    '/restore:rw,nosuid,size=128m',
    '-e',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    IMAGE,
  ]);
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await sql('SELECT 1;');
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  check(ready, 'postgres_aislado_listo');
  await sql(
    await readFile(
      new URL('database/tests/recovery-platform-fixture.sql', root),
      'utf8',
    ),
  );
  await sql(baseline);
  for (const migration of migrations) await sql(migration);
  const restoredTables = (
    await sql(
      `SELECT schemaname || '.' || tablename FROM pg_tables WHERE schemaname='kvg' OR
      (schemaname='kvg_privado' AND tablename IN (${privateTables.map(literal).join(',')})) ORDER BY 1;`,
    )
  )
    .trim()
    .split('\n');
  check(
    JSON.stringify(restoredTables) === JSON.stringify(tables.slice().sort()),
    'cobertura_del_esquema',
  );
  // Restauración exclusiva del PostgreSQL efímero. Nunca DML en el origen remoto.
  // Triggers se omiten durante importación histórica y todas las FK se recrean y validan después.
  let restoreSql = 'BEGIN; SET LOCAL session_replication_role=replica;\n';
  for (const table of tables) {
    restoreSql += `DELETE FROM ${table};\n`;
  }
  for (const table of tables)
    if (restored.rows[table].length)
      restoreSql += `INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},${literal(JSON.stringify(restored.rows[table]))}::jsonb);\n`;
  restoreSql += `SELECT setval('kvg.folio_expediente_seq',${restored.sequence.last_value},${restored.sequence.is_called ? 'true' : 'false'});\nSET LOCAL session_replication_role=origin;\n`;
  restoreSql += `DO $validate$ DECLARE r record; BEGIN FOR r IN SELECT conname,conrelid::regclass AS tbl,pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE contype='f' AND connamespace IN ('kvg'::regnamespace,'kvg_privado'::regnamespace) LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',r.tbl,r.conname);EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',r.tbl,r.conname,r.def);END LOOP;END;$validate$;COMMIT;`;
  // Auth externo se representa únicamente por referencias ficticias; no credenciales ni sesiones.
  await sql(
    `INSERT INTO auth.users(id,email,email_confirmed_at) SELECT * FROM jsonb_to_recordset(${literal(JSON.stringify(restored.rows['kvg.usuario'].filter((u) => u.auth_usuario_id).map((u) => ({ id: u.auth_usuario_id, email: u.correo_operativo, email_confirmed_at: restored.snapshotTime }))))}::jsonb) AS x(id uuid,email text,email_confirmed_at timestamptz);`,
  );
  await sql(restoreSql);
  check(true, 'datos_restaurados_con_todas_las_claves_foraneas_validadas');
  for (const table of tables) {
    const output = await sql(
      `SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM ${table} t;`,
    );
    const actual = JSON.parse(output);
    check(actual.length === restored.rows[table].length, `recuento_${table}`);
    const canonical = (arr) =>
      JSON.stringify(arr.map((row) => JSON.stringify(sortedJson(row))).sort());
    check(
      canonical(actual) === canonical(restored.rows[table]),
      `contenido_${table}`,
    );
  }
  for (let index = 0; index < restored.objects.length; index++) {
    const o = restored.objects[index];
    const bytes = Buffer.from(o.base64, 'base64');
    check(
      bytes.length === o.size && hash(bytes) === o.sha256,
      'objeto_copia_verificado',
    );
    await docker(
      ['exec', '-i', container, 'sh', '-c', `cat > /restore/object-${index}`],
      bytes,
    );
    const restoredHash = await docker([
      'exec',
      container,
      'sha256sum',
      `/restore/object-${index}`,
    ]);
    check(restoredHash.split(' ')[0] === o.sha256, 'objeto_restaurado_sha256');
  }
  check(
    (
      await sql(
        "SELECT (public.kvg_operar('documento.buscar','{}')->>'correcto')='false';",
      )
    ).trim() === 't',
    'entorno_aislado_no_reabre_accesos',
  );
  check(
    (
      await docker([
        'inspect',
        '--format',
        '{{.HostConfig.NetworkMode}}',
        container,
      ])
    ).trim() === 'none',
    'restauracion_sin_red',
  );
}

function sortedJson(value) {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortedJson(value[key])]),
    );
  return value;
}

let reportPath;
let report;
try {
  const [command = 'rehearse', selected, confirmation, ...rest] =
    process.argv.slice(2);
  if (
    rest.length ||
    !['create', 'list', 'restore', 'rehearse'].includes(command) ||
    (command === 'restore'
      ? !backupIdPattern.test(selected ?? '') || confirmation !== '--confirmar'
      : selected !== undefined)
  ) {
    throw new DevelopmentSetupError(
      'Usa create, list, rehearse o restore ID --confirmar.',
    );
  }
  if (command === 'list' || command === 'restore') {
    try {
      process.loadEnvFile(envPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if ((process.env.NODE_ENV ?? 'development') !== 'development')
    throw new DevelopmentSetupError(
      'Este procedimiento solo se permite en desarrollo.',
    );

  const config =
    command === 'create' || command === 'rehearse'
      ? await developmentConfig()
      : null;
  const directories = await recoveryDirectories();
  if (command === 'list') {
    const names = await readdir(directories.copies);
    const reports = [];
    for (const name of names.filter((entry) =>
      /^(?:copia|ensayo)-[a-f0-9-]{36}\.json$/.test(entry),
    )) {
      reports.push(
        JSON.parse(await readFile(join(directories.copies, name), 'utf8')),
      );
    }
    console.log(
      JSON.stringify(
        reports.sort((a, b) => b.fecha.localeCompare(a.fecha)),
        null,
        2,
      ),
    );
  } else {
    const id = selected ?? randomUUID();
    if (command !== 'restore') {
      reportPath = join(directories.copies, 'copia-' + id + '.json');
      report = {
        id,
        tipo: 'copia_desarrollo',
        fecha: new Date().toISOString(),
        estado: 'EN_PROCESO',
      };
      await recordRecovery(reportPath, report);
      stage = 'CAPTURA';
      const snapshot = await captureBackup(config);
      const stored = await storeBackup(directories, id, snapshot);
      const restored = await loadBackup(directories, id);
      check(hash(restored.data) === stored.sha256, 'copia_cifrada_releida');
      report = {
        ...report,
        estado: 'COPIA_LOCAL_COMPROBADA',
        punto_recuperacion: snapshot.snapshotTime,
        bytes: stored.bytes,
        sha256: stored.sha256,
        objetos: snapshot.objects.length,
        tablas: Object.keys(snapshot.rows).length,
      };
      await recordRecovery(reportPath, report);
      console.log(JSON.stringify(report));
    }
    if (command !== 'create') {
      const attempt = randomUUID();
      reportPath = join(directories.copies, 'ensayo-' + attempt + '.json');
      report = {
        id: attempt,
        respaldo: id,
        tipo: 'ensayo_aislado',
        fecha: new Date().toISOString(),
        estado: 'EN_PROCESO',
      };
      await recordRecovery(reportPath, report);
      stage = 'VALIDAR_COPIA';
      const resumeStart = Date.now();
      const { snapshot } = await loadBackup(directories, id);
      await restoreIsolated(snapshot);
      report = {
        ...report,
        estado: 'ENSAYO_LOCAL_SUPERADO',
        comprobaciones: checks.length,
        tablas: Object.keys(snapshot.rows).length,
        objetos: snapshot.objects.length,
        duracion_restauracion_segundos: Math.ceil(
          (Date.now() - resumeStart) / 1000,
        ),
        antiguedad_copia_segundos: Math.max(
          0,
          Math.ceil((resumeStart - Date.parse(snapshot.snapshotTime)) / 1000),
        ),
      };
      await recordRecovery(reportPath, report);
      console.log(JSON.stringify(report));
      if (command === 'rehearse')
        await recordRecovery(
          join(localDirectory, 'recovery-verification.json'),
          report,
        );
    }
  }
} catch (error) {
  if (reportPath && report)
    await recordRecovery(reportPath, {
      ...report,
      estado: 'FALLIDO',
      etapa: stage,
    }).catch(() => undefined);
  reportSetupFailure(stage, error);
  process.exitCode = 1;
} finally {
  await owner?.query('ROLLBACK').catch(() => undefined);
  await owner?.end();
  if (created) await docker(['rm', '-f', container]).catch(() => undefined);
}
