BEGIN READ ONLY;
DO $test$
DECLARE role_name text; bucket_name text; table_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role','kvg_session_store'] LOOP
  IF has_function_privilege(role_name,'kvg_privado.consultar_carga(jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Helper expuesto'; END IF;
  FOREACH table_name IN ARRAY ARRAY['documento','carga_archivo','version_documento','trabajo_operativo'] LOOP
   IF has_table_privilege(role_name,'kvg.'||table_name,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'CRUD documental directo'; END IF;
  END LOOP;
 END LOOP;
 IF has_function_privilege('authenticated','public.kvg_trabajar(text,jsonb)','EXECUTE') OR
    NOT has_function_privilege('service_role','public.kvg_trabajar(text,jsonb)','EXECUTE') OR
    has_function_privilege('service_role','public.kvg_operar(text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'RPC técnico mal separado'; END IF;
 FOREACH bucket_name IN ARRAY ARRAY['kvg-cuarentena','kvg-originales'] LOOP
  IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id=bucket_name AND public=false AND file_size_limit=20000000) THEN RAISE EXCEPTION 'Bucket no privado/acotado'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='storage.objects'::regclass AND polname='kvg_bloqueo_directo' AND NOT polpermissive) THEN RAISE EXCEPTION 'Falta bloqueo restrictivo Storage'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.kvg_trabajar(text,jsonb)'::regprocedure AND prosecdef AND proconfig @> ARRAY['search_path=""'] AND strpos(prosrc,'trabajo.tomar_carga')>0) THEN RAISE EXCEPTION 'Trabajador sin filtro exclusivo'; END IF;
END;
$test$;
ROLLBACK;
