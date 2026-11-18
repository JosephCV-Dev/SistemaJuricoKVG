-- CU020/CU021. Ejecutar solo en PostgreSQL efímero con el fixture de plataforma.
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
  'Administración ficticia','Abogacía ficticia','Prueba local de bitácora y configuración');
INSERT INTO kvg.usuario (auth_usuario_id,nombre,correo_operativo,estado_cuenta,creado_por)
SELECT a.id,'Secretaría ficticia',a.email,'ACTIVO',u.usuario_id FROM auth.users a
JOIN kvg.usuario u ON u.correo_operativo='local-1@example.test' WHERE a.email='local-3@example.test';
INSERT INTO kvg.usuario_rol (usuario_id,rol_id,otorgado_por,motivo_alta)
SELECT u.usuario_id,r.rol_id,u.creado_por,'Prueba local' FROM kvg.usuario u
CROSS JOIN kvg.rol r WHERE r.codigo='SECRETARIA' AND u.correo_operativo='local-3@example.test';
INSERT INTO auth.sessions(id,user_id)
SELECT ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM (VALUES (1),(2),(3)) t(n);
DO $test$
DECLARE
  i integer; claims text; r jsonb; saved_category uuid; event_id uuid;
  first_id uuid; first_at timestamptz; parameter_revision integer; old_idle integer;
  secret_session uuid; admin_id uuid; v_client_id uuid; correlation uuid:=gen_random_uuid();
  resource uuid:=gen_random_uuid();
  id_data jsonb:='{"codigo":"CU021_LOCAL","nombre":"Tipo ficticio","regla":"ALFANUMERICA_V1","unicidad":true,"motivo":"Alta de prueba"}';
