-- CU027/CU028. Ejecutar solo en PostgreSQL efímero con el fixture de plataforma.
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
  'Administración ficticia','Abogacía ficticia','Prueba local de recuperación');
INSERT INTO kvg.usuario (auth_usuario_id,nombre,correo_operativo,estado_cuenta,creado_por)
SELECT a.id,'Secretaría ficticia',a.email,'ACTIVO',u.usuario_id FROM auth.users a
JOIN kvg.usuario u ON u.correo_operativo='local-1@example.test' WHERE a.email='local-3@example.test';
INSERT INTO kvg.usuario_rol (usuario_id,rol_id,otorgado_por,motivo_alta)
SELECT u.usuario_id,r.rol_id,u.creado_por,'Prueba local' FROM kvg.usuario u
CROSS JOIN kvg.rol r WHERE r.codigo='SECRETARIA' AND u.correo_operativo='local-3@example.test';
INSERT INTO auth.sessions(id,user_id)
SELECT ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM (VALUES (1),(2),(3)) t(n);
INSERT INTO kvg_servidor.beta_documentos VALUES(true);

DO $test$
DECLARE secretario text; abogado text; admin text; caso uuid; cliente uuid; categoria uuid; doc uuid; v1 uuid; v2 uuid;
  primera uuid; segunda uuid; r jsonb; datos jsonb; solicitud jsonb; lease jsonb; job jsonb; evidencia jsonb;
  dato_publicacion jsonb; autorizacion text; trabajo uuid; permiso uuid; op text; medida uuid; admin_id uuid;
