-- CU014/CU029. Ejecutar solo en PostgreSQL efímero con el fixture de plataforma.
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
  'Administración ficticia','Abogacía ficticia','Prueba local de versiones');
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
  primera uuid; ganadora uuid; perdedora uuid; carga_rechazada uuid; carga_revocada uuid; rev integer; r jsonb; datos jsonb;
  lease jsonb; job jsonb; dato_publicacion jsonb; a uuid; jurista uuid; revision_juridica uuid;
  hash1 text:=repeat('a',64); hash2 text:=repeat('b',64); rol text;
BEGIN
  FOREACH rol IN ARRAY ARRAY['anon','authenticated','service_role','kvg_session_store'] LOOP
    IF has_function_privilege(rol,'kvg_privado.versiones_documento(jsonb)','EXECUTE')
      OR has_function_privilege(rol,'kvg_privado.actualizar_nombre_documento(jsonb)','EXECUTE')
      OR has_table_privilege(rol,'kvg.historial_nombre_documento','SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'Historial o helper privado expuesto a %',rol;
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
  r:=public.kvg_trabajar('carga.publicar_beta',lease||dato_publicacion||jsonb_build_object('sha256',hash1));
  v1:=(r->>'version_id')::uuid;
  IF v1 IS NULL THEN RAISE EXCEPTION 'Publicación inicial: %',r; END IF;
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',secretario,true);
  r:=public.kvg_operar('documento.consultar',jsonb_build_object('documento_id',doc));
  rev:=(r#>>'{datos,revision}')::integer;
  IF r#>>'{datos,puede_editar_nombre}' IS DISTINCT FROM 'true'
    OR r#>>'{datos,puede_subir_version}' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Acciones de ficha: %',r; END IF;
  datos:=jsonb_build_object('documento_id',doc,'revision',rev,'nombre','Nombre ficticio corregido','motivo','Corregir el título');
  r:=public.kvg_operar('documento.actualizar',datos||'{"categoria_id":null}');
  IF r->>'codigo' IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'Aceptó campos protegidos: %',r; END IF;
  r:=public.kvg_operar('documento.actualizar',datos);
  IF r#>>'{datos,revision}' IS DISTINCT FROM (rev+1)::text THEN RAISE EXCEPTION 'Edición: %',r; END IF;
  r:=public.kvg_operar('documento.actualizar',datos);
  IF r->>'codigo' IS DISTINCT FROM '40001' THEN RAISE EXCEPTION 'Aceptó revisión obsoleta: %',r; END IF;
  r:=public.kvg_operar('documento.versiones',jsonb_build_object('documento_id',doc));
  IF jsonb_array_length(r->'datos') IS DISTINCT FROM 1 OR r#>'{datos,0}' ?| ARRAY['sha256','huella_sha256']
    OR r#>>'{datos,0,vigente}' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Renombrar alteró la versión: %',r; END IF;
  rev:=rev+1;
  PERFORM set_config('kvg_test.claims',abogado,true);
  r:=public.kvg_operar('documento.versiones',jsonb_build_object('documento_id',doc));
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'El historial cruzó el alcance: %',r; END IF;
  PERFORM set_config('kvg_test.claims',secretario,true);
  r:=public.kvg_operar('expediente.asignar',jsonb_build_object('expediente_id',caso,'revision',1,'abogado_id',jurista,
    'funcion','PRINCIPAL','motivo','Validar el original ficticio'));
  IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Asignación del jurista: %',r; END IF;
  PERFORM set_config('kvg_test.claims',abogado,true);
  r:=public.kvg_operar('documento.cambiar_estado',jsonb_build_object('documento_id',doc,'version_id',v1,'revision',1,
    'estado','EN_REVISION','motivo','Iniciar revisión del original ficticio'));
  IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Iniciar revisión del original: %',r; END IF;
  r:=public.kvg_operar('documento.revisar',jsonb_build_object('documento_id',doc,'version_id',v1,
    'observaciones','Revisión ficticia de la primera versión','resultado','APTO_PARA_VALIDAR'));
  revision_juridica:=(r#>>'{datos,revision_juridica_id}')::uuid;
  IF revision_juridica IS NULL THEN RAISE EXCEPTION 'Revisión del original: %',r; END IF;
  r:=public.kvg_operar('documento.cambiar_estado',jsonb_build_object('documento_id',doc,'version_id',v1,'revision',2,
    'estado','VALIDADO','motivo','Validación ficticia','revision_juridica_id',revision_juridica));
  IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Validación del original: %',r; END IF;
  PERFORM set_config('kvg_test.claims',secretario,true);
  datos:=jsonb_build_object('documento_id',doc,'revision',rev,'nombre_original','nueva.pdf',
    'clave_idempotencia',gen_random_uuid(),'motivo','Segunda entrega');
  r:=public.kvg_operar('documento.cargar',datos||jsonb_build_object('revision',rev-1));
  IF r->>'codigo' IS DISTINCT FROM '40001' THEN RAISE EXCEPTION 'Reservó con revisión obsoleta: %',r; END IF;
  r:=public.kvg_operar('documento.cargar',datos);
  ganadora:=(r#>>'{datos,carga_id}')::uuid;
  r:=public.kvg_operar('documento.cargar',datos);
  IF r#>>'{datos,carga_id}' IS DISTINCT FROM ganadora::text THEN RAISE EXCEPTION 'Duplicó reserva: %',r; END IF;
  r:=public.kvg_operar('documento.cargar',datos||'{"motivo":"Otro motivo"}');
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Cambió una reserva idempotente: %',r; END IF;
  r:=public.kvg_operar('documento.cargar',datos||jsonb_build_object('clave_idempotencia',gen_random_uuid()));
  perdedora:=(r#>>'{datos,carga_id}')::uuid;
  r:=public.kvg_operar('documento.cargar',datos||jsonb_build_object('clave_idempotencia',gen_random_uuid()));
  carga_rechazada:=(r#>>'{datos,carga_id}')::uuid;
  r:=public.kvg_operar('documento.versiones',jsonb_build_object('documento_id',doc));
  IF jsonb_array_length(r->'datos') IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Historial mostró cargas todavía sin publicar: %',r; END IF;
  RESET ROLE;

  FOREACH a IN ARRAY ARRAY[carga_rechazada,ganadora,perdedora] LOOP
    INSERT INTO storage.objects(bucket_id,name) VALUES ('kvg-cuarentena','cargas/'||a||'/original');
    IF a<>carga_rechazada THEN
      INSERT INTO storage.objects(bucket_id,name) VALUES ('kvg-originales','versiones/'||a||'/original');
    END IF;
    SET LOCAL ROLE service_role;
    PERFORM set_config('kvg_test.claims','{"role":"service_role"}',true);
    PERFORM public.kvg_trabajar('carga.recibir',jsonb_build_object('carga_id',a,'tamano_bytes',10));
    job:=public.kvg_trabajar('trabajo.tomar_carga_beta');
    IF job->>'objetivo_id' IS DISTINCT FROM a::text THEN RAISE EXCEPTION 'Trabajo distinto: %',job; END IF;
    lease:=jsonb_build_object('trabajo_id',job->>'trabajo_id','token',job->>'ejecutor_codigo');
    IF a=carga_rechazada THEN
      PERFORM public.kvg_trabajar('carga.rechazar',lease||'{"motor_version":"Motor ficticio de prueba"}');
      RESET ROLE;
      IF (SELECT version_vigente_id FROM kvg.documento WHERE documento_id=doc) IS DISTINCT FROM v1 THEN
        RAISE EXCEPTION 'La carga rechazada cambió la vigente.';
      END IF;
    ELSE
      r:=public.kvg_trabajar('carga.publicar_beta',lease||dato_publicacion||jsonb_build_object('sha256',hash2));
      IF a=ganadora THEN
        v2:=(r->>'version_id')::uuid;
        IF v2 IS NULL THEN RAISE EXCEPTION 'Publicación de v2: %',r; END IF;
      ELSIF r->>'resultado' IS DISTINCT FROM 'CONFLICTO_REVISION' OR r->>'estado' IS DISTINCT FROM 'CANCELADO' THEN
        RAISE EXCEPTION 'No decidió la concurrencia: %',r;
      END IF;
    END IF;
    RESET ROLE;
  END LOOP;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',secretario,true);
  r:=public.kvg_operar('documento.carga',jsonb_build_object('carga_id',perdedora));
  IF r#>>'{datos,estado}' IS DISTINCT FROM 'ABANDONADO'
    OR r#>>'{datos,resultado}' IS DISTINCT FROM 'CONFLICTO_REVISION' THEN RAISE EXCEPTION 'Conflicto oculto: %',r; END IF;
  r:=public.kvg_operar('documento.carga',jsonb_build_object('carga_id',carga_rechazada));
  IF r#>>'{datos,estado}' IS DISTINCT FROM 'RECHAZADO' THEN RAISE EXCEPTION 'No registró el rechazo: %',r; END IF;
  r:=public.kvg_operar('documento.versiones',jsonb_build_object('documento_id',doc));
  IF jsonb_array_length(r->'datos') IS DISTINCT FROM 2
    OR r#>>'{datos,0,version_id}' IS DISTINCT FROM v2::text OR r#>>'{datos,0,vigente}' IS DISTINCT FROM 'true'
    OR r#>>'{datos,0,estado_documento_codigo}' IS DISTINCT FROM 'RECIBIDO'
    OR r#>>'{datos,0,motivo}' IS DISTINCT FROM 'Segunda entrega' OR r#>>'{datos,0,autor}' IS DISTINCT FROM 'Secretaría ficticia'
    OR r#>'{datos,0,revisiones}' IS DISTINCT FROM '[]'::jsonb
    OR r#>>'{datos,1,version_id}' IS DISTINCT FROM v1::text OR r#>>'{datos,1,vigente}' IS DISTINCT FROM 'false'
    OR r#>>'{datos,1,estado_documento_codigo}' IS DISTINCT FROM 'VALIDADO'
    OR r#>>'{datos,1,revisiones,0,id}' IS DISTINCT FROM revision_juridica::text
    OR r#>'{datos,1}' ?| ARRAY['sha256','huella_sha256'] OR (r->'datos')::text LIKE '%localizador%' THEN
    RAISE EXCEPTION 'Historial incorrecto: %',r;
  END IF;
  PERFORM set_config('kvg_test.claims',abogado,true);
  r:=public.kvg_operar('documento.versiones',jsonb_build_object('documento_id',doc));
  IF r#>>'{datos,0,huella_sha256}' IS DISTINCT FROM hash2
    OR r#>>'{datos,1,huella_sha256}' IS DISTINCT FROM hash1 THEN
    RAISE EXCEPTION 'La revisión jurídica perdió el acceso al dato de integridad: %',r;
  END IF;
  PERFORM set_config('kvg_test.claims',secretario,true);
  r:=public.kvg_operar('documento.descargar',jsonb_build_object('version_id',v1));
  IF r#>>'{datos,sha256}' IS DISTINCT FROM hash1 THEN RAISE EXCEPTION 'Original anterior inaccesible: %',r; END IF;
  r:=public.kvg_operar('documento.cargar',datos||jsonb_build_object('revision',rev+1,'clave_idempotencia',gen_random_uuid()));
  carga_revocada:=(r#>>'{datos,carga_id}')::uuid;
  IF carga_revocada IS NULL THEN RAISE EXCEPTION 'Preparación de revocación: %',r; END IF;
  RESET ROLE;

  INSERT INTO storage.objects(bucket_id,name) VALUES ('kvg-cuarentena','cargas/'||carga_revocada||'/original'),
    ('kvg-originales','versiones/'||carga_revocada||'/original');
  SET LOCAL ROLE service_role;
  PERFORM set_config('kvg_test.claims','{"role":"service_role"}',true);
  PERFORM public.kvg_trabajar('carga.recibir',jsonb_build_object('carga_id',carga_revocada,'tamano_bytes',10));
  job:=public.kvg_trabajar('trabajo.tomar_carga_beta');
  IF job->>'objetivo_id' IS DISTINCT FROM carga_revocada::text THEN RAISE EXCEPTION 'Trabajo de revocación distinto.'; END IF;
  lease:=jsonb_build_object('trabajo_id',job->>'trabajo_id','token',job->>'ejecutor_codigo');
  RESET ROLE;
  UPDATE kvg.rol_permiso rp SET activo=false FROM kvg.rol ro,kvg.permiso p
  WHERE rp.rol_id=ro.rol_id AND rp.permiso_id=p.permiso_id AND ro.codigo='SECRETARIA' AND p.codigo='documento.actualizar';
  SET LOCAL ROLE service_role;
  r:=public.kvg_trabajar('carga.publicar_beta',lease||dato_publicacion||jsonb_build_object('sha256',hash2));
  IF r->>'estado' IS DISTINCT FROM 'CANCELADO' OR r->>'resultado' IS DISTINCT FROM 'PUBLICACION_NO_AUTORIZADA' THEN
    RAISE EXCEPTION 'La revocación de edición no impidió la publicación: %',r;
  END IF;
  RESET ROLE;
  UPDATE kvg.rol_permiso rp SET activo=false FROM kvg.rol ro,kvg.permiso p
  WHERE rp.rol_id=ro.rol_id AND rp.permiso_id=p.permiso_id AND ro.codigo='SECRETARIA' AND p.codigo='documento.descargar';
  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',secretario,true);
  r:=public.kvg_operar('documento.versiones',jsonb_build_object('documento_id',doc,'limite',1,'desplazamiento',1));
  IF r#>>'{datos,0,version_id}' IS DISTINCT FROM v1::text OR r#>>'{datos,0,puede_descargar}' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Historial sin descarga o paginación incorrectos: %',r;
  END IF;
  r:=public.kvg_operar('documento.descargar',jsonb_build_object('version_id',v1));
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'El historial concedió la descarga: %',r; END IF;
  RESET ROLE;
  IF (SELECT count(DISTINCT localizador_objeto) FROM kvg.version_documento WHERE documento_id=doc)<>2
    OR NOT EXISTS (SELECT 1 FROM kvg.historial_nombre_documento WHERE documento_id=doc AND motivo='Corregir el título')
    OR NOT EXISTS (SELECT 1 FROM kvg.evento_auditoria WHERE recurso_id=doc AND accion='DOCUMENTO_METADATOS_ACTUALIZADOS') THEN
    RAISE EXCEPTION 'Falta la trazabilidad del cambio o del original.';
  END IF;
  RAISE NOTICE '5B: permisos, metadatos, cargas idempotentes, conflicto, rechazo, revocación e historial de dos originales';
END;
$test$;
ROLLBACK;
