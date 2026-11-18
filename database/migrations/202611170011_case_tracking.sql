-- CU006/CU017: transiciones autorizadas y seguimiento acumulativo.
BEGIN;
ALTER TABLE kvg_privado.solicitud_creacion DROP CONSTRAINT solicitud_creacion_operacion_check;
ALTER TABLE kvg_privado.solicitud_creacion ADD CONSTRAINT solicitud_creacion_operacion_check
  CHECK (operacion IN ('cliente.registrar','expediente.crear','expediente.avanzar'));

CREATE FUNCTION kvg_privado.matriz_estado_expediente()
RETURNS TABLE(origen text,destino text,permiso text,juridica boolean)
LANGUAGE sql IMMUTABLE SET search_path='' AS $f$
  VALUES ('NUEVO','EN_PROCESO','expediente.iniciar',false),
         ('EN_PROCESO','PENDIENTE','expediente.suspender',false),
         ('PENDIENTE','EN_PROCESO','expediente.reanudar',false),
         ('EN_PROCESO','CONCLUIDO','expediente.concluir',true),
         ('PENDIENTE','CONCLUIDO','expediente.concluir',true),
         ('CONCLUIDO','ARCHIVADO','expediente.archivar',false),
         ('CONCLUIDO','EN_PROCESO','expediente.reabrir',true),
         ('ARCHIVADO','EN_PROCESO','expediente.reabrir',true);
$f$;

CREATE FUNCTION kvg_privado.principal_expediente(p_id uuid)
RETURNS uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $f$
  SELECT a.abogado_id FROM kvg.asignacion_expediente a
  WHERE a.expediente_id=p_id AND a.funcion='PRINCIPAL'
    AND a.inicia_en<=clock_timestamp() AND (a.finaliza_en IS NULL OR a.finaliza_en>clock_timestamp())
    AND kvg_privado.rol_vigente(a.abogado_id,'ABOGADO');
$f$;

CREATE FUNCTION kvg_privado.transiciones_expediente(p_id uuid,p_estado text)
RETURNS TABLE(destino text,juridica boolean)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $f$
  SELECT m.destino,m.juridica FROM kvg_privado.matriz_estado_expediente() m
  CROSS JOIN LATERAL (SELECT kvg_privado.principal_expediente(p_id) AS principal) j
  WHERE m.origen=p_estado AND kvg_privado.puede_expediente(m.permiso,p_id)
    AND (NOT m.juridica OR j.principal=kvg_privado.usuario_actual())
    AND (m.destino NOT IN ('EN_PROCESO','PENDIENTE') OR j.principal IS NOT NULL);
$f$;

