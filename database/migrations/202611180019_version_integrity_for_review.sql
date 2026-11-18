-- CU029: evidencia de integridad solo con facultad jurídica sobre esa versión.
BEGIN;
DO $patch$
DECLARE src text;
BEGIN
  SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='kvg_privado.versiones_documento(jsonb)'::regprocedure;
  IF strpos(src,$s$jsonb_agg(to_jsonb(q) ORDER BY q.numero_version DESC)$s$)=0
    OR strpos(src,$s$v.numero_version,v.tamano_bytes,v.formato,$s$)=0 THEN
    RAISE EXCEPTION 'No se reconoció la proyección de integridad de las versiones.';
  END IF;
  src:=replace(src,$s$v.numero_version,v.tamano_bytes,v.formato,$s$,
    $s$v.numero_version,v.tamano_bytes,v.formato,
      CASE WHEN kvg_privado.puede_leer_revision(v.version_id) THEN v.sha256 END AS huella_sha256,$s$);
  src:=replace(src,$s$jsonb_agg(to_jsonb(q) ORDER BY q.numero_version DESC)$s$,
    $s$jsonb_agg(CASE WHEN q.huella_sha256 IS NULL THEN to_jsonb(q) - 'huella_sha256'
      ELSE to_jsonb(q) END ORDER BY q.numero_version DESC)$s$);
  EXECUTE 'CREATE OR REPLACE FUNCTION kvg_privado.versiones_documento(p_datos jsonb) '
    ||'RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);
END;
$patch$;
COMMIT;
