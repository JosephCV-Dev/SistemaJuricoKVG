-- CU016/CU026. Ejecutar solo en PostgreSQL efímero con el fixture de plataforma.
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
SELECT ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       'local-'||n||'@example.test',clock_timestamp() FROM generate_series(1,3) n;
SELECT public.kvg_inicializar(
  '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
  'Administración ficticia','Abogacía ficticia','Prueba local de revisión jurídica');
INSERT INTO kvg.usuario (auth_usuario_id,nombre,correo_operativo,estado_cuenta,creado_por)
SELECT a.id,'Secretaría ficticia',a.email,'ACTIVO',u.usuario_id FROM auth.users a
JOIN kvg.usuario u ON u.correo_operativo='local-1@example.test' WHERE a.email='local-3@example.test';
INSERT INTO kvg.usuario_rol (usuario_id,rol_id,otorgado_por,motivo_alta)
SELECT u.usuario_id,r.rol_id,u.creado_por,'Prueba local' FROM kvg.usuario u
CROSS JOIN kvg.rol r WHERE r.codigo='SECRETARIA' AND u.correo_operativo='local-3@example.test';
INSERT INTO auth.sessions(id,user_id)
SELECT ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM (VALUES (2),(3)) t(n);
INSERT INTO kvg_servidor.beta_documentos VALUES(true);

DO $test$
DECLARE secretario text; abogado text; caso uuid; cliente uuid; categoria uuid; doc uuid; v1 uuid; v2 uuid;
  primera uuid; carga_nueva uuid; r jsonb; path1 jsonb; path2 jsonb; datos jsonb;
  lease jsonb; job jsonb; dato_publicacion jsonb; jurista uuid; anterior uuid; apta uuid; clave_permiso uuid;
  rol text;
