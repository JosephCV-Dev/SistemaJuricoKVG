-- Excepción explícita de desarrollo. Una carga beta nunca se registra como SEGURO.
BEGIN;
CREATE TABLE kvg_servidor.beta_documentos (
    habilitado boolean PRIMARY KEY CHECK (habilitado)
);
ALTER TABLE kvg_servidor.beta_documentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON kvg_servidor.beta_documentos FROM PUBLIC, anon, authenticated, service_role, kvg_session_store;

ALTER TABLE kvg.carga_archivo DROP CONSTRAINT ck_carga_habilitada;
ALTER TABLE kvg.carga_archivo ADD CONSTRAINT ck_carga_habilitada CHECK (
  (estado_tecnico <> 'HABILITADO' OR (tamano_recibido_bytes BETWEEN 1 AND 20000000 AND (
    (resultado_tecnico_codigo = 'SEGURO' AND verificado_en IS NOT NULL AND motor_version IS NOT NULL)
    OR (resultado_tecnico_codigo = 'BETA_SIN_ANTIMALWARE' AND verificado_en IS NULL AND motor_version IS NULL)
  ))) IS TRUE
);

CREATE FUNCTION kvg_privado.beta_documental_activa()
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $f$
  SELECT EXISTS (SELECT 1 FROM kvg_servidor.beta_documentos WHERE habilitado)
$f$;

