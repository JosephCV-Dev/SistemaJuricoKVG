import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
  createHash,
} from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrivateFileGateway } from '../dist/modules/documents/infrastructure/private-file-gateway.js';
import {
  developmentConfig,
  ownerConnection,
  localDirectory,
  DevelopmentSetupError,
  reportSetupFailure,
} from './lib/development-database.mjs';
import { readDevelopmentFixture } from './lib/development-identities.mjs';

const IMAGE =
  'postgres@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab';
const root = new URL('../../../', import.meta.url);
const hash = (b) => createHash('sha256').update(b).digest('hex');
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
    p.stdout.on('data', (b) => {
      size += b.length;
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
try {
  const started = Date.now();
  const config = await developmentConfig();
  const fixture = await readDevelopmentFixture(config);
  owner = await ownerConnection(config);
  await owner.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const users = await owner.query('SELECT correo_operativo FROM kvg.usuario');
  check(
    users.rows.length === fixture.accounts.length &&
      users.rows.every((r) =>
        fixture.accounts.some((a) => a.email === r.correo_operativo),
      ),
    'solo_entorno_ficticio_conocido',
  );
  const tables = (
    await owner.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='kvg' ORDER BY tablename",
    )
  ).rows.map((r) => r.tablename);
  check(
    tables.length === 37 && tables.every((t) => /^[a-z_]+$/.test(t)),
    '37_tablas_modelo',
  );
  const rows = {};
  for (const table of tables)
    rows[table] = (
      await owner.query(`SELECT to_jsonb(t) AS row FROM kvg.${table} t`)
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
  for (const version of rows.version_documento) {
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
  check(objects.length > 0, 'originales_presentes_en_ensayo');
  await owner.query('ROLLBACK');
  const baseline = await readFile(
    new URL('database/baseline/Modelo_Fisico_KVG_PostgreSQL.sql', root),
    'utf8',
  );
  const snapshot = Buffer.from(
    JSON.stringify({
      rows,
      sequence,
      objects,
      baselineSha256: hash(baseline),
      snapshotTime,
    }),
  );
  const key = randomBytes(32),
    iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('KVG-development-rehearsal-v1'));
  const encrypted = Buffer.concat([
    iv,
    cipher.update(snapshot),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const archive = `${localDirectory}/recovery-${randomUUID()}`;
  await writeFile(archive + '.enc', encrypted, { mode: 0o600 });
  await writeFile(archive + '.key', key, { mode: 0o600 });
  const fromDisk = await readFile(archive + '.enc');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    await readFile(archive + '.key'),
    fromDisk.subarray(0, 12),
  );
  decipher.setAAD(Buffer.from('KVG-development-rehearsal-v1'));
  decipher.setAuthTag(fromDisk.subarray(-16));
  const restored = JSON.parse(
    Buffer.concat([
      decipher.update(fromDisk.subarray(12, -16)),
      decipher.final(),
    ]).toString(),
  );
  check(restored.baselineSha256 === hash(baseline), 'baseline_verificada');
  const damaged = Buffer.from(fromDisk);
  damaged[15] ^= 1;
  try {
    const d = createDecipheriv('aes-256-gcm', key, damaged.subarray(0, 12));
    d.setAAD(Buffer.from('KVG-development-rehearsal-v1'));
    d.setAuthTag(damaged.subarray(-16));
    d.update(damaged.subarray(12, -16));
    d.final();
    throw new DevelopmentSetupError('Cifrado no detectó corrupción.');
  } catch (e) {
    if (e instanceof DevelopmentSetupError) throw e;
    checks.push('copia_corrupta_rechazada');
  }
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
  // Restauración exclusiva del PostgreSQL efímero. Nunca DML en el origen remoto.
  // Triggers se omiten durante importación histórica y todas las FK se recrean y validan después.
  let restoreSql = 'BEGIN; SET LOCAL session_replication_role=replica;\n';
  for (const table of tables) {
    restoreSql += `DELETE FROM kvg.${table};\n`;
  }
  for (const table of tables)
    if (restored.rows[table].length)
      restoreSql += `INSERT INTO kvg.${table} SELECT * FROM jsonb_populate_recordset(NULL::kvg.${table},${literal(JSON.stringify(restored.rows[table]))}::jsonb);\n`;
  restoreSql += `SELECT setval('kvg.folio_expediente_seq',${Number(restored.sequence.last_value)},${restored.sequence.is_called ? 'true' : 'false'});\nSET LOCAL session_replication_role=origin;\n`;
  restoreSql += `DO $validate$ DECLARE r record; BEGIN FOR r IN SELECT conname,conrelid::regclass AS tbl,pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE contype='f' AND connamespace='kvg'::regnamespace LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',r.tbl,r.conname);EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',r.tbl,r.conname,r.def);END LOOP;END;$validate$;COMMIT;`;
  // Auth externo se representa únicamente por referencias ficticias; no credenciales ni sesiones.
  await sql(
    `INSERT INTO auth.users(id,email,email_confirmed_at) SELECT * FROM jsonb_to_recordset(${literal(JSON.stringify(rows.usuario.filter((u) => u.auth_usuario_id).map((u) => ({ id: u.auth_usuario_id, email: u.correo_operativo, email_confirmed_at: snapshotTime }))))}::jsonb) AS x(id uuid,email text,email_confirmed_at timestamptz);`,
  );
  await sql(restoreSql);
  check(true, 'datos_restaurados_con_todas_las_claves_foraneas_validadas');
  for (const table of tables) {
    const output = await sql(
      `SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM kvg.${table} t;`,
    );
    const actual = JSON.parse(output);
    check(actual.length === restored.rows[table].length, `recuento_${table}`);
    const canonical = (arr) =>
      JSON.stringify(
        arr.map((r) => JSON.stringify(r, Object.keys(r).sort())).sort(),
      );
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
  const manifest = {
    date: '2026-11-04',
    purpose: 'development-prototype-rehearsal',
    snapshotTime,
    baselineSha256: hash(baseline),
    encryptedSha256: hash(fromDisk),
    objects: objects.map(({ base64, ...o }) => o),
    tables: Object.fromEntries(tables.map((t) => [t, rows[t].length])),
    checks,
    elapsedSeconds: Math.ceil((Date.now() - started) / 1000),
    productionRestore: false,
    authProviderRestored: false,
  };
  await writeFile(
    archive + '.manifest.json',
    JSON.stringify(manifest, null, 2) + '\n',
    { mode: 0o600 },
  );
  await writeFile(
    `${localDirectory}/recovery-verification.json`,
    JSON.stringify(
      {
        date: manifest.date,
        result: 'passed',
        checks: checks.length,
        objects: objects.length,
        tables: tables.length,
        elapsedSeconds: manifest.elapsedSeconds,
        productionRestore: false,
        authProviderRestored: false,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      resultado: 'correcto',
      comprobaciones: checks.length,
      tablas: tables.length,
      objetos: objects.length,
      restauracion_produccion: false,
      auth_real_restaurado: false,
    }),
  );
} catch (error) {
  reportSetupFailure(stage, error);
  process.exitCode = 1;
} finally {
  await owner?.query('ROLLBACK').catch(() => undefined);
  await owner?.end();
  if (created) await docker(['rm', '-f', container]).catch(() => undefined);
}