CREATE FUNCTION kvg_privado.puede_registrar_avance(p_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $f$
  SELECT kvg_privado.rol_vigente(kvg_privado.usuario_actual(),'ABOGADO')
    AND kvg_privado.puede_expediente('expediente.consultar',p_id)
    AND kvg_privado.puede_expediente('expediente.avanzar',p_id);
$f$;

CREATE FUNCTION kvg_privado.mutar_seguimiento_expediente(p_operacion text,p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE id uuid := (p_datos->>'expediente_id')::uuid; actor uuid := kvg_privado.usuario_actual();
  caso kvg.expediente; juridica boolean; v_destino text := p_datos->>'estado';
  solicitud uuid; previa kvg_privado.solicitud_creacion; huella text; avance uuid; version jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('kvg:seguridad',0));
  PERFORM kvg_privado.exigir(kvg_privado.puede_expediente('expediente.consultar',id));
  SELECT * INTO caso FROM kvg.expediente e WHERE e.expediente_id=id FOR UPDATE;
  PERFORM kvg_privado.exigir(kvg_privado.puede_expediente('expediente.consultar',id));
  IF p_operacion='expediente.cambiar_estado' THEN
    PERFORM kvg_privado.validar_campos(p_datos,ARRAY['expediente_id','revision','estado','motivo','referencia_autorizacion']);
    PERFORM kvg_privado.exigir_revision(caso.revision,(p_datos->>'revision')::integer);
    IF NOT EXISTS (SELECT 1 FROM kvg_privado.matriz_estado_expediente() m
      WHERE m.origen=caso.estado_expediente_codigo AND m.destino=v_destino)
      OR jsonb_typeof(p_datos->'motivo') IS DISTINCT FROM 'string'
      OR coalesce(length(btrim(p_datos->>'motivo')),0) NOT BETWEEN 1 AND 2000 THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Transición o motivo inválido.';
    END IF;
    SELECT t.juridica INTO juridica FROM kvg_privado.transiciones_expediente(id,caso.estado_expediente_codigo) t
      WHERE t.destino=v_destino;
    PERFORM kvg_privado.exigir(FOUND);
    IF juridica THEN
      PERFORM kvg_privado.exigir(jsonb_typeof(p_datos->'referencia_autorizacion')='string'
        AND length(btrim(p_datos->>'referencia_autorizacion')) BETWEEN 1 AND 512);
    ELSIF p_datos ? 'referencia_autorizacion' THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Referencia fuera de la transición.';
    END IF;
    UPDATE kvg.expediente SET estado_expediente_codigo=v_destino WHERE expediente_id=id RETURNING revision INTO caso.revision;
    INSERT INTO kvg.historial_estado_expediente (expediente_id,estado_origen_codigo,estado_destino_codigo,
      motivo,registrado_por,decidido_por,referencia_autorizacion,revision_resultante)
    VALUES (id,caso.estado_expediente_codigo,v_destino,btrim(p_datos->>'motivo'),actor,
      CASE WHEN juridica THEN actor END,btrim(p_datos->>'referencia_autorizacion'),caso.revision);
    RETURN jsonb_build_object('expediente_id',id,'estado',v_destino,'revision',caso.revision);
  ELSIF p_operacion='expediente.avanzar' THEN
    PERFORM kvg_privado.validar_campos(p_datos,ARRAY['expediente_id','descripcion','corrige_avance_id','fecha_hecho','procedencia','versiones','solicitud_id']);
    PERFORM kvg_privado.exigir(kvg_privado.puede_registrar_avance(id));
    IF p_datos ? 'solicitud_id' THEN
      solicitud := (p_datos->>'solicitud_id')::uuid;
      IF solicitud IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Solicitud inválida.'; END IF;
      huella := encode(extensions.digest((p_datos-'solicitud_id')::text,'sha256'),'hex');
      SELECT * INTO previa FROM kvg_privado.solicitud_creacion s
        WHERE s.usuario_id=actor AND s.operacion=p_operacion AND s.solicitud_id=solicitud;
      IF FOUND THEN
        IF previa.contenido_sha256<>huella THEN
          RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='Solicitud reutilizada.';
        END IF;
        RETURN jsonb_build_object('avance_id',previa.recurso_id);
      END IF;
    END IF;
    PERFORM kvg_privado.exigir_editable(id);
    IF jsonb_typeof(p_datos->'descripcion') IS DISTINCT FROM 'string'
      OR coalesce(length(btrim(p_datos->>'descripcion')),0) NOT BETWEEN 1 AND 4000
      OR (p_datos->>'fecha_hecho' IS NOT NULL AND coalesce(length(btrim(p_datos->>'procedencia')),0) NOT BETWEEN 1 AND 512)
      OR (p_datos ? 'corrige_avance_id' AND NOT EXISTS
        (SELECT 1 FROM kvg.avance_expediente a WHERE a.expediente_id=id AND a.avance_id=(p_datos->>'corrige_avance_id')::uuid)) THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Datos de avance inválidos.';
    END IF;
    IF p_datos ? 'versiones' AND
      (jsonb_typeof(p_datos->'versiones')<>'array' OR jsonb_array_length(p_datos->'versiones')>50) THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Colección inválida.';
    END IF;
    INSERT INTO kvg.avance_expediente (expediente_id,descripcion,autor_id,corrige_avance_id,fecha_hecho,procedencia)
      VALUES (id,btrim(p_datos->>'descripcion'),actor,(p_datos->>'corrige_avance_id')::uuid,
        (p_datos->>'fecha_hecho')::date,btrim(p_datos->>'procedencia')) RETURNING avance_id INTO avance;
    FOR version IN SELECT value FROM jsonb_array_elements(p_datos->'versiones') LOOP
      PERFORM kvg_privado.validar_campos(version,ARRAY['version_id','nota']);
      PERFORM kvg_privado.exigir(kvg_privado.puede_version('documento.consultar',(version->>'version_id')::uuid)
        AND EXISTS (SELECT 1 FROM kvg.version_documento v JOIN kvg.documento d USING(documento_id)
          WHERE v.version_id=(version->>'version_id')::uuid AND d.expediente_id=id));
      INSERT INTO kvg.avance_version VALUES (avance,(version->>'version_id')::uuid,version->>'nota');
    END LOOP;
    IF solicitud IS NOT NULL THEN
      INSERT INTO kvg_privado.solicitud_creacion(usuario_id,operacion,solicitud_id,contenido_sha256,recurso_id)
        VALUES(actor,p_operacion,solicitud,huella,avance);
    END IF;
    RETURN jsonb_build_object('avance_id',avance);
  END IF;
  RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Operación de seguimiento no admitida.';
END;
$f$;

CREATE FUNCTION kvg_privado.referencias_avance(p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE id uuid := (p_datos->>'expediente_id')::uuid; salida jsonb;
BEGIN
  PERFORM kvg_privado.validar_campos(p_datos,ARRAY['expediente_id','texto','limite','desplazamiento']);
  PERFORM kvg_privado.exigir(kvg_privado.puede_registrar_avance(id));
  PERFORM kvg_privado.exigir_editable(id);
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.nombre,q.documento_id,q.numero_version DESC),'[]') INTO salida
  FROM (SELECT v.version_id,d.documento_id,d.nombre,v.numero_version
    FROM kvg.documento d JOIN kvg.version_documento v USING(documento_id)
    WHERE d.expediente_id=id AND kvg_privado.puede_version('documento.consultar',v.version_id)
      AND (nullif(btrim(p_datos->>'texto'),'') IS NULL
        OR strpos(lower(d.nombre),lower(left(btrim(p_datos->>'texto'),200)))>0)
    ORDER BY d.nombre,d.documento_id,v.numero_version DESC
    LIMIT least(greatest(coalesce((p_datos->>'limite')::integer,20),1),51)
    OFFSET least(greatest(coalesce((p_datos->>'desplazamiento')::integer,0),0),10000)) q;
  RETURN salida;
