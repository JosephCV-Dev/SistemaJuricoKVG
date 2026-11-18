-- CU006/CU017. Ejecutar solo en PostgreSQL efímero con el fixture, baseline y migraciones.
-- Las filas de almacenamiento representan objetos ficticios de una prueba del contrato SQL.
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

DO $test$
DECLARE r jsonb; actor text; arguments jsonb; secretaria text; abogado text; colaborador text;
  client_id uuid; case_id uuid; other_case uuid; lawyer_id uuid; second_id uuid; category_id uuid;
  upload_id uuid; version_id uuid; task jsonb; lease jsonb; progress_id uuid; progress_request uuid:=gen_random_uuid();
  progress_args jsonb;
BEGIN
  SELECT usuario_id INTO lawyer_id FROM kvg.usuario WHERE correo_operativo='local-2@example.test';
  SELECT usuario_id INTO second_id FROM kvg.usuario WHERE correo_operativo='local-5@example.test';
  SELECT categoria_id INTO category_id FROM kvg.categoria_documento WHERE activo ORDER BY categoria_id LIMIT 1;
  FOR i IN 1..5 LOOP
    actor:=jsonb_build_object('sub','10000000-0000-4000-8000-'||lpad(i::text,12,'0'),
      'session_id','20000000-0000-4000-8000-'||lpad(i::text,12,'0'),'aal','aal2','role','authenticated')::text;
    PERFORM set_config('kvg_test.claims_'||i,actor,true);
    PERFORM set_config('kvg_test.claims',actor,true);
    SET LOCAL ROLE authenticated;
    r:=public.kvg_operar('sesion.iniciar');
    IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Sesión faltante %',i; END IF;
    RESET ROLE;
  END LOOP;
  secretaria:=current_setting('kvg_test.claims_3');
  abogado:=current_setting('kvg_test.claims_2');
  colaborador:=current_setting('kvg_test.claims_5');
  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',secretaria,true);
  r:=public.kvg_operar('cliente.registrar','{"nombre":"Cliente seguimiento ficticio"}');
  client_id:=(r#>>'{datos,cliente_id}')::uuid;
  r:=public.kvg_operar('expediente.crear',jsonb_build_object('cliente_id',client_id,'descripcion','Seguimiento ficticio'));
  case_id:=(r#>>'{datos,expediente_id}')::uuid;
  r:=public.kvg_operar('expediente.crear',jsonb_build_object('cliente_id',client_id,'descripcion','Otro expediente ficticio'));
  other_case:=(r#>>'{datos,expediente_id}')::uuid;
  IF case_id IS NULL OR other_case IS NULL THEN RAISE EXCEPTION 'Expediente faltante: %',r; END IF;
  arguments:=jsonb_build_object('expediente_id',case_id);
  r:=public.kvg_operar('expediente.consultar',arguments);
  IF r#>'{datos,transiciones}' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'Transición sin principal: %',r; END IF;
  r:=public.kvg_operar('expediente.cambiar_estado',arguments||'{"revision":1,"estado":"EN_PROCESO","motivo":"Sin principal"}');
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Aceptó iniciar sin principal: %',r; END IF;
  r:=public.kvg_operar('expediente.asignar',arguments||jsonb_build_object('revision',1,'abogado_id',lawyer_id,'funcion','PRINCIPAL','motivo','Ficticio'));
  IF r#>>'{datos,revision}' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'Principal faltante: %',r; END IF;
  r:=public.kvg_operar('expediente.asignar',arguments||jsonb_build_object('revision',2,'abogado_id',second_id,'funcion','COLABORADOR','motivo','Ficticio'));
  IF r#>>'{datos,revision}' IS DISTINCT FROM '3' THEN RAISE EXCEPTION 'Colaborador faltante: %',r; END IF;
  r:=public.kvg_operar('expediente.asignar',jsonb_build_object('expediente_id',other_case,
    'revision',1,'abogado_id',lawyer_id,'funcion','PRINCIPAL','motivo','Ficticio'));
  IF r#>>'{datos,revision}' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'Asignación del segundo expediente: %',r; END IF;

  r:=public.kvg_operar('expediente.cambiar_estado',arguments||'{"revision":3,"estado":"ARCHIVADO","motivo":"Salto inválido"}');
  IF r->>'codigo' IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'Aceptó saltar la matriz: %',r; END IF;
  r:=public.kvg_operar('expediente.cambiar_estado',arguments||'{"revision":3,"estado":"EN_PROCESO","motivo":"Inicio ficticio"}');
  IF r#>>'{datos,revision}' IS DISTINCT FROM '4' THEN RAISE EXCEPTION 'Inicio fallido: %',r; END IF;
  r:=public.kvg_operar('expediente.cambiar_estado',arguments||'{"revision":3,"estado":"PENDIENTE","motivo":"Obsoleto"}');
  IF r->>'codigo' IS DISTINCT FROM '40001' THEN RAISE EXCEPTION 'Revisión obsoleta aceptada: %',r; END IF;
  r:=public.kvg_operar('expediente.cambiar_estado',arguments||'{"revision":4,"estado":"PENDIENTE","motivo":"Pendiente ficticio"}');
  IF r#>>'{datos,revision}' IS DISTINCT FROM '5' THEN RAISE EXCEPTION 'Suspensión fallida: %',r; END IF;
  r:=public.kvg_operar('expediente.cambiar_estado',arguments||'{"revision":5,"estado":"CONCLUIDO","motivo":"Cierre por Secretaría","referencia_autorizacion":"APR-01"}');
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Secretaría concluyó: %',r; END IF;
  PERFORM set_config('kvg_test.claims',colaborador,true);
  r:=public.kvg_operar('expediente.cambiar_estado',arguments||'{"revision":5,"estado":"CONCLUIDO","motivo":"Cierre por colaborador","referencia_autorizacion":"APR-01"}');
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Colaborador concluyó: %',r; END IF;

  PERFORM set_config('kvg_test.claims',abogado,true);
  r:=public.kvg_operar('expediente.cambiar_estado',arguments||'{"revision":5,"estado":"CONCLUIDO","motivo":"Cierre sin referencia"}');
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Concluyó sin referencia: %',r; END IF;
  PERFORM set_config('kvg_test.claims',secretaria,true);
  r:=public.kvg_operar('documento.cargar',arguments||jsonb_build_object('categoria_id',category_id,'nombre','Documento ficticio',
    'nombre_original','documento.pdf','clave_idempotencia',gen_random_uuid(),'motivo','Referencia ficticia'));
  upload_id:=(r#>>'{datos,carga_id}')::uuid;
  IF upload_id IS NULL THEN RAISE EXCEPTION 'Carga ficticia: %',r; END IF;
  RESET ROLE;
  INSERT INTO storage.objects(bucket_id,name) VALUES('kvg-cuarentena','cargas/'||upload_id||'/original'),
    ('kvg-originales','versiones/'||upload_id||'/original');
  SET LOCAL ROLE service_role;
  PERFORM set_config('kvg_test.claims','{"role":"service_role"}',true);
  PERFORM public.kvg_trabajar('carga.recibir',jsonb_build_object('carga_id',upload_id,'tamano_bytes',10));
  task:=public.kvg_trabajar('trabajo.tomar_carga_beta');
  lease:=jsonb_build_object('trabajo_id',task->>'trabajo_id','token',task->>'ejecutor_codigo');
  r:=public.kvg_trabajar('carga.publicar_beta',lease||jsonb_build_object('tamano_bytes',10,
    'sha256',repeat('a',64),'formato','PDF','mime_verificado','application/pdf'));
  version_id:=(r->>'version_id')::uuid;
  IF version_id IS NULL THEN RAISE EXCEPTION 'Versión ficticia: %',r; END IF;
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',abogado,true);
  r:=public.kvg_operar('expediente.referencias_avance',arguments||'{"texto":"ficticio"}');
  IF r#>>'{datos,0,version_id}' IS DISTINCT FROM version_id::text THEN RAISE EXCEPTION 'Referencia no listada: %',r; END IF;
  progress_args:=arguments||jsonb_build_object('solicitud_id',progress_request,'descripcion','Avance original',
    'versiones',jsonb_build_array(jsonb_build_object('version_id',version_id)));
  r:=public.kvg_operar('expediente.avanzar',progress_args||jsonb_build_object('expediente_id',other_case));
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Referencia cruzada admitida: %',r; END IF;
  r:=public.kvg_operar('expediente.avanzar',progress_args);
  progress_id:=(r#>>'{datos,avance_id}')::uuid;
  IF progress_id IS NULL THEN RAISE EXCEPTION 'Avance faltante: %',r; END IF;
  r:=public.kvg_operar('expediente.avanzar',progress_args);
  IF r#>>'{datos,avance_id}' IS DISTINCT FROM progress_id::text THEN RAISE EXCEPTION 'Se duplicó el avance: %',r; END IF;
  r:=public.kvg_operar('expediente.avanzar',progress_args||'{"descripcion":"Contenido distinto"}');
  IF r->>'codigo' IS DISTINCT FROM '23505' THEN RAISE EXCEPTION 'Se reutilizó la solicitud: %',r; END IF;
  r:=public.kvg_operar('expediente.avanzar',jsonb_build_object('expediente_id',other_case,'descripcion','Corrección cruzada',
    'corrige_avance_id',progress_id));
  IF r->>'codigo' IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'Corrección cruzada admitida: %',r; END IF;
  r:=public.kvg_operar('expediente.avanzar',arguments||jsonb_build_object('descripcion','Rectificación','corrige_avance_id',progress_id));
  IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Corrección no guardada: %',r; END IF;
  r:=public.kvg_operar('expediente.consultar',arguments);
  IF jsonb_array_length(r#>'{datos,avances}') IS DISTINCT FROM 2 OR
    r#>>'{datos,avances,0,corrige_avance_id}' IS DISTINCT FROM progress_id::text OR
    r#>>'{datos,avances,1,referencias,0,version_id}' IS DISTINCT FROM version_id::text OR
    r#>>'{datos,revision}' IS DISTINCT FROM '5' OR r#>>'{datos,estado_expediente_codigo}' IS DISTINCT FROM 'PENDIENTE'
    OR r#>>'{datos,avances,0,nombre_autor}' IS NULL THEN
    RAISE EXCEPTION 'Avances, autor o estado inconsistentes: %',r;
  END IF;
  r:=public.kvg_operar('expediente.cambiar_estado',arguments||'{"revision":5,"estado":"CONCLUIDO","motivo":"Cierre ficticio","referencia_autorizacion":"APR-01"}');
  IF r#>>'{datos,revision}' IS DISTINCT FROM '6' THEN RAISE EXCEPTION 'Cierre fallido: %',r; END IF;
  PERFORM set_config('kvg_test.claims',secretaria,true);
  r:=public.kvg_operar('expediente.cambiar_estado',arguments||'{"revision":6,"estado":"ARCHIVADO","motivo":"Archivo ficticio"}');
  IF r#>>'{datos,revision}' IS DISTINCT FROM '7' THEN RAISE EXCEPTION 'Archivo fallido: %',r; END IF;
  r:=public.kvg_operar('expediente.cambiar_estado',arguments||'{"revision":7,"estado":"EN_PROCESO","motivo":"Secretaría reabre","referencia_autorizacion":"APR-02"}');
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Reapertura indebida: %',r; END IF;
  PERFORM set_config('kvg_test.claims',abogado,true);
  r:=public.kvg_operar('expediente.avanzar',arguments||'{"descripcion":"Avance después del archivo"}');
  IF r->>'codigo' IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'Avance sobre archivo: %',r; END IF;
  r:=public.kvg_operar('expediente.cambiar_estado',arguments||'{"revision":7,"estado":"EN_PROCESO","motivo":"Reapertura ficticia","referencia_autorizacion":"APR-02"}');
  IF r#>>'{datos,revision}' IS DISTINCT FROM '8' THEN RAISE EXCEPTION 'Reapertura fallida: %',r; END IF;
  RESET ROLE;
  IF (SELECT count(*) FROM kvg.historial_estado_expediente h WHERE h.expediente_id=case_id
      AND h.decidido_por=lawyer_id AND h.referencia_autorizacion IN ('APR-01','APR-02'))<>2
    OR (SELECT count(*) FROM kvg.evento_auditoria a JOIN kvg.avance_expediente p ON p.avance_id=a.recurso_id
        WHERE p.expediente_id=case_id AND a.accion='avance_expediente.insert' AND a.usuario_id=lawyer_id)<>2 THEN
    RAISE EXCEPTION 'Falta evidencia de decisión o auditoría de los dos avances';
  END IF;
  RAISE NOTICE '4D: matriz, alcance, historial, revisión, decisión, avances idempotentes y referencias confirmados';
END;
$test$;
ROLLBACK;
