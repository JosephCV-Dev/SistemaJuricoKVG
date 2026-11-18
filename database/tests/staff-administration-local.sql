-- CU018/CU019. Ejecutar solo en PostgreSQL efímero con el fixture de plataforma.
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
  'Administración ficticia','Abogacía ficticia','Prueba local de personal');
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
DECLARE roles text[]:=ARRAY['admin','lawyer','secretary','invited']; i int; claims text;
  r jsonb; invite jsonb; reasons jsonb; change_role jsonb; matrix jsonb; revoke jsonb;
  user_id_new uuid; original_lawyer uuid; auth_new uuid:='10000000-0000-4000-8000-000000000004';
  client_id uuid; case_id uuid; access_id uuid; admin_id uuid;
BEGIN
  SELECT usuario_id INTO original_lawyer FROM kvg.usuario WHERE correo_operativo='local-2@example.test';
  SELECT usuario_id INTO admin_id FROM kvg.usuario WHERE correo_operativo='local-1@example.test';
  FOR i IN 1..4 LOOP
    claims:=jsonb_build_object('sub','10000000-0000-4000-8000-'||lpad(i::text,12,'0'),
      'session_id','20000000-0000-4000-8000-'||lpad(i::text,12,'0'),'aal','aal2','role','authenticated')::text;
    PERFORM set_config('kvg_test.claims_'||roles[i],claims,true);
    IF i=4 THEN CONTINUE; END IF;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('kvg_test.claims',claims,true);
    r:=public.kvg_operar('sesion.iniciar');
    IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Sesión faltante: %',r; END IF;
    RESET ROLE;
  END LOOP;

  invite:=jsonb_build_object('nombre','Persona ficticia de personal','correo','  Nueva-6A@Example.Test ',
    'motivo','Alta ficticia autorizada','solicitud_id',gen_random_uuid());
  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_secretary'),true);
  r:=public.kvg_operar('usuario.invitar',invite);
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Alta de Secretaría: %',r; END IF;
  r:=public.kvg_operar('usuario.listar');
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Directorio visible a Secretaría.'; END IF;
  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_admin'),true);
  r:=public.kvg_operar('usuario.invitar',invite);
  user_id_new:=(r#>>'{datos,usuario_id}')::uuid;
  IF user_id_new IS NULL OR r#>>'{datos,correo_operativo}' IS DISTINCT FROM 'nueva-6a@example.test'
    OR r#>>'{datos,estado_cuenta}' IS DISTINCT FROM 'INVITADO' THEN RAISE EXCEPTION 'Reserva inválida: %',r; END IF;
  r:=public.kvg_operar('usuario.invitar',invite);
  IF r#>>'{datos,usuario_id}' IS DISTINCT FROM user_id_new::text THEN RAISE EXCEPTION 'Reserva duplicada: %',r; END IF;
  r:=public.kvg_operar('usuario.invitar',invite||jsonb_build_object('solicitud_id',gen_random_uuid()));
  IF r->>'codigo' IS DISTINCT FROM '23505' THEN RAISE EXCEPTION 'El correo se duplicó: %',r; END IF;
  r:=public.kvg_operar('usuario.listar','{"texto":"nueva-6a"}');
  IF r#>>'{datos,0,usuario_id}' IS DISTINCT FROM user_id_new::text THEN RAISE EXCEPTION 'No aparece en directorio: %',r; END IF;
  r:=public.kvg_operar('usuario.destino_invitacion',jsonb_build_object('usuario_id',user_id_new));
  IF r#>>'{datos,correo}' IS DISTINCT FROM 'nueva-6a@example.test' THEN RAISE EXCEPTION 'No autorizó correo reservado: %',r; END IF;

  reasons:='{"motivo":"Cambio ficticio","referencia_autorizacion":"Decisión ficticia 6A"}';
  change_role:=jsonb_build_object('usuario_id',user_id_new,'rol','ABOGADO','revision',1)||reasons;
  r:=public.kvg_operar('seguridad.otorgar_rol',change_role||jsonb_build_object('usuario_id',admin_id));
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Autoconcesión permitida: %',r; END IF;
  r:=public.kvg_operar('seguridad.otorgar_rol',change_role);
  IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'No pudo asignar rol: %',r; END IF;
  r:=public.kvg_operar('seguridad.revocar_rol',change_role);
  IF r->>'codigo' IS DISTINCT FROM '40001' THEN RAISE EXCEPTION 'Aceptó revisión obsoleta de rol: %',r; END IF;
  r:=public.kvg_operar('usuario.editar',jsonb_build_object('usuario_id',user_id_new,'revision',2,
    'nombre','Nombre ficticio actualizado','motivo','Corrección ficticia'));
  IF r#>>'{datos,revision}' IS DISTINCT FROM '3' THEN RAISE EXCEPTION 'Edición fallida: %',r; END IF;
  r:=public.kvg_operar('usuario.desactivar',jsonb_build_object('usuario_id',admin_id,'revision',1,'motivo','Intento ficticio'));
  IF r->>'codigo' IS DISTINCT FROM 'KVG02' THEN RAISE EXCEPTION 'El último administrador se pudo desactivar: %',r; END IF;
  RESET ROLE;

  INSERT INTO auth.users(id,email,email_confirmed_at,invited_at)
    VALUES (auth_new,'nueva-6a@example.test',clock_timestamp(),clock_timestamp()-interval '1 day');
  INSERT INTO auth.sessions(id,user_id) VALUES ('20000000-0000-4000-8000-000000000004',auth_new);
  SET LOCAL ROLE authenticated;
  claims:=current_setting('kvg_test.claims_invited');
  PERFORM set_config('kvg_test.claims',(claims::jsonb||'{"aal":"aal1"}')::text,true);
  r:=public.kvg_operar('identidad.validar_invitacion');
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Aceptó un alta anterior de Auth: %',r; END IF;
  RESET ROLE;
  UPDATE auth.users SET invited_at=clock_timestamp(),email_confirmed_at=clock_timestamp()+interval '1 second' WHERE id=auth_new;
  SET LOCAL ROLE authenticated;
  r:=public.kvg_operar('identidad.validar_invitacion');
  IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Invitación válida: %',r; END IF;
  r:=public.kvg_operar('sesion.iniciar');
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Activó sin MFA: %',r; END IF;
  PERFORM set_config('kvg_test.claims',claims,true);
  r:=public.kvg_operar('sesion.iniciar');
  IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Activación con MFA: %',r; END IF;
  r:=public.kvg_operar('sesion.consultar');
  IF r#>>'{datos,roles,0}' IS DISTINCT FROM 'ABOGADO' THEN RAISE EXCEPTION 'Rol operativo incorrecto: %',r; END IF;

  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_secretary'),true);
  r:=public.kvg_operar('cliente.registrar','{"nombre":"Cliente ficticio de personal"}');
  client_id:=(r#>>'{datos,cliente_id}')::uuid;
  r:=public.kvg_operar('expediente.crear',jsonb_build_object('cliente_id',client_id,'descripcion','Expediente ficticio de permisos'));
  case_id:=(r#>>'{datos,expediente_id}')::uuid;
  r:=public.kvg_operar('expediente.asignar',jsonb_build_object('expediente_id',case_id,'revision',1,
    'abogado_id',original_lawyer,'funcion','PRINCIPAL','motivo','Responsable ficticio'));
  IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Asignación fallida: %',r; END IF;
  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_admin'),true);
  r:=public.kvg_operar('usuario.detalle',jsonb_build_object('usuario_id',original_lawyer));
  r:=public.kvg_operar('usuario.desactivar',jsonb_build_object('usuario_id',original_lawyer,
    'revision',(r#>>'{datos,revision}')::integer,'motivo','Baja ficticia'));
  IF r->>'codigo' IS DISTINCT FROM 'KVG01' THEN RAISE EXCEPTION 'Pudo desactivar al principal sin relevo: %',r; END IF;
  r:=public.kvg_operar('seguridad.accesos_expediente',jsonb_build_object('expediente_id',case_id));
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Administración obtuvo concesiones jurídicas por caso.'; END IF;
  matrix:=reasons||'{"rol":"SECRETARIA","permiso":"documento.consultar","contexto":"EXPLICITO","activo":false,"revision":1}';
  r:=public.kvg_operar('seguridad.matriz',matrix);
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Cambió la matriz sin facultad jurídica: %',r; END IF;

  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_lawyer'),true);
  r:=public.kvg_operar('seguridad.accesos_expediente',jsonb_build_object('expediente_id',case_id,'correo','nueva-6a@example.test'));
  IF r#>>'{datos,usuario,id}' IS DISTINCT FROM user_id_new::text THEN RAISE EXCEPTION 'No encontró destinatario autorizado: %',r; END IF;
  r:=public.kvg_operar('seguridad.conceder',reasons||jsonb_build_object('expediente_id',case_id,'usuario_id',user_id_new,
    'permisos',jsonb_build_array('expediente.consultar')));
  access_id:=(r#>>'{datos,concesion_id}')::uuid;
  IF access_id IS NULL THEN RAISE EXCEPTION 'No registró concesión: %',r; END IF;
  PERFORM set_config('kvg_test.claims',claims,true);
  r:=public.kvg_operar('expediente.consultar',jsonb_build_object('expediente_id',case_id));
  IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'El alcance explícito no sirve: %',r; END IF;
  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_admin'),true);
  revoke:=jsonb_build_object('concesion_id',access_id,'motivo','Revocación ficticia');
  r:=public.kvg_operar('seguridad.revocar_concesion',revoke);
  IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'No revocó concesión: %',r; END IF;
  PERFORM set_config('kvg_test.claims',claims,true);
  r:=public.kvg_operar('expediente.consultar',jsonb_build_object('expediente_id',case_id));
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Sesión anterior mantuvo alcance: %',r; END IF;

  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_admin'),true);
  r:=public.kvg_operar('usuario.detalle',jsonb_build_object('usuario_id',user_id_new));
  change_role:=change_role||jsonb_build_object('rol','ADMINISTRADOR','revision',(r#>>'{datos,revision}')::integer);
  r:=public.kvg_operar('seguridad.otorgar_rol',change_role);
  IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'No asignó rol operativo: %',r; END IF;
  PERFORM set_config('kvg_test.claims',claims,true);
  r:=public.kvg_operar('seguridad.consultar_matriz','{"rol":"SECRETARIA"}');
  IF r#>>'{datos,puede_editar}' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'La matriz no refleja doble facultad: %',r; END IF;
  r:=public.kvg_operar('seguridad.matriz',matrix);
  IF r->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'No pudo cambiar matriz autorizada: %',r; END IF;
  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_secretary'),true);
  r:=public.kvg_operar('sesion.consultar');
  IF (r#>'{datos,capacidades}') @> '[{"permiso":"documento.consultar"}]' THEN RAISE EXCEPTION 'La sesión conservó un permiso revocado.'; END IF;
  PERFORM set_config('kvg_test.claims',claims,true);
  r:=public.kvg_operar('seguridad.matriz',matrix||'{"rol":"ADMINISTRADOR","permiso":"usuario.permisos","contexto":"GLOBAL_OPERATIVO"}');
  IF r->>'codigo' IS DISTINCT FROM 'KVG02' THEN RAISE EXCEPTION 'Se pudo dejar el sistema sin gestión de permisos: %',r; END IF;

  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_admin'),true);
  r:=public.kvg_operar('usuario.detalle',jsonb_build_object('usuario_id',user_id_new));
  r:=public.kvg_operar('usuario.desactivar',jsonb_build_object('usuario_id',user_id_new,
    'revision',(r#>>'{datos,revision}')::integer,'motivo','Baja ficticia autorizada'));
  IF r#>>'{datos,estado_cuenta}' IS DISTINCT FROM 'DESACTIVADO' OR r#>>'{datos,auth_id}' IS DISTINCT FROM auth_new::text THEN
    RAISE EXCEPTION 'La baja no conservó el vínculo operativo: %',r;
  END IF;
  PERFORM set_config('kvg_test.claims',claims,true);
  r:=public.kvg_operar('sesion.consultar');
  IF r->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Cookie de cuenta desactivada seguía vigente.'; END IF;
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM kvg_privado.decision_personal WHERE usuario_id=user_id_new AND operacion='USUARIO_DESACTIVAR')
    OR NOT EXISTS (SELECT 1 FROM kvg.evento_restriccion WHERE accion='REVOCAR_CONCESION' AND recurso_id=access_id::text) THEN
    RAISE EXCEPTION 'Falta trazabilidad de baja o revocación.';
  END IF;
  RAISE NOTICE '6A: reserva, alta con MFA, roles, matriz, relevo, alcance, auditoría y revocación en sesión vigente';
END;
$test$;
ROLLBACK;