BEGIN
  FOREACH rol IN ARRAY ARRAY['anon','authenticated','service_role','kvg_session_store'] LOOP
    IF has_function_privilege(rol,'kvg_privado.consultar_revision_documento(jsonb)','EXECUTE')
      OR has_function_privilege(rol,'kvg_privado.mutar_revision_documento(text,jsonb)','EXECUTE')
      OR has_table_privilege(rol,'kvg.revision_documento','SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'Revisión jurídica expuesta por acceso directo a %',rol;
    END IF;
  END LOOP;
  secretario:=jsonb_build_object('sub','10000000-0000-4000-8000-000000000003',
    'session_id','20000000-0000-4000-8000-000000000003','aal','aal2','role','authenticated')::text;
  abogado:=jsonb_build_object('sub','10000000-0000-4000-8000-000000000002',
    'session_id','20000000-0000-4000-8000-000000000002','aal','aal2','role','authenticated')::text;
  SELECT categoria_id INTO categoria FROM kvg.categoria_documento WHERE activo ORDER BY categoria_id LIMIT 1;
  SELECT usuario_id INTO jurista FROM kvg.usuario WHERE correo_operativo='local-2@example.test';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',abogado,true);
  r:=public.kvg_operar('sesion.iniciar');
  IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Sesión de abogado: %',r; END IF;
  PERFORM set_config('kvg_test.claims',secretario,true);
  r:=public.kvg_operar('sesion.iniciar');
  IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Sesión de secretaría: %',r; END IF;
  r:=public.kvg_operar('cliente.registrar','{"nombre":"Cliente ficticio de versiones"}');
  cliente:=(r#>>'{datos,cliente_id}')::uuid;
  r:=public.kvg_operar('expediente.crear',jsonb_build_object('cliente_id',cliente,'descripcion','Prueba ficticia de versiones'));
  caso:=(r#>>'{datos,expediente_id}')::uuid;
  r:=public.kvg_operar('documento.cargar',jsonb_build_object('expediente_id',caso,'categoria_id',categoria,
    'nombre','Documento ficticio','nombre_original','inicial.pdf','clave_idempotencia',gen_random_uuid(),'motivo','Registro inicial'));
  primera:=(r#>>'{datos,carga_id}')::uuid;
  doc:=(r#>>'{datos,documento_id}')::uuid;
  IF doc IS NULL THEN RAISE EXCEPTION 'Carga inicial: %',r; END IF;
  RESET ROLE;

  INSERT INTO storage.objects(bucket_id,name) VALUES ('kvg-cuarentena','cargas/'||primera||'/original'),
    ('kvg-originales','versiones/'||primera||'/original');
  SET LOCAL ROLE service_role;
  PERFORM set_config('kvg_test.claims','{"role":"service_role"}',true);
  PERFORM public.kvg_trabajar('carga.recibir',jsonb_build_object('carga_id',primera,'tamano_bytes',10));
  job:=public.kvg_trabajar('trabajo.tomar_carga_beta');
  lease:=jsonb_build_object('trabajo_id',job->>'trabajo_id','token',job->>'ejecutor_codigo');
  dato_publicacion:=jsonb_build_object('tamano_bytes',10,'formato','PDF','mime_verificado','application/pdf');
  r:=public.kvg_trabajar('carga.publicar_beta',lease||dato_publicacion||jsonb_build_object('sha256',repeat('a',64)));
  v1:=(r->>'version_id')::uuid;
  IF v1 IS NULL THEN RAISE EXCEPTION 'Publicación inicial: %',r; END IF;
  RESET ROLE;

  path1:=jsonb_build_object('documento_id',doc,'version_id',v1);
  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',abogado,true);
  r:=public.kvg_operar('documento.revision',path1);
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Consulta de abogado ajeno: %',r; END IF;
  PERFORM set_config('kvg_test.claims',secretario,true);
  r:=public.kvg_operar('documento.revision',path1);
  IF r#>>'{datos,transiciones,0,destino}' IS DISTINCT FROM 'EN_REVISION'
    OR r#>>'{datos,puede_revisar}' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Opciones iniciales: %',r; END IF;
  r:=public.kvg_operar('documento.cambiar_estado',path1||'{"estado":"VALIDADO","revision":1,"motivo":"Salto inválido"}');
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Se permitió saltar a validado: %',r; END IF;
  r:=public.kvg_operar('documento.cambiar_estado',path1||'{"estado":"EN_REVISION","revision":1,"motivo":"Inicia el cotejo"}');
  IF r#>>'{datos,estado}' IS DISTINCT FROM 'EN_REVISION' THEN RAISE EXCEPTION 'Inicio de revisión de secretaría: %',r; END IF;
  r:=public.kvg_operar('documento.revisar',path1||'{"resultado":"APTO_PARA_VALIDAR","observaciones":"Intento de secretaría"}');
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Secretaría pudo revisar: %',r; END IF;
  r:=public.kvg_operar('documento.cambiar_estado',path1||'{"estado":"RECIBIDO","revision":2,"motivo":"Completar copia ficticia"}');
  IF r#>>'{datos,estado}' IS DISTINCT FROM 'RECIBIDO' THEN RAISE EXCEPTION 'No se pudo pedir corrección: %',r; END IF;
  r:=public.kvg_operar('documento.cambiar_estado',path1||'{"estado":"EN_REVISION","revision":3,"motivo":"Revisión retomada"}');
  IF r#>>'{datos,revision}' IS DISTINCT FROM '4' THEN RAISE EXCEPTION 'No se pudo retomar: %',r; END IF;

  r:=public.kvg_operar('expediente.asignar',jsonb_build_object('expediente_id',caso,'revision',1,'abogado_id',jurista,
    'funcion','PRINCIPAL','motivo','Revisión jurídica ficticia'));
  IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Asignación del jurista: %',r; END IF;
  PERFORM set_config('kvg_test.claims',abogado,true);
  datos:=path1||jsonb_build_object('resultado','APTO_PARA_VALIDAR','observaciones','Observación jurídica ficticia',
    'solicitud_id',gen_random_uuid());
  r:=public.kvg_operar('documento.revisar',datos);
  anterior:=(r#>>'{datos,revision_juridica_id}')::uuid;
  IF anterior IS NULL THEN RAISE EXCEPTION 'Revisión jurídica: %',r; END IF;
  r:=public.kvg_operar('documento.revisar',datos);
  IF r#>>'{datos,revision_juridica_id}' IS DISTINCT FROM anterior::text THEN RAISE EXCEPTION 'Duplicó la revisión: %',r; END IF;
  r:=public.kvg_operar('documento.revisar',datos||'{"observaciones":"Contenido cambiado"}');
  IF r->>'codigo' IS DISTINCT FROM '23505' THEN RAISE EXCEPTION 'La solicitud aceptó otro contenido: %',r; END IF;
  r:=public.kvg_operar('documento.revisar',path1||jsonb_build_object('resultado','APTO_PARA_VALIDAR',
    'observaciones','Ampliación jurídica ficticia','corrige_revision_id',anterior));
  apta:=(r#>>'{datos,revision_juridica_id}')::uuid;
  IF apta IS NULL THEN RAISE EXCEPTION 'Corrección jurídica: %',r; END IF;
  r:=public.kvg_operar('documento.revision',path1);
  IF r#>>'{datos,estado}' IS DISTINCT FROM 'EN_REVISION'
    OR r#>>'{datos,eventos,0,corrige_id}' IS DISTINCT FROM anterior::text
    OR r#>>'{datos,eventos,1,corregida}' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Historia jurídica no conservada o validación automática: %',r;
  END IF;

  PERFORM set_config('kvg_test.claims',secretario,true);
  r:=public.kvg_operar('documento.consultar',jsonb_build_object('documento_id',doc));
  IF r#>'{datos,revisiones}' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'La ficha reveló observaciones jurídicas.'; END IF;
  r:=public.kvg_operar('documento.revision',path1);
  IF (r->'datos')::text LIKE '%Observación jurídica ficticia%' OR (r->'datos')::text LIKE '%Ampliación jurídica ficticia%'
    OR (r->'datos')::text LIKE '%"destino": "VALIDADO"%' THEN RAISE EXCEPTION 'Reveló datos jurídicos a secretaría.'; END IF;
  r:=public.kvg_operar('documento.cambiar_estado',path1||jsonb_build_object('estado','VALIDADO','revision',4,'motivo','Sin facultad','revision_juridica_id',apta));
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Secretaría pudo validar: %',r; END IF;

  RESET ROLE;
  SELECT permiso_id INTO clave_permiso FROM kvg.permiso WHERE codigo='documento.validar';
  UPDATE kvg.rol_permiso rp SET activo=false FROM kvg.rol ro
    WHERE ro.rol_id=rp.rol_id AND ro.codigo='ABOGADO' AND rp.contexto='PRINCIPAL' AND rp.permiso_id=clave_permiso;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',abogado,true);
  datos:=path1||jsonb_build_object('estado','VALIDADO','revision',4,'motivo','Decisión jurídica ficticia','revision_juridica_id',apta);
  r:=public.kvg_operar('documento.cambiar_estado',datos);
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Validó tras revocación: %',r; END IF;
  RESET ROLE;
  UPDATE kvg.rol_permiso rp SET activo=true FROM kvg.rol ro
    WHERE ro.rol_id=rp.rol_id AND ro.codigo='ABOGADO' AND rp.contexto='PRINCIPAL' AND rp.permiso_id=clave_permiso;
  SET LOCAL ROLE authenticated;
  r:=public.kvg_operar('documento.cambiar_estado',datos-'revision_juridica_id');
  IF r->>'codigo' IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'Validó sin evidencia: %',r; END IF;
  r:=public.kvg_operar('documento.cambiar_estado',datos||jsonb_build_object('revision_juridica_id',anterior));
  IF r->>'codigo' IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'Validó con evidencia corregida: %',r; END IF;
  r:=public.kvg_operar('documento.cambiar_estado',datos||'{"revision":3}');
  IF r->>'codigo' IS DISTINCT FROM '40001' THEN RAISE EXCEPTION 'Validó con revisión obsoleta: %',r; END IF;
  r:=public.kvg_operar('documento.cambiar_estado',datos);
  IF r#>>'{datos,estado}' IS DISTINCT FROM 'VALIDADO' THEN RAISE EXCEPTION 'Validación autorizada: %',r; END IF;
  r:=public.kvg_operar('documento.cambiar_estado',path1||'{"estado":"ARCHIVADO","revision":5,"motivo":"Archivo ficticio"}');
  IF r#>>'{datos,estado}' IS DISTINCT FROM 'ARCHIVADO' THEN RAISE EXCEPTION 'Archivo: %',r; END IF;
  r:=public.kvg_operar('documento.cambiar_estado',path1||'{"estado":"VALIDADO","revision":6,"motivo":"Reactivación ficticia"}');
  IF r#>>'{datos,estado}' IS DISTINCT FROM 'VALIDADO' THEN RAISE EXCEPTION 'Reactivación: %',r; END IF;
  r:=public.kvg_operar('documento.revision',path1||'{"limite":1}');
  IF r#>>'{datos,eventos,0,revision_juridica_id}' IS DISTINCT FROM apta::text
    OR jsonb_array_length(r#>'{datos,eventos}') IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Sin evidencia al reactivar o sin paginar: %',r; END IF;

  PERFORM set_config('kvg_test.claims',secretario,true);
  r:=public.kvg_operar('documento.cargar',jsonb_build_object('documento_id',doc,'revision',2,'nombre_original','nueva.pdf',
    'clave_idempotencia',gen_random_uuid(),'motivo','Nueva versión ficticia'));
  carga_nueva:=(r#>>'{datos,carga_id}')::uuid;
  IF carga_nueva IS NULL THEN RAISE EXCEPTION 'Reserva de segunda versión: %',r; END IF;
  RESET ROLE;
  INSERT INTO storage.objects(bucket_id,name) VALUES ('kvg-cuarentena','cargas/'||carga_nueva||'/original'),
    ('kvg-originales','versiones/'||carga_nueva||'/original');
  SET LOCAL ROLE service_role;
  PERFORM set_config('kvg_test.claims','{"role":"service_role"}',true);
  PERFORM public.kvg_trabajar('carga.recibir',jsonb_build_object('carga_id',carga_nueva,'tamano_bytes',10));
  job:=public.kvg_trabajar('trabajo.tomar_carga_beta');
  lease:=jsonb_build_object('trabajo_id',job->>'trabajo_id','token',job->>'ejecutor_codigo');
  r:=public.kvg_trabajar('carga.publicar_beta',lease||dato_publicacion||jsonb_build_object('sha256',repeat('b',64)));
  v2:=(r->>'version_id')::uuid;
  IF v2 IS NULL THEN RAISE EXCEPTION 'Publicación de segunda versión: %',r; END IF;
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',abogado,true);
  r:=public.kvg_operar('documento.revisar',path1||'{"resultado":"OBSERVACIONES","observaciones":"Comentario de una versión anterior"}');
  IF r#>>'{datos,version_vigente_cambio}' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'No advirtió publicación concurrente: %',r; END IF;
  r:=public.kvg_operar('documento.cambiar_estado',path1||'{"estado":"ARCHIVADO","revision":7,"motivo":"Intento de estado anterior"}');
  IF r->>'codigo' IS DISTINCT FROM '40001' THEN RAISE EXCEPTION 'Cambió estado de versión anterior: %',r; END IF;
  path2:=jsonb_build_object('documento_id',doc,'version_id',v2);
  r:=public.kvg_operar('documento.revision',path2);
  IF r#>>'{datos,estado}' IS DISTINCT FROM 'RECIBIDO' THEN RAISE EXCEPTION 'La nueva versión heredó un estado: %',r; END IF;
  r:=public.kvg_operar('documento.cambiar_estado',path2||'{"estado":"EN_REVISION","revision":1,"motivo":"Inicia revisión de la vigente"}');
  IF r#>>'{datos,estado}' IS DISTINCT FROM 'EN_REVISION' THEN RAISE EXCEPTION 'No inició revisión de la vigente: %',r; END IF;
  r:=public.kvg_operar('documento.cambiar_estado',path2||jsonb_build_object('estado','VALIDADO','revision',2,
    'motivo','Intento con evidencia de la anterior','revision_juridica_id',apta));
  IF r->>'codigo' IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'Validó con evidencia de otra versión: %',r; END IF;
  r:=public.kvg_operar('documento.revisar',path2||jsonb_build_object('resultado','OBSERVACIONES',
    'observaciones','Intento de corregir revisión de otra versión','corrige_revision_id',apta));
  IF r->>'codigo' IS DISTINCT FROM '40001' THEN RAISE EXCEPTION 'Corrigió revisión de otra versión: %',r; END IF;
  RESET ROLE;

  IF (SELECT count(*) FROM kvg.revision_documento WHERE version_id=v1) IS DISTINCT FROM 3::bigint
    OR EXISTS (SELECT 1 FROM kvg.revision_documento WHERE version_id=v2)
    OR EXISTS (SELECT 1 FROM kvg.evento_auditoria WHERE detalle_controlado::text LIKE '%Ampliación jurídica ficticia%')
    OR NOT EXISTS (SELECT 1 FROM kvg.evento_auditoria WHERE recurso_id=v1 AND accion='DOCUMENTO_REVISION_CONSULTADA') THEN
    RAISE EXCEPTION 'Auditoría o asociación de revisiones inconsistente.';
  END IF;
  DELETE FROM kvg_servidor.beta_documentos;
  SET LOCAL ROLE authenticated;
  r:=public.kvg_operar('documento.revision',path2);
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Consultó una versión beta bloqueada: %',r; END IF;
  r:=public.kvg_operar('documento.revisar',path2||'{"resultado":"OBSERVACIONES","observaciones":"Archivo bloqueado"}');
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Revisó una versión beta bloqueada: %',r; END IF;
  r:=public.kvg_operar('documento.cambiar_estado',path2||'{"estado":"RECIBIDO","revision":2,"motivo":"Archivo bloqueado"}');
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Cambió estado de una versión beta bloqueada: %',r; END IF;
  RESET ROLE;
  RAISE NOTICE '5C: revisión exacta y privada, idempotencia y corrección, matriz, revocación, versión obsoleta y evidencia cruzada';
END;
$test$;
ROLLBACK;
