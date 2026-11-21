-- CU012: restaurar la marca beta usando la versión autorizada tras ocultar carga_id.
BEGIN;
DO $patch$
DECLARE src text;
BEGIN
  SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='public.kvg_operar(text,jsonb)'::regprocedure;
  IF strpos(src,$s$WHERE c.carga_id=(v_salida#>>'{version,carga_id}')::uuid$s$)=0 THEN
    RAISE EXCEPTION 'No se reconoció el origen de la marca beta del detalle documental.';
  END IF;
  src:=replace(src,$s$SELECT 1 FROM kvg.carga_archivo c
        WHERE c.carga_id=(v_salida#>>'{version,carga_id}')::uuid$s$,
    $s$SELECT 1 FROM kvg.version_documento v JOIN kvg.carga_archivo c USING (carga_id)
        WHERE v.version_id=(v_salida#>>'{version,version_id}')::uuid$s$);
  IF strpos(src,$s$WHERE v.version_id=(v_salida#>>'{version,version_id}')::uuid$s$)=0 THEN
    RAISE EXCEPTION 'No se pudo restaurar la marca beta del detalle documental.';
  END IF;
  EXECUTE 'CREATE OR REPLACE FUNCTION public.kvg_operar(p_operacion text,p_datos jsonb DEFAULT ''{}'') '
    ||'RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);
END;
$patch$;
COMMIT;
