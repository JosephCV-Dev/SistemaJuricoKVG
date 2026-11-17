-- Solo en PostgreSQL efímero, después de la baseline y las migraciones.
-- Las identidades de esta prueba son locales. No ejecutarlo en Supabase.
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

DO $test$
DECLARE
  actor_claims text := '{"sub":"10000000-0000-4000-8000-000000000003","session_id":"20000000-0000-4000-8000-000000000003","aal":"aal2","role":"authenticated"}';
  other_claims text := '{"sub":"10000000-0000-4000-8000-000000000004","session_id":"20000000-0000-4000-8000-000000000004","aal":"aal2","role":"authenticated"}';
  result jsonb; args jsonb; client_id uuid; other_id uuid; original_id uuid;
BEGIN
  IF has_function_privilege('authenticated','kvg_privado.actualizar_identificaciones_cliente(uuid,jsonb,uuid)','EXECUTE')
    OR has_function_privilege('anon','kvg_privado.actualizar_identificaciones_cliente(uuid,jsonb,uuid)','EXECUTE')
    OR has_function_privilege('service_role','kvg_privado.actualizar_identificaciones_cliente(uuid,jsonb,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'El helper debe quedar privado';
  END IF;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('kvg_test.claims',actor_claims,true);
  result := public.kvg_operar('sesion.iniciar');
  IF result->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Sesión de prueba: %', result; END IF;
  result := public.kvg_operar('cliente.registrar','{"nombre":"Nombre Ficticio","identificaciones":[{"tipo":"FICTICIA","valor":"A-b 12"},{"tipo":"LEGADA","valor":"X-3"}],"contactos":[{"tipo":"CORREO","valor":"local@example.test","preferente":true}]}');
  client_id := (result#>>'{datos,cliente_id}')::uuid;
  IF client_id IS NULL THEN RAISE EXCEPTION 'No se creó cliente: %', result; END IF;
  result := public.kvg_operar('cliente.registrar','{"nombre":"Nombre Ficticio"}');
  other_id := (result#>>'{datos,cliente_id}')::uuid;
  IF other_id IS NULL THEN RAISE EXCEPTION 'Nombre repetido debe admitirse'; END IF;
  result := public.kvg_operar('cliente.buscar','{"texto":"nombre ficticio","limite":1}');
  IF jsonb_array_length(result->'datos') IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'La búsqueda debe paginar'; END IF;
  result := public.kvg_operar('cliente.buscar','{"texto":"ficticio","identificacion":"AB12","limite":5}');
  IF jsonb_array_length(result->'datos') IS DISTINCT FROM 1 OR result#>>'{datos,0,cliente_id}' IS DISTINCT FROM client_id::text THEN
    RAISE EXCEPTION 'La búsqueda debe combinar nombre e identificación normalizada';
  END IF;
  result := public.kvg_operar('cliente.buscar','{"texto":"Ficticio%"}');
  IF result->'datos' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'El nombre se debe buscar literalmente'; END IF;
  result := public.kvg_operar('cliente.consultar',jsonb_build_object('cliente_id',client_id));
  IF result#>>'{datos,puede_editar}' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'El propietario debe poder editar'; END IF;

  args := jsonb_build_object('cliente_id',client_id,'revision',1,'nombre','Nombre corregido');
  result := public.kvg_operar('cliente.actualizar',args);
  IF result#>>'{datos,revision}' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'La revisión debe avanzar: %', result; END IF;
  result := public.kvg_operar('cliente.actualizar',args || '{"nombre":"Nombre obsoleto"}');
  IF result->>'codigo' IS DISTINCT FROM '40001' THEN RAISE EXCEPTION 'Debe rechazar revisión obsoleta'; END IF;
  result := public.kvg_operar('cliente.actualizar',jsonb_build_object('cliente_id',other_id,'revision',1,'nombre','No guardar',
    'identificaciones','[{"tipo":"FICTICIA","valor":"ab 12"}]'::jsonb));
  IF result->>'codigo' IS DISTINCT FROM '23505' THEN RAISE EXCEPTION 'Debe rechazar duplicado normalizado'; END IF;
  result := public.kvg_operar('cliente.consultar',jsonb_build_object('cliente_id',other_id));
  IF result#>>'{datos,nombre_presentacion}' IS DISTINCT FROM 'Nombre Ficticio' OR result#>>'{datos,revision}' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'El duplicado debe revertir nombre y revisión';
  END IF;

  RESET ROLE;
  UPDATE kvg.tipo_identificacion SET activo=false WHERE tipo_identificacion_codigo='LEGADA';
  SELECT identificacion_id INTO original_id FROM kvg.identificacion_cliente WHERE cliente_id=client_id AND tipo_identificacion_codigo='LEGADA';
  SET LOCAL ROLE authenticated;
  result := public.kvg_operar('cliente.actualizar',jsonb_build_object('cliente_id',client_id,'revision',2,
    'identificaciones','[{"tipo":"FICTICIA","valor":"nuevo-12"},{"tipo":"LEGADA","valor":"X-3"}]'::jsonb,
    'contactos','[{"tipo":"TELEFONO","valor":"+52 555 010 2222","etiqueta":"Oficina"}]'::jsonb));
  IF result#>>'{datos,revision}' IS DISTINCT FROM '3' THEN RAISE EXCEPTION 'La edición de colecciones debe conservar el tipo anterior intacto: %', result; END IF;
  result := public.kvg_operar('cliente.buscar','{"identificacion":"AB12"}');
  IF result->'datos' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'La identificación retirada no se debe listar'; END IF;
  result := public.kvg_operar('cliente.buscar','{"identificacion":"NUEVO12"}');
  IF result#>>'{datos,0,cliente_id}' IS DISTINCT FROM client_id::text THEN RAISE EXCEPTION 'La nueva identificación debe aparecer'; END IF;
  result := public.kvg_operar('cliente.actualizar',jsonb_build_object('cliente_id',client_id,'revision',3,'creado_por',gen_random_uuid()));
  IF result->>'codigo' IS DISTINCT FROM '22023' THEN RAISE EXCEPTION 'Los campos protegidos deben rechazarse'; END IF;

  PERFORM set_config('kvg_test.claims',other_claims,true);
  result := public.kvg_operar('sesion.iniciar');
  IF result->>'correcto' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Sesión de otra cuenta: %', result; END IF;
  result := public.kvg_operar('cliente.buscar','{"identificacion":"NUEVO12"}');
  IF result->'datos' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'La otra cuenta no debe ver el cliente'; END IF;
  result := public.kvg_operar('cliente.actualizar',args || '{"revision":3}');
  IF result->>'codigo' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'La otra cuenta no debe poder editar'; END IF;
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM kvg.identificacion_cliente WHERE identificacion_id=original_id AND retirado_en IS NULL)
    OR NOT EXISTS (SELECT 1 FROM kvg.contacto_cliente WHERE cliente_id=client_id AND activo AND etiqueta='Oficina')
    OR (SELECT count(*) FROM kvg.evento_auditoria a JOIN kvg.usuario u USING (usuario_id)
        WHERE a.recurso_id=client_id AND a.accion='cliente.update' AND u.correo_operativo='local-3@example.test') <> 2 THEN
    RAISE EXCEPTION 'Deben conservarse los datos y solo auditarse las dos ediciones confirmadas';
  END IF;
  RAISE NOTICE 'CU002/CU003: búsqueda, alcance, revisión, rollback, historial y auditoría verificados';
END;
$test$;

ROLLBACK;
