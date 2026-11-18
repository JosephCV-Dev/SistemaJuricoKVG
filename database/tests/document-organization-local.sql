-- CU009–CU011. Solo PostgreSQL efímero con el fixture, baseline y migraciones.
-- Las referencias de Storage son ficticias y verifican únicamente el contrato SQL.
BEGIN;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$
  SELECT coalesce(nullif(current_setting('kvg_test.claims',true),''),'{}')::jsonb
$$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
  SELECT (auth.jwt()->>'sub')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(auth.jwt()->>'role','anon')
$$;

INSERT INTO auth.users (id,email,email_confirmed_at)
SELECT ('10000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
       'local-'||n||'@example.test',clock_timestamp()
FROM generate_series(1,4) n;
SELECT public.kvg_inicializar(
  '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
  'Administración ficticia','Abogado ficticio','Prueba SQL local');

INSERT INTO kvg.usuario (auth_usuario_id,nombre,correo_operativo,estado_cuenta,creado_por)
SELECT a.id,'Secretaría ficticia',a.email,'ACTIVO',u.usuario_id FROM auth.users a
JOIN kvg.usuario u ON u.correo_operativo='local-1@example.test'
WHERE a.email IN ('local-3@example.test','local-4@example.test');
INSERT INTO kvg.usuario_rol (usuario_id,rol_id,otorgado_por,motivo_alta)
SELECT u.usuario_id,r.rol_id,u.creado_por,'Prueba SQL local' FROM kvg.usuario u
CROSS JOIN kvg.rol r WHERE r.codigo='SECRETARIA' AND u.correo_operativo IN ('local-3@example.test','local-4@example.test');
INSERT INTO kvg.tipo_identificacion (tipo_identificacion_codigo,nombre,regla_normalizacion,unicidad_exigida)
VALUES ('FICTICIA','Identificación ficticia','ALFANUMERICA_V1',true),
       ('LEGADA','Identificación anterior','EXACTA_V1',false);
INSERT INTO auth.sessions (id,user_id)
SELECT ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
FROM generate_series(3,4) n;

INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000005','local-5@example.test',clock_timestamp());
INSERT INTO kvg.usuario (auth_usuario_id,nombre,correo_operativo,estado_cuenta,creado_por)
SELECT '10000000-0000-4000-8000-000000000005','Segundo abogado ficticio','local-5@example.test','ACTIVO',usuario_id
FROM kvg.usuario WHERE correo_operativo='local-1@example.test';
INSERT INTO kvg.usuario_rol (usuario_id,rol_id,otorgado_por,motivo_alta)
SELECT u.usuario_id,r.rol_id,u.creado_por,'Prueba SQL local' FROM kvg.usuario u
CROSS JOIN kvg.rol r WHERE r.codigo='ABOGADO' AND u.correo_operativo='local-5@example.test';
INSERT INTO auth.sessions (id,user_id)
SELECT ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM (VALUES (1),(2),(5)) t(n);

INSERT INTO kvg_servidor.beta_documentos VALUES (true);


INSERT INTO kvg.categoria_documento (codigo,nombre,descripcion,activo)
VALUES ('PRUEBA_INACTIVA','Categoría inactiva ficticia','Solo para la prueba de clasificación.',false);

DO $test$
DECLARE r jsonb; a text; secretary text; principal text; new_team text;
  source_case uuid; target_case uuid; client_id uuid; source_folio text; target_folio text;
  first_lawyer uuid; second_lawyer uuid; category_a uuid; category_b uuid; inactive uuid;
  doc uuid; ver uuid; lease jsonb; job jsonb; upload_id uuid; revision_n integer; reason_move text:='Traslado ficticio de una ficha.';
  hash text:=repeat('a',64);
BEGIN
  SELECT usuario_id INTO first_lawyer FROM kvg.usuario WHERE correo_operativo='local-2@example.test';
  SELECT usuario_id INTO second_lawyer FROM kvg.usuario WHERE correo_operativo='local-5@example.test';
  SELECT categoria_id INTO category_a FROM kvg.categoria_documento WHERE activo ORDER BY categoria_id LIMIT 1;
  SELECT categoria_id INTO category_b FROM kvg.categoria_documento WHERE activo AND categoria_id<>category_a ORDER BY categoria_id LIMIT 1;
  SELECT categoria_id INTO inactive FROM kvg.categoria_documento WHERE nombre='Categoría inactiva ficticia';
  FOR i IN 1..5 LOOP
    a:=jsonb_build_object('sub','10000000-0000-4000-8000-'||lpad(i::text,12,'0'),
      'session_id','20000000-0000-4000-8000-'||lpad(i::text,12,'0'),'aal','aal2','role','authenticated')::text;
    PERFORM set_config('kvg_test.claims_'||i,a,true);
    PERFORM set_config('kvg_test.claims',a,true);
    SET LOCAL ROLE authenticated;
    r:=public.kvg_operar('sesion.iniciar');
    IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Sesión faltante %',i; END IF;
    RESET ROLE;
  END LOOP;
  secretary:=current_setting('kvg_test.claims_3');
  principal:=current_setting('kvg_test.claims_2');
  new_team:=current_setting('kvg_test.claims_5');
  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',secretary,true);
  r:=public.kvg_operar('cliente.registrar','{"nombre":"Persona documental ficticia"}');
  client_id:=(r#>>'{datos,cliente_id}')::uuid;
  r:=public.kvg_operar('expediente.crear',jsonb_build_object('cliente_id',client_id,'descripcion','Origen ficticio documental'));
  source_case:=(r#>>'{datos,expediente_id}')::uuid;
  source_folio:=r#>>'{datos,folio_interno}';
  r:=public.kvg_operar('expediente.crear',jsonb_build_object('cliente_id',client_id,'descripcion','Destino ficticio documental'));
  target_case:=(r#>>'{datos,expediente_id}')::uuid;
  target_folio:=r#>>'{datos,folio_interno}';
  r:=public.kvg_operar('expediente.asignar',jsonb_build_object('expediente_id',source_case,'revision',1,'abogado_id',first_lawyer,'funcion','PRINCIPAL','motivo','Origen ficticio'));
  IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Principal de origen: %',r; END IF;
  r:=public.kvg_operar('expediente.asignar',jsonb_build_object('expediente_id',target_case,'revision',1,'abogado_id',second_lawyer,'funcion','PRINCIPAL','motivo','Destino ficticio'));
  IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Principal de destino: %',r; END IF;

  r:=public.kvg_operar('documento.cargar',jsonb_build_object('expediente_id',source_case,'categoria_id',category_a,
    'nombre','Contrato documental ficticio','nombre_original','ficcion.pdf','clave_idempotencia',gen_random_uuid(),'motivo','Carga ficticia'));
  upload_id:=(r#>>'{datos,carga_id}')::uuid;
  doc:=(r#>>'{datos,documento_id}')::uuid;
  IF doc IS NULL THEN RAISE EXCEPTION 'Carga ficticia: %',r; END IF;
  r:=public.kvg_operar('documento.buscar','{"texto":"Contrato documental"}');
  IF r->'datos' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'La carga no publicada aparece globalmente: %',r; END IF;

  RESET ROLE;
  INSERT INTO storage.objects(bucket_id,name) VALUES('kvg-cuarentena','cargas/'||upload_id||'/original'),
    ('kvg-originales','versiones/'||upload_id||'/original');
  SET LOCAL ROLE service_role;
  PERFORM set_config('kvg_test.claims','{"role":"service_role"}',true);
  PERFORM public.kvg_trabajar('carga.recibir',jsonb_build_object('carga_id',upload_id,'tamano_bytes',10));
  job:=public.kvg_trabajar('trabajo.tomar_carga_beta');
  lease:=jsonb_build_object('trabajo_id',job->>'trabajo_id','token',job->>'ejecutor_codigo');
  r:=public.kvg_trabajar('carga.publicar_beta',lease||jsonb_build_object('tamano_bytes',10,
    'sha256',hash,'formato','PDF','mime_verificado','application/pdf'));
  ver:=(r->>'version_id')::uuid;
  IF ver IS NULL THEN RAISE EXCEPTION 'Versión ficticia: %',r; END IF;
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',secretary,true);
  r:=public.kvg_operar('documento.buscar',jsonb_build_object('texto','contrato','folio',source_folio,'cliente','documental',
    'categoria_id',category_a,'desde',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD'),'estado','RECIBIDO','orden','nombre'));
  IF r#>>'{datos,0,documento_id}' IS DISTINCT FROM doc::text THEN RAISE EXCEPTION 'Búsqueda por metadatos: %',r; END IF;
  r:=public.kvg_operar('documento.buscar','{"orden":"otra"}');
  IF r->>'codigo' IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'Aceptó ordenamiento inválido'; END IF;
  r:=public.kvg_operar('documento.consultar',jsonb_build_object('documento_id',doc));
  revision_n:=(r#>>'{datos,revision}')::integer;
  IF r#>>'{datos,puede_clasificar}' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Ficha sin clasificación: %',r; END IF;
  r:=public.kvg_operar('documento.clasificar',jsonb_build_object('documento_id',doc,'revision',revision_n,'categoria_id',inactive));
  IF r->>'codigo' IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'Admitió categoría inactiva: %',r; END IF;
  r:=public.kvg_operar('documento.clasificar',jsonb_build_object('documento_id',doc,'revision',revision_n,'categoria_id',category_b,
    'motivo','CORREGIR_CLASIFICACION'));
  IF (r#>>'{datos,revision}')::integer IS DISTINCT FROM revision_n+1 THEN RAISE EXCEPTION 'Clasificación fallida: %',r; END IF;
  r:=public.kvg_operar('documento.clasificar',jsonb_build_object('documento_id',doc,'revision',revision_n,'categoria_id',category_a));
  IF r->>'codigo' IS DISTINCT FROM '40001' THEN RAISE EXCEPTION 'Admitió clasificación obsoleta: %',r; END IF;

  PERFORM set_config('kvg_test.claims',principal,true);
  r:=public.kvg_operar('documento.destinos',jsonb_build_object('documento_id',doc,'texto',target_folio));
  IF r->'datos' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'Reveló destino ajeno: %',r; END IF;
  r:=public.kvg_operar('documento.asociar',jsonb_build_object('documento_id',doc,'revision',revision_n+1,'expediente_destino_id',target_case,'motivo',reason_move));
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Traslado a destino ajeno: %',r; END IF;
  PERFORM set_config('kvg_test.claims',secretary,true);
  r:=public.kvg_operar('documento.destinos',jsonb_build_object('documento_id',doc,'texto',target_folio));
  IF r#>>'{datos,0,expediente_id}' IS DISTINCT FROM target_case::text THEN RAISE EXCEPTION 'Destino válido faltante: %',r; END IF;
  r:=public.kvg_operar('documento.asociar',jsonb_build_object('documento_id',doc,'revision',revision_n+1,'expediente_destino_id',target_case,'motivo',reason_move));
  IF r#>>'{datos,expediente_id}' IS DISTINCT FROM target_case::text THEN RAISE EXCEPTION 'Traslado autorizado fallido: %',r; END IF;
  r:=public.kvg_operar('documento.consultar',jsonb_build_object('documento_id',doc));
  IF r#>>'{datos,folio_expediente}' IS DISTINCT FROM target_folio OR r#>>'{datos,asociaciones,0,origen}' IS DISTINCT FROM source_folio
    OR r#>>'{datos,clasificaciones,0,motivo}' IS DISTINCT FROM 'CORREGIR_CLASIFICACION'
    OR r#>>'{datos,version,version_id}' IS DISTINCT FROM ver::text OR r#>>'{datos,version,sha256}' IS DISTINCT FROM hash THEN
    RAISE EXCEPTION 'Ficha, historial u original alterados: %',r;
  END IF;
  PERFORM set_config('kvg_test.claims',principal,true);
  r:=public.kvg_operar('documento.buscar','{"texto":"contrato"}');
  IF r->'datos' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'El origen mantiene acceso a resultados: %',r; END IF;
  r:=public.kvg_operar('documento.descargar',jsonb_build_object('version_id',ver));
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'El origen mantiene descarga: %',r; END IF;
  PERFORM set_config('kvg_test.claims',new_team,true);
  r:=public.kvg_operar('documento.consultar',jsonb_build_object('documento_id',doc));
  IF r#>>'{datos,folio_expediente}' IS DISTINCT FROM target_folio
    OR r#>'{datos,asociaciones,0,origen}' IS DISTINCT FROM 'null'::jsonb
    OR r#>'{datos,asociaciones,0,motivo}' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Filtró historial restringido: %',r; END IF;
  r:=public.kvg_operar('documento.descargar',jsonb_build_object('version_id',ver));
  IF r#>>'{datos,sha256}' IS DISTINCT FROM hash THEN RAISE EXCEPTION 'El destino no conserva la descarga privada: %',r; END IF;
  RESET ROLE;
  IF (SELECT count(*) FROM kvg.version_documento WHERE documento_id=doc)<>1
    OR (SELECT count(*) FROM kvg.evento_auditoria WHERE recurso_id=doc AND accion='DOCUMENTO_CLASIFICADO')<>1
    OR (SELECT count(*) FROM kvg.historial_asociacion_documento WHERE documento_id=doc)<>2 THEN RAISE EXCEPTION 'Evidencia inconsistente'; END IF;
  RAISE NOTICE '5A: filtros, alcance, revisión, catálogo, traslado, historial filtrado y original conservado';
END;
$test$;
ROLLBACK;