BEGIN
  FOR i IN 1..3 LOOP
    claims:=jsonb_build_object('sub','10000000-0000-4000-8000-'||lpad(i::text,12,'0'),
      'session_id','20000000-0000-4000-8000-'||lpad(i::text,12,'0'),'aal','aal2','role','authenticated')::text;
    PERFORM set_config('kvg_test.claims_'||i::text,claims,true);
    SET LOCAL ROLE authenticated;
    PERFORM set_config('kvg_test.claims',claims,true);
    r:=public.kvg_operar('sesion.iniciar');
    IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Sesión faltante: %',r; END IF;
    RESET ROLE;
  END LOOP;
  SELECT usuario_id INTO admin_id FROM kvg.usuario WHERE correo_operativo='local-1@example.test';
  SELECT sesion_id INTO secret_session FROM kvg.sesion_aplicacion WHERE usuario_id=admin_id;
  INSERT INTO kvg.evento_auditoria(ocurrido_en,tipo_actor,usuario_id,sesion_id,accion,recurso_tipo,recurso_id,resultado,correlacion_id,detalle_controlado)
    VALUES ('2026-11-01T10:00:00Z','USUARIO',admin_id,secret_session,'AUTORIZACION_DESCARGA','VERSION',resource,'EXITO',correlation,
      '{"revision":7,"cantidad":9,"campos":["dato ficticio que no se debe proyectar"]}')
    RETURNING evento_id INTO event_id;
  INSERT INTO kvg.evento_auditoria(ocurrido_en,tipo_actor,usuario_id,sesion_id,accion,recurso_tipo,recurso_id,resultado,correlacion_id)
    VALUES ('2026-11-01T10:00:00Z','USUARIO',admin_id,secret_session,'TRANSFERENCIA_VERIFICADA','VERSION',resource,'EXITO',correlation);

  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_3'),true);
  r:=public.kvg_operar('auditoria.consultar');
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Secretaría accedió a auditoría: %',r; END IF;
  r:=public.kvg_operar('auditoria.detalle',jsonb_build_object('evento_id',event_id));
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Secretaría accedió al evento: %',r; END IF;
  r:=public.kvg_operar('configuracion.catalogos');
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Secretaría accedió a configuración: %',r; END IF;
  r:=public.kvg_operar('configuracion.identificacion',id_data);
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Secretaría cambió el catálogo: %',r; END IF;

  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_1'),true);
  r:=public.kvg_operar('auditoria.consultar',
    jsonb_build_object('actor','Administración ficticia','accion','autorizacion_descarga','recurso',resource,
      'desde','2026-11-01T00:00:00Z','hasta','2026-11-02T00:00:00Z','resultado','EXITO'));
  IF r#>>'{datos,0,evento_id}' IS DISTINCT FROM event_id::text OR jsonb_array_length(r->'datos')<>1
    OR r->'datos'->0 ?| ARRAY['sesion_id','detalle_controlado'] THEN RAISE EXCEPTION 'Filtro/proyección defectuosos: %',r; END IF;
  r:=public.kvg_operar('auditoria.detalle',jsonb_build_object('evento_id',event_id));
  IF r#>>'{datos,revision}' IS DISTINCT FROM '7' OR r#>>'{datos,cantidad}' IS DISTINCT FROM '9'
    OR r#>>'{datos,correlacion_id}' IS DISTINCT FROM correlation::text
    OR r->'datos' ?| ARRAY['sesion_id','detalle_controlado','campos'] THEN RAISE EXCEPTION 'Detalle incorrecto: %',r; END IF;
  r:=public.kvg_operar('auditoria.detalle',jsonb_build_object('evento_id',gen_random_uuid()));
  IF r->>'codigo' IS DISTINCT FROM 'P0002' THEN RAISE EXCEPTION 'Evento inexistente: %',r; END IF;
  r:=public.kvg_operar('auditoria.consultar',jsonb_build_object('recurso',resource,'limite',1));
  first_id:=(r#>>'{datos,0,evento_id}')::uuid; first_at:=(r#>>'{datos,0,ocurrido_en}')::timestamptz;
  r:=public.kvg_operar('auditoria.consultar',jsonb_build_object('recurso',resource,'limite',1,'antes_de',first_at,'antes_id',first_id));
  IF r#>>'{datos,0,evento_id}' IS NULL OR r#>>'{datos,0,evento_id}'=first_id::text
    OR r#>>'{datos,0,correlacion_id}' IS DISTINCT FROM correlation::text THEN RAISE EXCEPTION 'Cursor inestable: %',r; END IF;

  r:=public.kvg_operar('configuracion.catalogos');
  IF r->>'correcto' IS DISTINCT FROM 'true' OR jsonb_typeof(r#>'{datos,categorias}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(r#>'{datos,identificaciones}') IS DISTINCT FROM 'array'
    OR r->'datos' ?| ARRAY['roles','matriz','permisos'] THEN RAISE EXCEPTION 'Configuración inválida: %',r; END IF;
  SELECT (p->>'revision')::integer,(p->>'valor')::integer INTO parameter_revision,old_idle
    FROM jsonb_array_elements(r#>'{datos,parametros}') p WHERE p->>'parametro_codigo'='sesion.inactividad_minutos';
  r:=public.kvg_operar('configuracion.parametro',jsonb_build_object('codigo','sistema.bloqueado','revision',1,'valor',0,'motivo','Intento'));
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Control obligatorio editable: %',r; END IF;
  r:=public.kvg_operar('configuracion.parametro',jsonb_build_object('codigo','sesion.inactividad_minutos','revision',parameter_revision,'valor',31,'motivo','Intento'));
  IF r->>'codigo' IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'Valor inválido admitido: %',r; END IF;
  r:=public.kvg_operar('configuracion.parametro',jsonb_build_object('codigo','sesion.inactividad_minutos','revision',parameter_revision,'valor',5,'motivo','Prueba de inactividad'));
  IF r#>>'{datos,revision}' IS DISTINCT FROM (parameter_revision+1)::text THEN RAISE EXCEPTION 'Cambio de parámetro fallido: %',r; END IF;
  RESET ROLE;
  UPDATE kvg.sesion_aplicacion SET creada_en=clock_timestamp()-interval '7 minutes',
    ultima_actividad_en=clock_timestamp()-interval '6 minutes'
    WHERE usuario_id=(SELECT usuario_id FROM kvg.usuario WHERE correo_operativo='local-2@example.test');
  SET LOCAL ROLE authenticated;
  r:=public.kvg_operar('configuracion.parametro',jsonb_build_object('codigo','sesion.inactividad_minutos','revision',parameter_revision+1,'valor',old_idle,'motivo','Restituir umbral ficticio'));
  IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Ampliación de umbral: %',r; END IF;
  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_2'),true);
  r:=public.kvg_operar('sesion.consultar');
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Se reactivó una sesión vencida: %',r; END IF;
  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_1'),true);

  r:=public.kvg_operar('configuracion.categoria','{"codigo":"CU021_LOCAL","nombre":"Categoría ficticia"}');
  IF r->>'codigo' IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'Alta sin motivo admitida: %',r; END IF;
  r:=public.kvg_operar('configuracion.categoria','{"codigo":"CU021_LOCAL","nombre":"Categoría ficticia","motivo":"Alta de categoría"}');
  saved_category:=(r#>>'{datos,categoria_id}')::uuid;
  IF saved_category IS NULL THEN RAISE EXCEPTION 'Alta de categoría fallida: %',r; END IF;
  r:=public.kvg_operar('configuracion.categoria',jsonb_build_object('categoria_id',saved_category,'activo',false,'motivo','Desactivación','revision',1));
  IF r#>>'{datos,activo}' IS DISTINCT FROM 'false' OR r#>>'{datos,revision}' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'Desactivación fallida: %',r; END IF;
  r:=public.kvg_operar('configuracion.categoria',jsonb_build_object('categoria_id',saved_category,'activo',true,'motivo','Edición anterior','revision',1));
  IF r->>'codigo' IS DISTINCT FROM '40001' THEN RAISE EXCEPTION 'Revisión obsoleta admitida: %',r; END IF;

  r:=public.kvg_operar('configuracion.identificacion',id_data);
  IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Alta de identificación fallida: %',r; END IF;
  r:=public.kvg_operar('configuracion.identificacion',id_data);
  IF r->>'codigo' IS DISTINCT FROM '23505' THEN RAISE EXCEPTION 'Código duplicado admitido: %',r; END IF;
  r:=public.kvg_operar('configuracion.identificacion',id_data||'{"revision":1}');
  IF r->>'codigo' IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'Regla fija admitió edición: %',r; END IF;
  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_3'),true);
  r:=public.kvg_operar('cliente.registrar',jsonb_build_object('nombre','Prueba CU021',
    'identificaciones',jsonb_build_array(jsonb_build_object('tipo','CU021_LOCAL','valor','FIC-CU021'))));
  v_client_id:=(r#>>'{datos,cliente_id}')::uuid;
  IF v_client_id IS NULL THEN RAISE EXCEPTION 'Cliente de referencia falló: %',r; END IF;
  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_1'),true);
  r:=public.kvg_operar('configuracion.identificacion','{"codigo":"CU021_LOCAL","revision":1,"activo":false,"motivo":"Desactivar referencia"}');
  IF r#>>'{datos,activo}' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Desactivación de identificación fallida: %',r; END IF;
  r:=public.kvg_operar('catalogos.consultar');
  IF EXISTS(SELECT FROM jsonb_array_elements(r#>'{datos,tipos_identificacion}') t WHERE t->>'tipo_identificacion_codigo'='CU021_LOCAL')
    OR EXISTS(SELECT FROM jsonb_array_elements(r#>'{datos,categorias}') c WHERE c->>'codigo'='CU021_LOCAL') THEN
    RAISE EXCEPTION 'Catálogo inactivo disponible para nuevas referencias.';
  END IF;
  RESET ROLE;

  IF NOT EXISTS(SELECT FROM kvg.identificacion_cliente WHERE cliente_id=v_client_id AND tipo_identificacion_codigo='CU021_LOCAL')
    OR NOT EXISTS(SELECT FROM kvg_privado.cambio_catalogo WHERE catalogo='CATEGORIA' AND referencia=saved_category::text AND revision=2 AND motivo='Desactivación' AND actor_id=admin_id)
    OR NOT EXISTS(SELECT FROM kvg_privado.cambio_catalogo WHERE catalogo='IDENTIFICACION' AND referencia='CU021_LOCAL' AND revision=2 AND motivo='Desactivar referencia')
    OR NOT EXISTS(SELECT FROM kvg.historial_parametro WHERE motivo='Prueba de inactividad' AND registrado_por=admin_id)
    OR NOT EXISTS(SELECT FROM kvg.evento_auditoria WHERE accion='AUDITORIA_DETALLE_CONSULTADO' AND recurso_id=event_id AND usuario_id=admin_id)
    OR NOT EXISTS(SELECT FROM kvg.evento_auditoria WHERE accion='AUDITORIA_CONSULTAR' AND usuario_id=admin_id) THEN
    RAISE EXCEPTION 'Historial, referencias o auditoría incompletos.';
  END IF;
  BEGIN
    DELETE FROM kvg_privado.cambio_catalogo WHERE referencia='CU021_LOCAL';
    RAISE EXCEPTION 'Historial editable.';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE '6B: acceso, filtros, cursor, proyecciones, caducidad, catálogos e historial verificados';
END $test$;
ROLLBACK;
