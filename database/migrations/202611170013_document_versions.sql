-- CU014/CU029: edición auditada de nombre, publicación y consulta por versión.
BEGIN;

CREATE TABLE kvg.historial_nombre_documento (
  documento_id uuid NOT NULL REFERENCES kvg.documento(documento_id),
  revision_resultante integer NOT NULL CHECK (revision_resultante > 1),
  nombre_anterior kvg.texto_200 NOT NULL,
  nombre_nuevo kvg.texto_200 NOT NULL,
  motivo kvg.texto_2000 NOT NULL,
  registrado_por uuid NOT NULL REFERENCES kvg.usuario(usuario_id),
  registrado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (documento_id,revision_resultante),
  CHECK (nombre_anterior <> nombre_nuevo)
);
ALTER TABLE kvg.historial_nombre_documento ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON kvg.historial_nombre_documento FROM PUBLIC,anon,authenticated,service_role,kvg_session_store;
CREATE TRIGGER tr_historial_inmutable BEFORE UPDATE OR DELETE ON kvg.historial_nombre_documento
  FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();

CREATE FUNCTION kvg_privado.documento_editable_cu014(p_id uuid,p_publicar boolean)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $f$
  SELECT EXISTS (
    SELECT 1 FROM kvg.documento d JOIN kvg.expediente e USING(expediente_id)
    JOIN kvg.version_documento v ON v.version_id=d.version_vigente_id
    WHERE d.documento_id=p_id AND e.estado_expediente_codigo IN ('NUEVO','EN_PROCESO','PENDIENTE')
      AND kvg_privado.puede_documento('documento.consultar',p_id)
      AND kvg_privado.puede_documento('documento.actualizar',p_id)
      AND CASE WHEN p_publicar THEN kvg_privado.puede_documento('documento.cargar',p_id)
               ELSE kvg_privado.carga_descargable(v.carga_id)
                    AND v.estado_documento_codigo IN ('RECIBIDO','EN_REVISION') END);
$f$;

CREATE FUNCTION kvg_privado.actualizar_nombre_documento(p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE id uuid := (p_datos->>'documento_id')::uuid; d kvg.documento;
  nuevo text := btrim(p_datos->>'nombre'); razon text := btrim(p_datos->>'motivo');
  revision_nueva integer;
BEGIN
  PERFORM kvg_privado.validar_campos(p_datos,ARRAY['documento_id','revision','nombre','motivo']);
  IF jsonb_typeof(p_datos->'nombre') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_datos->'motivo') IS DISTINCT FROM 'string'
     OR length(nuevo)>200 OR length(razon)>2000
     OR nuevo !~ '[^[:space:]]' OR razon !~ '[^[:space:]]'
     OR nuevo ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Indica el nombre y el motivo del cambio.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('kvg:seguridad',0));
  PERFORM kvg_privado.exigir(kvg_privado.puede_documento('documento.consultar',id)
    AND kvg_privado.puede_documento('documento.actualizar',id));
  SELECT * INTO d FROM kvg.documento WHERE documento_id=id FOR UPDATE;
  PERFORM kvg_privado.exigir_revision(d.revision,(p_datos->>'revision')::integer);
  PERFORM kvg_privado.exigir(kvg_privado.documento_editable_cu014(id,false));
  IF nuevo=d.nombre THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='El nombre ya está registrado.';
  END IF;
  UPDATE kvg.documento SET nombre=nuevo WHERE documento_id=id RETURNING revision INTO revision_nueva;
  INSERT INTO kvg.historial_nombre_documento
    (documento_id,revision_resultante,nombre_anterior,nombre_nuevo,motivo,registrado_por)
    VALUES (id,revision_nueva,d.nombre,nuevo,razon,kvg_privado.usuario_actual());
  PERFORM kvg_privado.auditar('DOCUMENTO_METADATOS_ACTUALIZADOS','DOCUMENTO',id,'EXITO',
    jsonb_build_object('campos',jsonb_build_array('nombre'),'revision',revision_nueva));
  RETURN jsonb_build_object('documento_id',id,'expediente_id',d.expediente_id,'revision',revision_nueva);
END;
$f$;

