-- CU012/CU029: el hash y el identificador de carga son metadatos técnicos.
BEGIN;
DO $patch$
DECLARE src text;
BEGIN
  SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='kvg_privado.documentos(text,jsonb)'::regprocedure;
  IF strpos(src,$s$to_jsonb(v) - 'localizador_objeto'$s$)=0 THEN
    RAISE EXCEPTION 'No se reconoció la proyección de consulta documental.';
  END IF;
  src:=replace(src,$s$to_jsonb(v) - 'localizador_objeto'$s$,
    $s$to_jsonb(v) - ARRAY['localizador_objeto','sha256','carga_id']$s$);
  EXECUTE 'CREATE OR REPLACE FUNCTION kvg_privado.documentos(p_operacion text,p_datos jsonb) '
    ||'RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);

  SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='kvg_privado.versiones_documento(jsonb)'::regprocedure;
  IF strpos(src,$s$v.numero_version,v.sha256,v.tamano_bytes$s$)=0 THEN
    RAISE EXCEPTION 'No se reconoció la proyección del historial de versiones.';
  END IF;
  src:=replace(src,$s$v.numero_version,v.sha256,v.tamano_bytes$s$,$s$v.numero_version,v.tamano_bytes$s$);
  EXECUTE 'CREATE OR REPLACE FUNCTION kvg_privado.versiones_documento(p_datos jsonb) '
    ||'RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);
END;
$patch$;
COMMIT;
