-- CU007/CU015/CU025. Ejecutar solo en PostgreSQL efímero con la baseline y las migraciones.
-- Crea cinco identidades ficticias dentro de una transacción revertida.
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

DO $test$
DECLARE result jsonb; cid uuid; eid uuid; folio text; principal uuid; colaborador uuid; secretaria uuid; administrador uuid;
  actor text; args jsonb; concesion uuid;
BEGIN
  SELECT usuario_id INTO principal FROM kvg.usuario WHERE correo_operativo='local-2@example.test';
  SELECT usuario_id INTO colaborador FROM kvg.usuario WHERE correo_operativo='local-5@example.test';
  SELECT usuario_id INTO secretaria FROM kvg.usuario WHERE correo_operativo='local-3@example.test';
  SELECT usuario_id INTO administrador FROM kvg.usuario WHERE correo_operativo='local-1@example.test';
  IF has_function_privilege('authenticated','kvg_privado.gestion_asignaciones(text,jsonb)','EXECUTE')
   OR has_function_privilege('service_role','kvg_privado.gestion_asignaciones(text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'La función privada no debe exponerse';
  END IF;
  FOR i IN 1..5 LOOP
    actor := jsonb_build_object('sub','10000000-0000-4000-8000-'||lpad(i::text,12,'0'),
      'session_id','20000000-0000-4000-8000-'||lpad(i::text,12,'0'),'aal','aal2','role','authenticated')::text;
    PERFORM set_config('kvg_test.claims_'||i,actor,true);
    PERFORM set_config('kvg_test.claims',actor,true);
    SET LOCAL ROLE authenticated;
    result := public.kvg_operar('sesion.iniciar');
    IF result->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Sesión faltante %',i; END IF;
    RESET ROLE;
  END LOOP;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_3'),true);
  result:=public.kvg_operar('cliente.registrar','{"nombre":"Cliente asignaciones ficticio"}');
  cid:=(result#>>'{datos,cliente_id}')::uuid;
  result:=public.kvg_operar('expediente.crear',jsonb_build_object('cliente_id',cid,'descripcion','Expediente ficticio equipo'));
  eid:=(result#>>'{datos,expediente_id}')::uuid;
  folio:=result#>>'{datos,folio_interno}';
  IF eid IS NULL THEN RAISE EXCEPTION 'Expediente faltante'; END IF;
  result:=public.kvg_operar('expediente.equipo',jsonb_build_object('expediente_id',eid));
  IF jsonb_array_length(result#>'{datos,abogados}') IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'Candidatos: %',result; END IF;
  args:=jsonb_build_object('expediente_id',eid,'revision',1,'abogado_id',principal,'funcion','PRINCIPAL','motivo','Asignación ficticia.');
  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_4'),true);
  result:=public.kvg_operar('expediente.asignar',args);
  IF result->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Secretaría ajena: %',result; END IF;
  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_3'),true);
  result:=public.kvg_operar('expediente.asignar',args||jsonb_build_object('abogado_id',administrador));
  IF result->>'codigo' IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'Candidato inválido: %',result; END IF;
  result:=public.kvg_operar('expediente.asignar',args);
  IF result#>>'{datos,revision}' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'Asignación: %',result; END IF;
  result:=public.kvg_operar('expediente.asignar',args||jsonb_build_object('revision',2,'abogado_id',colaborador));
  IF result->>'codigo' IS DISTINCT FROM '23505' THEN RAISE EXCEPTION 'Aceptó segundo principal: %',result; END IF;
  result:=public.kvg_operar('expediente.asignar',args||jsonb_build_object('revision',2,'abogado_id',colaborador,'funcion','COLABORADOR'));
  IF result#>>'{datos,revision}' IS DISTINCT FROM '3' THEN RAISE EXCEPTION 'Colaborador: %',result; END IF;

  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_2'),true);
  result:=public.kvg_operar('expediente.asignados','{"participacion":"PRINCIPAL"}');
  IF result#>>'{datos,0,expediente_id}' IS DISTINCT FROM eid::text OR
    result#>'{datos,0,participaciones}' IS DISTINCT FROM '["PRINCIPAL"]'::jsonb THEN RAISE EXCEPTION 'Lista principal: %',result; END IF;
  result:=public.kvg_operar('expediente.asignados',jsonb_build_object('abogado_id',colaborador));
  IF result->>'codigo' IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'Aceptó identidad cliente: %',result; END IF;
  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_5'),true);
  result:=public.kvg_operar('expediente.asignados','{"participacion":"COLABORADOR"}');
  IF result#>>'{datos,0,expediente_id}' IS DISTINCT FROM eid::text THEN RAISE EXCEPTION 'Lista colaborador: %',result; END IF;
  result:=public.kvg_operar('expediente.asignados','{"desde":"2000-01-01","hasta":"2000-12-31"}');
  IF result->'datos' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'Filtro de fechas incorrecto'; END IF;
  result:=public.kvg_operar('seguridad.conceder',jsonb_build_object('expediente_id',eid,'usuario_id',secretaria,
    'permisos',jsonb_build_array('expediente.consultar'),'motivo','Prueba de facultad de principal',
    'referencia_autorizacion','FICTICIA'));
  IF result->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Colaborador obtuvo facultad del principal: %',result; END IF;
  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_1'),true);
  result:=public.kvg_operar('expediente.reasignables',jsonb_build_object('texto',folio));
  IF result#>>'{datos,0,expediente_id}' IS DISTINCT FROM eid::text OR (result#>'{datos,0}') ? 'descripcion'
       OR (result#>'{datos,0}') ? 'cliente_principal_id' THEN RAISE EXCEPTION 'Vista administrativa: %',result; END IF;
  result:=public.kvg_operar('expediente.consultar',jsonb_build_object('expediente_id',eid));
  IF result->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Admin obtiene contenido: %',result; END IF;
  result:=public.kvg_operar('expediente.equipo_reasignacion',jsonb_build_object('expediente_id',eid));
  IF result#>>'{datos,revision}' IS DISTINCT FROM '3' OR result->'datos' ? 'descripcion' THEN RAISE EXCEPTION 'Equipo administrativo: %',result; END IF;

  RESET ROLE;
  INSERT INTO kvg.concesion_acceso(expediente_id,usuario_id,otorgado_por,aprobado_por,motivo,referencia_autorizacion)
    VALUES(eid,principal,secretaria,principal,'Solo prueba','FICTICIA') RETURNING concesion_id INTO concesion;
  INSERT INTO kvg.concesion_permiso(concesion_id,permiso_id)
    SELECT concesion,permiso_id FROM kvg.permiso WHERE codigo='expediente.consultar';
  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_2'),true);
  result:=public.kvg_operar('expediente.asignados','{"participacion":"EXPLICITO"}');
  IF result#>'{datos,0,participaciones}' IS DISTINCT FROM '["EXPLICITO","PRINCIPAL"]'::jsonb THEN RAISE EXCEPTION 'Acceso explícito: %',result; END IF;
  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_1'),true);
  args:=jsonb_build_object('expediente_id',eid,'revision',3,'abogado_id',colaborador,'motivo','Relevo ficticio.',
    'conservar_colaboracion',false);
  result:=public.kvg_operar('expediente.reasignar',args);
  IF result->>'codigo' IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'Relevo sin autorización: %',result; END IF;
  result:=public.kvg_operar('expediente.reasignar',args||'{"referencia_autorizacion":"APR-01"}');
  IF result#>>'{datos,revision}' IS DISTINCT FROM '4' THEN RAISE EXCEPTION 'Reasignación: %',result; END IF;
  result:=public.kvg_operar('expediente.reasignar',args||'{"referencia_autorizacion":"APR-01"}');
  IF result->>'codigo' IS DISTINCT FROM '40001' THEN RAISE EXCEPTION 'Revisión obsoleta: %',result; END IF;
  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_2'),true);
  result:=public.kvg_operar('expediente.consultar',jsonb_build_object('expediente_id',eid));
  IF result->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Saliente mantiene acceso: %',result; END IF;
  result:=public.kvg_operar('expediente.asignados');
  IF result->'datos' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'Saliente conserva listado: %',result; END IF;
  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_1'),true);
  result:=public.kvg_operar('expediente.reasignar',args||jsonb_build_object('referencia_autorizacion','APR-02','revision',4,
    'abogado_id',principal,'conservar_colaboracion',true));
  IF result#>>'{datos,revision}' IS DISTINCT FROM '5' THEN RAISE EXCEPTION 'Relevo con continuidad: %',result; END IF;
  PERFORM set_config('kvg_test.claims',current_setting('kvg_test.claims_5'),true);
  result:=public.kvg_operar('expediente.asignados','{"participacion":"COLABORADOR"}');
  IF result#>'{datos,0,participaciones}' IS DISTINCT FROM '["COLABORADOR"]'::jsonb THEN RAISE EXCEPTION 'Continuidad: %',result; END IF;
  RESET ROLE;
  IF (SELECT count(*) FROM kvg.asignacion_expediente WHERE expediente_id=eid AND funcion='PRINCIPAL' AND finaliza_en IS NULL)<>1
    OR (SELECT count(*) FROM kvg.asignacion_expediente WHERE expediente_id=eid AND finaliza_en IS NOT NULL)<>3
    OR (SELECT count(*) FROM kvg.evento_auditoria WHERE recurso_id=eid AND accion='EXPEDIENTE_REASIGNADO'
      AND detalle_controlado->>'codigo' IN ('APR-01','APR-02') AND usuario_id=administrador)<>2 THEN
    RAISE EXCEPTION 'Historial, principal único o auditoría incorrectos';
  END IF;
  RAISE NOTICE '4C: asignación, alcance, promoción, relevo, continuidad, revocación e historial confirmados';
END;
$test$;
ROLLBACK;