CREATE FUNCTION kvg_privado.versiones_documento(p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE id uuid := (p_datos->>'documento_id')::uuid; salida jsonb;
BEGIN
  PERFORM kvg_privado.validar_campos(p_datos,ARRAY['documento_id','limite','desplazamiento']);
  PERFORM kvg_privado.exigir(kvg_privado.puede_documento('documento.consultar',id)
    AND kvg_privado.puede_documento('documento.versiones',id));
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.numero_version DESC),'[]') INTO salida
  FROM (
    SELECT v.version_id,v.documento_id,v.numero_version,v.sha256,v.tamano_bytes,v.formato,
      v.estado_documento_codigo,v.publicado_en,v.fecha_origen,v.procedencia,v.revision,
      u.nombre AS autor,c.motivo_version AS motivo,d.version_vigente_id=v.version_id AS vigente,
      c.resultado_tecnico_codigo='BETA_SIN_ANTIMALWARE' AS sin_antimalware,
      kvg_privado.puede_version('documento.descargar',v.version_id) AS puede_descargar,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.revision_juridica_id,'resultado',r.resultado,
        'fecha',r.registrado_en,'autor',revisor.nombre) ORDER BY r.registrado_en,r.revision_juridica_id)
        FROM kvg.revision_documento r JOIN kvg.usuario revisor ON revisor.usuario_id=r.revisor_id
        WHERE r.version_id=v.version_id),'[]') AS revisiones
    FROM kvg.version_documento v JOIN kvg.documento d USING(documento_id)
    JOIN kvg.carga_archivo c USING(carga_id)
    JOIN kvg.usuario u ON u.usuario_id=c.solicitado_por
    WHERE v.documento_id=id AND kvg_privado.puede_version('documento.versiones',v.version_id)
    ORDER BY v.numero_version DESC LIMIT least(greatest(coalesce((p_datos->>'limite')::integer,25),1),100)
    OFFSET least(greatest(coalesce((p_datos->>'desplazamiento')::integer,0),0),10000)
  ) q;
  PERFORM kvg_privado.auditar('DOCUMENTO_VERSIONES','DOCUMENTO',id);
  RETURN salida;
END;
$f$;

REVOKE ALL ON FUNCTION kvg_privado.documento_editable_cu014(uuid,boolean),
  kvg_privado.actualizar_nombre_documento(jsonb), kvg_privado.versiones_documento(jsonb)
  FROM PUBLIC,anon,authenticated,service_role,kvg_session_store;

