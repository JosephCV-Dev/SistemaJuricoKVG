-- CU008/012/013: estado de recepción ligado al usuario y arrendamiento exclusivo
-- de cargas. No amplía permisos, Storage ni acceso a tablas. Baseline intacta.
BEGIN;
CREATE FUNCTION kvg_privado.consultar_carga(p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE c kvg.carga_archivo; v kvg.version_documento;
BEGIN
  PERFORM kvg_privado.validar_campos(p_datos,ARRAY['carga_id']);
  SELECT * INTO c FROM kvg.carga_archivo WHERE carga_id=(p_datos->>'carga_id')::uuid;
  PERFORM kvg_privado.exigir(c.solicitado_por=kvg_privado.usuario_actual()
    AND kvg_privado.puede_documento('documento.cargar',c.documento_id));
  SELECT * INTO v FROM kvg.version_documento WHERE carga_id=c.carga_id;
  RETURN jsonb_build_object('carga_id',c.carga_id,'documento_id',c.documento_id,
    'expediente_id',c.expediente_destino_id,'estado',c.estado_tecnico,
    'version_id',v.version_id,'resultado',c.resultado_tecnico_codigo);
END;
$f$;
REVOKE ALL ON FUNCTION kvg_privado.consultar_carga(jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE src text;
BEGIN
 SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='public.kvg_operar(text,jsonb)'::regprocedure;
 IF position('ELSIF p_operacion LIKE ''documento.%''' IN src)=0 THEN RAISE EXCEPTION 'Dispatcher no reconocido'; END IF;
 src:=replace(src,'ELSIF p_operacion LIKE ''documento.%''',
 'ELSIF p_operacion = ''documento.carga'' THEN v_salida := kvg_privado.consultar_carga(p_datos);
 ELSIF p_operacion LIKE ''documento.%''');
 EXECUTE 'CREATE OR REPLACE FUNCTION public.kvg_operar(p_operacion text,p_datos jsonb DEFAULT ''{}'') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);
 SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='public.kvg_trabajar(text,jsonb)'::regprocedure;
 IF position('IF p_operacion = ''trabajo.estado''' IN src)=0 THEN RAISE EXCEPTION 'Trabajador no reconocido'; END IF;
 src:=replace(src,'IF p_operacion = ''trabajo.estado''',
 'IF p_operacion = ''trabajo.tomar_carga'' THEN
    PERFORM kvg_privado.validar_campos(p_datos,ARRAY[]::text[]);
    UPDATE kvg.trabajo_operativo SET estado=''FALLIDO'',finalizado_en=clock_timestamp(),resultado_codigo=''INTENTOS_AGOTADOS''
    WHERE tipo IN (''VERIFICAR_CARGA'',''CONCILIAR_CARGA'') AND intentos>=max_intentos
      AND (estado=''EN_COLA'' OR estado=''EN_EJECUCION'' AND bloqueo_hasta<=clock_timestamp());
    SELECT t.* INTO v_trabajo FROM kvg.trabajo_operativo t JOIN kvg.carga_archivo c ON c.carga_id=t.objetivo_id
    WHERE t.tipo IN (''VERIFICAR_CARGA'',''CONCILIAR_CARGA'') AND c.estado_tecnico IN (''PENDIENTE_VERIFICACION'',''ERROR_VERIFICACION'')
      AND t.proximo_intento_en<=clock_timestamp() AND t.intentos<t.max_intentos
      AND (t.estado=''EN_COLA'' OR t.estado=''EN_EJECUCION'' AND t.bloqueo_hasta<=clock_timestamp())
    ORDER BY t.creado_en,t.trabajo_id FOR UPDATE OF t SKIP LOCKED LIMIT 1;
    IF NOT FOUND THEN RETURN ''{}''::jsonb; END IF;
    v_token:=encode(extensions.gen_random_bytes(32),''hex'');
    UPDATE kvg.trabajo_operativo SET estado=''EN_EJECUCION'',intentos=intentos+1,ejecutor_codigo=v_token,
      bloqueo_hasta=clock_timestamp()+interval ''5 minutes'' WHERE trabajo_id=v_trabajo.trabajo_id RETURNING * INTO v_trabajo;
    RETURN to_jsonb(v_trabajo)-''detalle_solicitud'';
 ELSIF p_operacion = ''trabajo.estado''');
 EXECUTE 'CREATE OR REPLACE FUNCTION public.kvg_trabajar(p_operacion text,p_datos jsonb DEFAULT ''{}'') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);
END;
$patch$;
COMMIT;