BEGIN
  admin:=jsonb_build_object('sub','10000000-0000-4000-8000-000000000001',
    'session_id','20000000-0000-4000-8000-000000000001','aal','aal2','role','authenticated')::text;
  secretario:=jsonb_build_object('sub','10000000-0000-4000-8000-000000000003',
    'session_id','20000000-0000-4000-8000-000000000003','aal','aal2','role','authenticated')::text;
  abogado:=jsonb_build_object('sub','10000000-0000-4000-8000-000000000002',
    'session_id','20000000-0000-4000-8000-000000000002','aal','aal2','role','authenticated')::text;
  SELECT categoria_id INTO categoria FROM kvg.categoria_documento WHERE activo ORDER BY categoria_id LIMIT 1;
  SELECT usuario_id INTO admin_id FROM kvg.usuario WHERE correo_operativo='local-1@example.test';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',admin,true);
  r:=public.kvg_operar('sesion.iniciar');
  IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Sesión administrativa: %',r; END IF;
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

  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',secretario,true);
  r:=public.kvg_operar('documento.cargar',jsonb_build_object('documento_id',doc,'revision',2,'nombre_original','segunda.pdf',
    'motivo','Segunda versión ficticia','clave_idempotencia',gen_random_uuid()));
  segunda:=(r#>>'{datos,carga_id}')::uuid;
  IF segunda IS NULL THEN RAISE EXCEPTION 'Segunda reserva: %',r; END IF;
  RESET ROLE;
  INSERT INTO storage.objects(bucket_id,name) VALUES ('kvg-cuarentena','cargas/'||segunda||'/original'),
    ('kvg-originales','versiones/'||segunda||'/original');
  SET LOCAL ROLE service_role;
  PERFORM set_config('kvg_test.claims','{"role":"service_role"}',true);
  PERFORM public.kvg_trabajar('carga.recibir',jsonb_build_object('carga_id',segunda,'tamano_bytes',10));
  job:=public.kvg_trabajar('trabajo.tomar_carga_beta');
  lease:=jsonb_build_object('trabajo_id',job->>'trabajo_id','token',job->>'ejecutor_codigo');
  r:=public.kvg_trabajar('carga.publicar_beta',lease||dato_publicacion||jsonb_build_object('sha256',repeat('b',64)));
  v2:=(r->>'version_id')::uuid;
  IF v2 IS NULL THEN RAISE EXCEPTION 'Segunda publicación: %',r; END IF;
  RESET ROLE;
  datos:=jsonb_build_object('documento_id',doc,'revision',3,'motivo','Retiro ficticio');
  INSERT INTO kvg.medida_conservacion (documento_id,tipo,motivo,autorizado_por,referencia_decision)
    VALUES (doc,'IMPEDIR_RETIRO','Restricción ficticia',admin_id,'Decisión ficticia') RETURNING medida_id INTO medida;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',secretario,true);
  r:=public.kvg_operar('documento.retirar',datos);
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Incumplió conservación en retiro: %',r; END IF;
  RESET ROLE;
  UPDATE kvg.medida_conservacion SET finaliza_en=clock_timestamp(),levantado_por=admin_id WHERE medida_id=medida;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',admin,true);
  r:=public.kvg_operar('documento.retirar',datos);
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'El administrador pudo retirar: %',r; END IF;
  PERFORM set_config('kvg_test.claims',secretario,true);
  r:=public.kvg_operar('documento.consultar',jsonb_build_object('documento_id',doc));
  IF r#>>'{datos,puede_retirar}' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Falta acción de retiro: %',r; END IF;
  r:=public.kvg_operar('documento.descargar',jsonb_build_object('version_id',v1));
  autorizacion:=r#>>'{datos,autorizacion_id}';
  IF autorizacion IS NULL THEN RAISE EXCEPTION 'Falta autorización inicial de descarga.'; END IF;
  r:=public.kvg_operar('documento.retirar',datos||'{"revision":2}');
  IF r->>'codigo' IS DISTINCT FROM '40001' THEN RAISE EXCEPTION 'Aceptó revisión obsoleta: %',r; END IF;
  r:=public.kvg_operar('documento.retirar',datos);
  IF r#>>'{datos,revision}' IS DISTINCT FROM '4' THEN RAISE EXCEPTION 'No retiró el documento: %',r; END IF;
  FOREACH op IN ARRAY ARRAY['documento.consultar','documento.versiones','documento.estado_recuperacion','documento.retirados'] LOOP
    r:=public.kvg_operar(op,CASE WHEN op IN ('documento.consultar','documento.versiones')
      THEN jsonb_build_object('documento_id',doc) ELSE '{}'::jsonb END);
    IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'El retiro dejó acceso a %: %',op,r; END IF;
  END LOOP;
  r:=public.kvg_operar('documento.buscar',jsonb_build_object('expediente_id',caso));
  IF r->'datos' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'Se mostró documento retirado: %',r; END IF;
  r:=public.kvg_operar('documento.descargar',jsonb_build_object('version_id',v2));
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Descargó documento retirado: %',r; END IF;

  PERFORM set_config('kvg_test.claims',admin,true);
  r:=public.kvg_operar('documento.retirados',jsonb_build_object('texto',doc));
  IF r#>>'{datos,0,documento_id}' IS DISTINCT FROM doc::text OR r#>>'{datos,0,puede_recuperar}' IS DISTINCT FROM 'true'
    OR r#>'{datos,0}' ?| ARRAY['nombre','motivo','sha256','originales','localizador'] THEN
    RAISE EXCEPTION 'Listado administrativo incorrecto: %',r;
  END IF;
  solicitud:=datos||jsonb_build_object('revision',4,'motivo','Recuperación ficticia','clave_idempotencia',gen_random_uuid());
  RESET ROLE;
  INSERT INTO kvg.medida_conservacion (documento_id,tipo,motivo,autorizado_por,referencia_decision)
    VALUES (doc,'IMPEDIR_RECUPERACION','Restricción ficticia',admin_id,'Decisión ficticia') RETURNING medida_id INTO medida;
  SET LOCAL ROLE authenticated;
  r:=public.kvg_operar('documento.recuperar',solicitud);
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Incumplió conservación en recuperación: %',r; END IF;
  RESET ROLE;
  UPDATE kvg.medida_conservacion SET finaliza_en=clock_timestamp(),levantado_por=admin_id WHERE medida_id=medida;
  SET LOCAL ROLE authenticated;
  r:=public.kvg_operar('documento.recuperar',solicitud);
  trabajo:=(r#>>'{datos,trabajo_id}')::uuid;
  IF trabajo IS NULL THEN RAISE EXCEPTION 'Realizar solicitud: %',r; END IF;
  r:=public.kvg_operar('documento.recuperar',solicitud);
  IF r#>>'{datos,trabajo_id}' IS DISTINCT FROM trabajo::text THEN RAISE EXCEPTION 'Duplicó el reintento: %',r; END IF;
  r:=public.kvg_operar('documento.recuperar',solicitud||jsonb_build_object('clave_idempotencia',gen_random_uuid()));
  IF r->>'codigo' IS DISTINCT FROM '23505' THEN RAISE EXCEPTION 'Duplicó trabajos activos: %',r; END IF;
  RESET ROLE;

  SET LOCAL ROLE service_role;
  PERFORM set_config('kvg_test.claims','{"role":"service_role"}',true);
  BEGIN
    PERFORM public.kvg_trabajar('entrega.autorizar',jsonb_build_object('autorizacion_id',autorizacion));
    RAISE EXCEPTION 'Autorización previa activa tras retiro.';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  job:=public.kvg_trabajar('trabajo.tomar_recuperacion');
  IF job->>'trabajo_id' IS DISTINCT FROM trabajo::text THEN RAISE EXCEPTION 'El trabajador no tomó la recuperación correcta.'; END IF;
  lease:=jsonb_build_object('trabajo_id',job->>'trabajo_id','token',job->>'ejecutor_codigo');
  r:=public.kvg_trabajar('trabajo.datos',lease);
  IF jsonb_array_length(r->'originales') IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'No enumeró todos los originales: %',r; END IF;
  evidencia:=(r->'originales'->0)-ARRAY['localizador','bucket','nombre_original','habilitado'];
  r:=public.kvg_trabajar('documento.recuperar_beta',lease||jsonb_build_object('verificaciones',jsonb_build_array(evidencia)));
  IF r->>'estado' IS DISTINCT FROM 'FALLIDO' THEN RAISE EXCEPTION 'Recuperó con evidencia incompleta: %',r; END IF;
  RESET ROLE;
  IF (SELECT retirado_en FROM kvg.documento WHERE documento_id=doc) IS NULL THEN RAISE EXCEPTION 'Activó el documento sin originales completos.'; END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',admin,true);
  solicitud:=solicitud||jsonb_build_object('clave_idempotencia',gen_random_uuid());
  r:=public.kvg_operar('documento.recuperar',solicitud);
  trabajo:=(r#>>'{datos,trabajo_id}')::uuid;
  RESET ROLE;
  SELECT permiso_id INTO permiso FROM kvg.permiso WHERE codigo='documento.recuperar';
  UPDATE kvg.rol_permiso rp SET activo=false FROM kvg.rol ro WHERE ro.rol_id=rp.rol_id
    AND ro.codigo='ADMINISTRADOR' AND rp.permiso_id=permiso;
  SET LOCAL ROLE service_role;
  PERFORM set_config('kvg_test.claims','{"role":"service_role"}',true);
  job:=public.kvg_trabajar('trabajo.tomar_recuperacion');
  lease:=jsonb_build_object('trabajo_id',job->>'trabajo_id','token',job->>'ejecutor_codigo');
  r:=public.kvg_trabajar('trabajo.datos',lease);
  IF r->>'autorizada' IS DISTINCT FROM 'false' OR r ? 'originales' THEN RAISE EXCEPTION 'Leyó originales sin facultad vigente.'; END IF;
  r:=public.kvg_trabajar('recuperacion.rechazar',lease);
  IF r->>'estado' IS DISTINCT FROM 'CANCELADO' THEN RAISE EXCEPTION 'No canceló la recuperación revocada.'; END IF;
  RESET ROLE;
  UPDATE kvg.rol_permiso rp SET activo=true FROM kvg.rol ro WHERE ro.rol_id=rp.rol_id
    AND ro.codigo='ADMINISTRADOR' AND rp.permiso_id=permiso;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',admin,true);
  solicitud:=solicitud||jsonb_build_object('clave_idempotencia',gen_random_uuid());
  r:=public.kvg_operar('documento.recuperar',solicitud);
  trabajo:=(r#>>'{datos,trabajo_id}')::uuid;
  RESET ROLE;
  SET LOCAL ROLE service_role;
  PERFORM set_config('kvg_test.claims','{"role":"service_role"}',true);
  job:=public.kvg_trabajar('trabajo.tomar_recuperacion');
  lease:=jsonb_build_object('trabajo_id',job->>'trabajo_id','token',job->>'ejecutor_codigo');
  r:=public.kvg_trabajar('trabajo.datos',lease);
  SELECT jsonb_agg(x-ARRAY['localizador','bucket','nombre_original','habilitado']) INTO evidencia FROM jsonb_array_elements(r->'originales') x;
  r:=public.kvg_trabajar('documento.recuperar_beta',lease||jsonb_build_object('verificaciones',evidencia));
  IF r->>'estado' IS DISTINCT FROM 'COMPLETADO' THEN RAISE EXCEPTION 'Recuperación íntegra: %',r; END IF;
  BEGIN
    PERFORM public.kvg_trabajar('entrega.autorizar',jsonb_build_object('autorizacion_id',autorizacion));
    RAISE EXCEPTION 'Reactivar revivió la autorización de descarga previa.';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',admin,true);
  r:=public.kvg_operar('documento.recuperar',solicitud);
  IF r#>>'{datos,trabajo_id}' IS DISTINCT FROM trabajo::text OR r#>>'{datos,modo}' IS DISTINCT FROM 'BETA'
    OR r#>>'{datos,estado}' IS DISTINCT FROM 'COMPLETADO' THEN RAISE EXCEPTION 'No conservó resultado tras reintento: %',r; END IF;
  r:=public.kvg_operar('documento.consultar',jsonb_build_object('documento_id',doc));
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Recuperar dio lectura jurídica a administración.'; END IF;
  PERFORM set_config('kvg_test.claims',abogado,true);
  r:=public.kvg_operar('documento.descargar',jsonb_build_object('version_id',v1));
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Recuperar dio acceso fuera de alcance.'; END IF;
  PERFORM set_config('kvg_test.claims',secretario,true);
  r:=public.kvg_operar('documento.descargar',jsonb_build_object('version_id',v1));
  IF r#>>'{datos,sha256}' IS DISTINCT FROM repeat('a',64) THEN RAISE EXCEPTION 'No conservó original anterior: %',r; END IF;
  RESET ROLE;
  IF (SELECT count(*) FROM kvg.evento_retiro_documento WHERE documento_id=doc)<>2 OR
    (SELECT version_vigente_id FROM kvg.documento WHERE documento_id=doc) IS DISTINCT FROM v2 THEN
    RAISE EXCEPTION 'El historial o la versión vigente cambiaron indebidamente.';
  END IF;
  RAISE NOTICE '5D: retiro, autorización anterior bloqueada, originales, revocación, evidencia completa, reintento y alcance';
END;
$test$;
ROLLBACK;