DO $patch$
DECLARE src text; inicio integer; fin integer;
BEGIN
  SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='kvg_privado.documento_organizable(uuid,text)'::regprocedure;
  IF strpos(src,$s$WHERE c.documento_id=p_documento
        AND (c.estado_tecnico='RECIBIENDO' OR$s$)=0 THEN
    RAISE EXCEPTION 'Contrato de organización documental no reconocido.';
  END IF;
  -- Las reservas de versión sin bytes y los intentos de revisiones superadas
  -- no inmovilizan la clasificación o el traslado de la versión vigente.
  src := replace(src,$s$WHERE c.documento_id=p_documento
        AND (c.estado_tecnico='RECIBIENDO' OR$s$,$s$WHERE c.documento_id=p_documento
        AND c.revision_documento_base=d.revision
        AND ((c.estado_tecnico='RECIBIENDO' AND c.revision_documento_base=1) OR$s$);
  EXECUTE 'CREATE OR REPLACE FUNCTION kvg_privado.documento_organizable(p_documento uuid,p_permiso text) '
    ||'RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);

  SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='kvg_privado.documentos(text,jsonb)'::regprocedure;
  IF strpos(src,$s$IF p_operacion = 'documento.cargar' THEN$s$)=0
    OR strpos(src,$s$        PERFORM kvg_privado.exigir(p_datos->>'clave_idempotencia' IS NOT NULL);$s$)=0
    OR strpos(src,$s$              AND v_carga.nombre_original = p_datos->>'nombre_original'$s$)=0
    OR strpos(src,$s$            PERFORM kvg_privado.exigir(kvg_privado.puede_documento('documento.actualizar',v_id));$s$)=0 THEN
    RAISE EXCEPTION 'Contrato de alta documental no reconocido.';
  END IF;
  src := replace(src,$s$IF p_operacion = 'documento.cargar' THEN$s$,$s$IF p_operacion='documento.actualizar' THEN
        RETURN kvg_privado.actualizar_nombre_documento(p_datos);
    ELSIF p_operacion='documento.versiones' THEN
        RETURN kvg_privado.versiones_documento(p_datos);
    ELSIF p_operacion = 'documento.cargar' THEN$s$);
  src := replace(src,$s$        PERFORM kvg_privado.exigir(p_datos->>'clave_idempotencia' IS NOT NULL);$s$,$s$
        IF p_datos->>'documento_id' IS NOT NULL THEN
            PERFORM kvg_privado.validar_campos(p_datos,ARRAY['documento_id','revision','nombre_original','clave_idempotencia','motivo']);
            IF jsonb_typeof(p_datos->'motivo') IS DISTINCT FROM 'string'
               OR (p_datos->>'motivo') !~ '[^[:space:]]' OR length(p_datos->>'motivo')>2000
               OR jsonb_typeof(p_datos->'nombre_original') IS DISTINCT FROM 'string'
               OR length(p_datos->>'nombre_original')>255 OR strpos(p_datos->>'nombre_original',chr(92))>0
               OR (p_datos->>'nombre_original') !~* '^[^[:cntrl:]/]+[.](pdf|docx|jpe?g|png)$'
               OR jsonb_typeof(p_datos->'revision') IS DISTINCT FROM 'number' THEN
                RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Datos de versión inválidos.';
            END IF;
            PERFORM pg_advisory_xact_lock(hashtextextended('kvg:seguridad',0));
        END IF;
        PERFORM kvg_privado.exigir(p_datos->>'clave_idempotencia' IS NOT NULL);$s$);
  -- La carga inicial siempre parte de revisión 1. Publicarla incrementa la revisión del documento.
  src := replace(src,$s$              AND v_carga.nombre_original = p_datos->>'nombre_original'$s$,$s$
              AND (CASE WHEN p_datos->>'documento_id' IS NULL THEN v_carga.revision_documento_base=1
                       ELSE v_carga.revision_documento_base>1
                         AND v_carga.revision_documento_base=(p_datos->>'revision')::integer
                         AND kvg_privado.puede_documento('documento.consultar',v_carga.documento_id)
                         AND kvg_privado.puede_documento('documento.actualizar',v_carga.documento_id) END)
              AND v_carga.nombre_original = p_datos->>'nombre_original'$s$);
  inicio := strpos(src,$s$            PERFORM kvg_privado.exigir(kvg_privado.puede_documento('documento.actualizar',v_id));$s$);
  fin := strpos(src,$s$        INSERT INTO kvg.carga_archivo$s$);
  IF fin<=inicio THEN RAISE EXCEPTION 'Contrato de carga por revisión no reconocido.'; END IF;
  src := left(src,inicio-1)||$s$
            PERFORM kvg_privado.exigir(kvg_privado.puede_documento('documento.consultar',v_id)
                AND kvg_privado.puede_documento('documento.actualizar',v_id)
                AND kvg_privado.puede_documento('documento.cargar',v_id));
            SELECT * INTO v_doc FROM kvg.documento WHERE documento_id = v_id FOR UPDATE;
            PERFORM kvg_privado.exigir_revision(v_doc.revision,(p_datos->>'revision')::integer);
            PERFORM kvg_privado.exigir(kvg_privado.documento_editable_cu014(v_id,true));
        END IF;
$s$||substr(src,fin);
  EXECUTE 'CREATE OR REPLACE FUNCTION kvg_privado.documentos(p_operacion text,p_datos jsonb) '
    ||'RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);

  SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='kvg_privado.consultar_carga(jsonb)'::regprocedure;
  IF strpos(src,$s$AND kvg_privado.puede_documento('documento.cargar',c.documento_id));$s$)=0 THEN
    RAISE EXCEPTION 'Contrato de consulta de carga no reconocido.';
  END IF;
  src := replace(src,$s$AND kvg_privado.puede_documento('documento.cargar',c.documento_id));$s$,$s$
    AND kvg_privado.puede_documento('documento.cargar',c.documento_id)
    AND (c.revision_documento_base=1 OR (
      kvg_privado.puede_documento('documento.consultar',c.documento_id)
      AND kvg_privado.puede_documento('documento.actualizar',c.documento_id))));$s$);
  EXECUTE 'CREATE OR REPLACE FUNCTION kvg_privado.consultar_carga(p_datos jsonb) '
    ||'RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);

  SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='public.kvg_operar(text,jsonb)'::regprocedure;
  IF strpos(src,$s$    PERFORM kvg_privado.exigir(v_salida IS NOT NULL);
  ELSIF p_operacion = 'documento.carga'$s$)=0 THEN RAISE EXCEPTION 'Contrato de ficha documental no reconocido.'; END IF;
  src := replace(src,$s$    PERFORM kvg_privado.exigir(v_salida IS NOT NULL);
  ELSIF p_operacion = 'documento.carga'$s$,$s$    PERFORM kvg_privado.exigir(v_salida IS NOT NULL);
    v_salida := v_salida || jsonb_build_object(
      'puede_editar_nombre',kvg_privado.documento_editable_cu014((p_datos->>'documento_id')::uuid,false),
      'puede_subir_version',kvg_privado.documento_editable_cu014((p_datos->>'documento_id')::uuid,true),
      'puede_ver_versiones',kvg_privado.puede_documento('documento.versiones',(p_datos->>'documento_id')::uuid));
  ELSIF p_operacion = 'documento.carga'$s$);
  EXECUTE 'CREATE OR REPLACE FUNCTION public.kvg_operar(p_operacion text,p_datos jsonb DEFAULT ''{}'') '
    ||'RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);

  SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='public.kvg_trabajar(text,jsonb)'::regprocedure;
  IF strpos(src,$s$    v_trabajo := kvg_privado.arrendamiento($s$)=0
    OR strpos(src,$s$            PERFORM kvg_privado.exigir((CASE WHEN p_operacion='carga.publicar_beta'$s$)=0 THEN
    RAISE EXCEPTION 'Contrato de publicación documental no reconocido.';
  END IF;
  src := replace(src,$s$    v_trabajo := kvg_privado.arrendamiento($s$,$s$
    IF p_operacion IN ('carga.publicar','carga.publicar_beta') THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('kvg:seguridad',0));
    END IF;
    v_trabajo := kvg_privado.arrendamiento($s$);
  src := replace(src,$s$            PERFORM kvg_privado.exigir((CASE WHEN p_operacion='carga.publicar_beta'$s$,$s$
            IF v_carga.revision_documento_base>1
                AND v_carga.estado_tecnico IN ('PENDIENTE_VERIFICACION','ERROR_VERIFICACION') THEN
                v_token := CASE
                  WHEN v_doc.retirado_en IS NOT NULL OR v_carga.expediente_destino_id<>v_doc.expediente_id
                    OR NOT kvg_privado.alcance(v_carga.solicitado_por,'documento.consultar',v_doc.expediente_id)
                    OR NOT kvg_privado.alcance(v_carga.solicitado_por,'documento.actualizar',v_doc.expediente_id)
                    OR NOT kvg_privado.alcance(v_carga.solicitado_por,'documento.cargar',v_doc.expediente_id)
                    OR NOT EXISTS (SELECT 1 FROM kvg.expediente e WHERE e.expediente_id=v_doc.expediente_id
                      AND e.estado_expediente_codigo IN ('NUEVO','EN_PROCESO','PENDIENTE')
                      AND NOT kvg_privado.medida_impide(e.cliente_principal_id,e.expediente_id,v_doc.documento_id,'EDITAR'))
                    THEN 'PUBLICACION_NO_AUTORIZADA'
                  WHEN v_doc.revision<>v_carga.revision_documento_base THEN 'CONFLICTO_REVISION'
                END;
                IF v_token IS NOT NULL THEN
                    UPDATE kvg.carga_archivo SET estado_tecnico='ABANDONADO',resultado_tecnico_codigo=v_token
                      WHERE carga_id=v_carga.carga_id;
                    UPDATE kvg.trabajo_operativo SET estado='CANCELADO',finalizado_en=clock_timestamp(),
                      ejecutor_codigo=NULL,bloqueo_hasta=NULL,resultado_codigo=v_token
                      WHERE trabajo_id=v_trabajo.trabajo_id;
                    RETURN jsonb_build_object('trabajo_id',v_trabajo.trabajo_id,'estado','CANCELADO','resultado',v_token);
                END IF;
            END IF;
            PERFORM kvg_privado.exigir((CASE WHEN p_operacion='carga.publicar_beta'$s$);
  EXECUTE 'CREATE OR REPLACE FUNCTION public.kvg_trabajar(p_operacion text,p_datos jsonb DEFAULT ''{}'') '
    ||'RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);
END;
$patch$;
COMMIT;
