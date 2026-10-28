-- Metadatos y privilegios del incremento; sin identidades fabricadas ni datos reales.
BEGIN READ ONLY;
DO $test$
DECLARE v_role text;
BEGIN
  IF to_regclass('kvg_privado.solicitud_creacion') IS NULL OR
     to_regprocedure('kvg_privado.crear_una_vez(text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Falta la migración de idempotencia.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='kvg_privado.solicitud_creacion'::regclass) THEN
    RAISE EXCEPTION 'La tabla privada requiere RLS.';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role','kvg_session_store'] LOOP
    IF has_table_privilege(v_role,'kvg_privado.solicitud_creacion','SELECT,INSERT,UPDATE,DELETE') OR
       has_function_privilege(v_role,'kvg_privado.crear_una_vez(text,jsonb)','EXECUTE') THEN
      RAISE EXCEPTION 'Acceso directo inesperado al contrato privado.';
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated','public.kvg_operar(text,jsonb)','EXECUTE') OR
     has_function_privilege('anon','public.kvg_operar(text,jsonb)','EXECUTE') OR
     has_function_privilege('service_role','public.kvg_operar(text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Los privilegios del RPC ordinario cambiaron.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.kvg_operar(text,jsonb)'::regprocedure
       AND prosecdef AND proconfig @> ARRAY['search_path=""']
       AND strpos(prosrc,'crear_una_vez') > 0 AND strpos(prosrc,'nombre_abogado') > 0
       AND strpos(prosrc,'''sesion.consultar''') > 0) THEN
    RAISE EXCEPTION 'El despachador no conserva las extensiones y el search_path esperado.';
  END IF;
END;
$test$;
ROLLBACK;