CREATE FUNCTION kvg_privado.carga_descargable(p_carga uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $f$
  SELECT EXISTS (SELECT 1 FROM kvg.carga_archivo WHERE carga_id=p_carga
    AND estado_tecnico='HABILITADO' AND (resultado_tecnico_codigo='SEGURO'
      OR (resultado_tecnico_codigo='BETA_SIN_ANTIMALWARE' AND kvg_privado.beta_documental_activa())))
$f$;

REVOKE ALL ON FUNCTION kvg_privado.beta_documental_activa(), kvg_privado.carga_descargable(uuid)
    FROM PUBLIC, anon, authenticated, service_role, kvg_session_store;

CREATE OR REPLACE FUNCTION kvg_privado.puede_version(p_permiso text, p_version uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $func$
    SELECT EXISTS (SELECT 1 FROM kvg.version_documento v
      WHERE v.version_id = p_version AND kvg_privado.carga_descargable(v.carga_id)
       AND kvg_privado.puede_documento(p_permiso,v.documento_id));
$func$;

DO $patch$
DECLARE src text;
BEGIN
  SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='public.kvg_trabajar(text,jsonb)'::regprocedure;
  IF strpos(src, $s$IF p_operacion = 'trabajo.tomar_carga' THEN$s$)=0
    OR strpos(src,$s$ELSIF p_operacion IN ('carga.publicar','carga.rechazar') THEN$s$)=0
    OR strpos(src,$s$IF p_operacion = 'entrega.autorizar' THEN$s$)=0 THEN
    RAISE EXCEPTION 'Contrato técnico de documentos no reconocido.';
  END IF;
  src := replace(src,$s$IF p_operacion = 'trabajo.tomar_carga' THEN$s$,$s$
  IF p_operacion IN ('trabajo.tomar_carga','trabajo.tomar_carga_beta') THEN
    IF p_operacion = 'trabajo.tomar_carga_beta' THEN
      PERFORM kvg_privado.exigir(kvg_privado.beta_documental_activa());
      -- Concede un intento adicional a cargas recibidas cuyos trabajos ya se agotaron.
      UPDATE kvg.trabajo_operativo t SET estado='EN_COLA',finalizado_en=NULL,
        bloqueo_hasta=NULL,ejecutor_codigo=NULL,proximo_intento_en=clock_timestamp(),
        max_intentos=greatest(t.intentos,t.max_intentos)+1,
        detalle_solicitud=coalesce(t.detalle_solicitud,'{}'::jsonb)||'{"reintento_beta":true}'::jsonb
      WHERE t.trabajo_id IN (
        SELECT j.trabajo_id FROM kvg.trabajo_operativo j JOIN kvg.carga_archivo c ON c.carga_id=j.objetivo_id
        WHERE j.tipo IN ('VERIFICAR_CARGA','CONCILIAR_CARGA')
          AND (j.estado='FALLIDO' OR (j.intentos>=j.max_intentos AND
            (j.estado='EN_COLA' OR (j.estado='EN_EJECUCION' AND j.bloqueo_hasta<=clock_timestamp()))))
          AND c.estado_tecnico IN ('PENDIENTE_VERIFICACION','ERROR_VERIFICACION')
          AND NOT coalesce(j.detalle_solicitud ? 'reintento_beta',false)
        ORDER BY j.creado_en,j.trabajo_id LIMIT 50 FOR UPDATE OF j SKIP LOCKED
      );
    END IF;$s$);
  src := replace(src,$s$ELSIF p_operacion IN ('carga.publicar','carga.rechazar') THEN$s$,
    $s$ELSIF p_operacion IN ('carga.publicar','carga.publicar_beta','carga.rechazar') THEN$s$);
  src := replace(src,$s$(p_datos->>'antimalware_apto')::boolean IS TRUE AND v_doc.retirado_en IS NULL$s$,
    $s$(CASE WHEN p_operacion='carga.publicar_beta'
      THEN kvg_privado.beta_documental_activa() AND NOT (p_datos ?| ARRAY['antimalware_apto','motor_version'])
      ELSE (p_datos->>'antimalware_apto')::boolean IS TRUE END)
      AND v_carga.estado_tecnico IN ('PENDIENTE_VERIFICACION','ERROR_VERIFICACION') AND v_doc.retirado_en IS NULL$s$);
  src := replace(src,$s$resultado_tecnico_codigo = 'SEGURO',
               motor_version = p_datos->>'motor_version',verificado_en = clock_timestamp() WHERE carga_id = v_carga.carga_id;$s$,
    $s$resultado_tecnico_codigo = CASE WHEN p_operacion='carga.publicar_beta' THEN 'BETA_SIN_ANTIMALWARE' ELSE 'SEGURO' END,
      motor_version = p_datos->>'motor_version',
      verificado_en = CASE WHEN p_operacion<>'carga.publicar_beta' THEN clock_timestamp() END
      WHERE carga_id = v_carga.carga_id;$s$);
  src := replace(src,$s$THEN 'CONTENIDO_RECHAZADO' ELSE 'OPERACION_VERIFICADA' END$s$,
    $s$THEN 'CONTENIDO_RECHAZADO' WHEN p_operacion='carga.publicar_beta'
      THEN 'BETA_SIN_ANTIMALWARE' ELSE 'OPERACION_VERIFICADA' END$s$);
  src := replace(src,$s$IF p_operacion = 'entrega.autorizar' THEN$s$,
    $s$IF p_operacion = 'entrega.autorizar' THEN
      PERFORM kvg_privado.exigir(kvg_privado.carga_descargable(v_version.carga_id));$s$);
  src := replace(src,$s$'vigencia_maxima_segundos',60);$s$,
    $s$'vigencia_maxima_segundos',60,'sin_antimalware',EXISTS (SELECT 1 FROM kvg.carga_archivo
      WHERE carga_id=v_version.carga_id AND resultado_tecnico_codigo='BETA_SIN_ANTIMALWARE'));$s$);
  IF strpos(src,$s$THEN 'BETA_SIN_ANTIMALWARE' ELSE 'SEGURO'$s$)=0
    OR strpos(src,$s$'sin_antimalware',EXISTS$s$)=0 THEN
    RAISE EXCEPTION 'No se pudo conservar la distinción entre beta y verificación.';
  END IF;
  EXECUTE 'CREATE OR REPLACE FUNCTION public.kvg_trabajar(p_operacion text,p_datos jsonb DEFAULT ''{}'') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);

  SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='public.kvg_operar(text,jsonb)'::regprocedure;
  IF strpos(src,$s$ELSIF p_operacion = 'documento.carga'$s$)=0 THEN RAISE EXCEPTION 'Contrato documental no reconocido.'; END IF;
  src := replace(src,$s$ELSIF p_operacion = 'documento.carga'$s$,$s$
    IF jsonb_typeof(v_salida->'version')='object' THEN
      v_salida := jsonb_set(v_salida,'{version,sin_antimalware}',to_jsonb(EXISTS (
        SELECT 1 FROM kvg.carga_archivo c
        WHERE c.carga_id=(v_salida#>>'{version,carga_id}')::uuid
          AND c.resultado_tecnico_codigo='BETA_SIN_ANTIMALWARE')));
    END IF;
  ELSIF p_operacion = 'documento.carga'$s$);
  EXECUTE 'CREATE OR REPLACE FUNCTION public.kvg_operar(p_operacion text,p_datos jsonb DEFAULT ''{}'') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);
END;
$patch$;
COMMIT;