END;
$f$;

REVOKE ALL ON FUNCTION kvg_privado.matriz_estado_expediente(),kvg_privado.principal_expediente(uuid),
  kvg_privado.transiciones_expediente(uuid,text),kvg_privado.puede_registrar_avance(uuid),
  kvg_privado.mutar_seguimiento_expediente(text,jsonb),kvg_privado.referencias_avance(jsonb)
  FROM PUBLIC,anon,authenticated,service_role,kvg_session_store;

DO $patch$
DECLARE src text; inicio integer; ultimo integer; anterior text; nuevo text;
BEGIN
  SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='kvg_privado.expedientes(text,jsonb)'::regprocedure;
  inicio := strpos(src,$s$    ELSIF p_operacion = 'expediente.cambiar_estado' THEN$s$);
  ultimo := strpos(src,$s$    END IF;
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Operación de expediente no admitida.';$s$);
  IF inicio=0 OR ultimo<=inicio THEN RAISE EXCEPTION 'Contrato de seguimiento no reconocido.'; END IF;
  src := left(src,inicio-1) || $s$    ELSIF p_operacion IN ('expediente.cambiar_estado','expediente.avanzar') THEN
        RETURN kvg_privado.mutar_seguimiento_expediente(p_operacion,p_datos);
    ELSIF p_operacion='expediente.referencias_avance' THEN
        RETURN kvg_privado.referencias_avance(p_datos);
$s$ || substr(src,ultimo);
  -- El helper de seguimiento adquiere primero el bloqueo de seguridad y luego el del expediente.
  src := replace(src,$s$'expediente.reasignar','expediente.cambiar_estado') THEN$s$,
    $s$'expediente.reasignar') THEN$s$);

  FOR anterior,nuevo IN SELECT * FROM (VALUES
    ($old$'historial_estados',coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.revision_resultante) FROM kvg.historial_estado_expediente h WHERE h.expediente_id = e.expediente_id),'[]'))$old$,
     $new$'principal_activo',kvg_privado.principal_expediente(e.expediente_id) IS NOT NULL,
              'transiciones',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.destino)
                FROM kvg_privado.transiciones_expediente(e.expediente_id,e.estado_expediente_codigo) t),'[]'),
              'puede_avanzar',e.estado_expediente_codigo IN ('NUEVO','EN_PROCESO','PENDIENTE')
                AND kvg_privado.puede_registrar_avance(e.expediente_id),
              'historial_estados',coalesce((SELECT jsonb_agg(to_jsonb(h) || jsonb_build_object('nombre_autor',u.nombre)
                ORDER BY h.revision_resultante) FROM kvg.historial_estado_expediente h
                JOIN kvg.usuario u ON u.usuario_id=h.registrado_por WHERE h.expediente_id=e.expediente_id),'[]'))$new$),
    ($old$'avances',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.registrado_en DESC) FROM kvg.avance_expediente a WHERE a.expediente_id = e.expediente_id),'[]'),$old$,
     $new$'avances',coalesce((SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object('nombre_autor',u.nombre,
                'referencias',coalesce((SELECT jsonb_agg(jsonb_build_object('version_id',v.version_id,'documento_id',d.documento_id,
                  'nombre',d.nombre,'numero_version',v.numero_version) ORDER BY d.nombre,v.numero_version)
                  FROM kvg.avance_version r JOIN kvg.version_documento v USING(version_id)
                  JOIN kvg.documento d USING(documento_id) WHERE r.avance_id=a.avance_id AND d.expediente_id=a.expediente_id
                    AND kvg_privado.puede_version('documento.consultar',v.version_id)),'[]'))
                ORDER BY a.registrado_en DESC,a.avance_id) FROM kvg.avance_expediente a
                JOIN kvg.usuario u ON u.usuario_id=a.autor_id WHERE a.expediente_id=e.expediente_id),'[]'),$new$)
  ) AS cambios(anterior,nuevo) LOOP
    IF strpos(src,anterior)=0 THEN RAISE EXCEPTION 'Contrato de detalle no reconocido.'; END IF;
    src:=replace(src,anterior,nuevo);
  END LOOP;
  EXECUTE 'CREATE OR REPLACE FUNCTION kvg_privado.expedientes(p_operacion text,p_datos jsonb) '
    ||'RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);
END;
$patch$;
COMMIT;
