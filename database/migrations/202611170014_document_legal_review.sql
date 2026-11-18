-- CU016/CU026: revisión de la versión examinada y transiciones de la vigente.
BEGIN;

ALTER TABLE kvg_privado.solicitud_creacion DROP CONSTRAINT solicitud_creacion_operacion_check;
ALTER TABLE kvg_privado.solicitud_creacion ADD CONSTRAINT solicitud_creacion_operacion_check
  CHECK (operacion IN ('cliente.registrar','expediente.crear','expediente.avanzar','documento.revisar'));

CREATE FUNCTION kvg_privado.matriz_estado_documento()
RETURNS TABLE(origen text,destino text,permiso text,decision boolean,requiere_revision boolean)
LANGUAGE sql IMMUTABLE SET search_path='' AS $f$
  VALUES ('RECIBIDO','EN_REVISION','documento.iniciar_revision',false,false),
         ('EN_REVISION','RECIBIDO','documento.corregir',false,false),
         ('EN_REVISION','VALIDADO','documento.validar',true,true),
         ('VALIDADO','ARCHIVADO','documento.archivar',false,false),
         ('ARCHIVADO','VALIDADO','documento.reactivar',true,false);
$f$;

CREATE FUNCTION kvg_privado.puede_leer_revision(p_version uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $f$
  SELECT kvg_privado.rol_vigente(kvg_privado.usuario_actual(),'ABOGADO')
    AND EXISTS (SELECT 1 FROM kvg.version_documento v JOIN kvg.documento d USING(documento_id)
      WHERE v.version_id=p_version AND kvg_privado.puede_expediente('expediente.consultar',d.expediente_id)
        AND kvg_privado.puede_version('documento.consultar',p_version))
    AND (kvg_privado.puede_version('documento.revisar',p_version)
      OR kvg_privado.puede_version('documento.validar',p_version));
$f$;

CREATE FUNCTION kvg_privado.transiciones_documento(p_version uuid)
RETURNS TABLE(destino text,requiere_revision boolean)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $f$
  SELECT m.destino,m.requiere_revision FROM kvg.version_documento v
  JOIN kvg.documento d ON d.version_vigente_id=v.version_id
  JOIN kvg.expediente e ON e.expediente_id=d.expediente_id
  JOIN kvg_privado.matriz_estado_documento() m ON m.origen=v.estado_documento_codigo
  WHERE v.version_id=p_version AND e.estado_expediente_codigo IN ('NUEVO','EN_PROCESO','PENDIENTE')
    AND kvg_privado.puede_version('documento.consultar',p_version)
    AND kvg_privado.puede_version(m.permiso,p_version)
    AND (NOT m.requiere_revision OR kvg_privado.puede_leer_revision(p_version))
    AND (NOT m.decision OR kvg_privado.rol_vigente(kvg_privado.usuario_actual(),'ABOGADO'));
$f$;

CREATE FUNCTION kvg_privado.revision_documento_vigente(p_revision uuid,p_version uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $f$
  SELECT EXISTS (SELECT 1 FROM kvg.revision_documento r
    WHERE r.revision_juridica_id=p_revision AND r.version_id=p_version
      AND NOT EXISTS (SELECT 1 FROM kvg.revision_documento siguiente
        WHERE siguiente.corrige_revision_id=r.revision_juridica_id AND siguiente.version_id=p_version));
$f$;

CREATE FUNCTION kvg_privado.consultar_revision_documento(p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE doc uuid := (p_datos->>'documento_id')::uuid; version uuid := (p_datos->>'version_id')::uuid;
  cabecera jsonb; eventos jsonb; leer boolean;
BEGIN
  PERFORM kvg_privado.validar_campos(p_datos,ARRAY['documento_id','version_id','limite','desplazamiento']);
  leer := kvg_privado.puede_leer_revision(version);
  SELECT jsonb_build_object('version_id',v.version_id,'numero_version',v.numero_version,
    'vigente',d.version_vigente_id=v.version_id,'estado',v.estado_documento_codigo,'revision',v.revision,
    'puede_revisar',leer AND e.estado_expediente_codigo IN ('NUEVO','EN_PROCESO','PENDIENTE')
      AND kvg_privado.puede_version('documento.revisar',version),
    'transiciones',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.destino)
      FROM kvg_privado.transiciones_documento(version) t),'[]'))
    INTO cabecera FROM kvg.version_documento v JOIN kvg.documento d USING(documento_id)
    JOIN kvg.expediente e USING(expediente_id)
    WHERE v.version_id=version AND d.documento_id=doc AND kvg_privado.puede_version('documento.consultar',version)
      AND (d.version_vigente_id=v.version_id OR leer OR kvg_privado.puede_version('documento.versiones',version));
  PERFORM kvg_privado.exigir(cabecera IS NOT NULL);

  SELECT coalesce(jsonb_agg(q.datos ORDER BY q.fecha DESC,q.id),'[]') INTO eventos FROM (
    SELECT *
    FROM (
      SELECT r.registrado_en AS fecha,r.revision_juridica_id AS id,
        jsonb_build_object('tipo','revision','id',r.revision_juridica_id,'fecha',r.registrado_en,
          'autor',u.nombre,'resultado',r.resultado,'observaciones',r.observaciones,'corrige_id',r.corrige_revision_id,
          'corregida',NOT kvg_privado.revision_documento_vigente(r.revision_juridica_id,version)) AS datos
      FROM kvg.revision_documento r JOIN kvg.usuario u ON u.usuario_id=r.revisor_id
      WHERE leer AND r.version_id=version
      UNION ALL
      SELECT h.registrado_en,h.cambio_documento_id,
        jsonb_build_object('tipo','estado','id',h.cambio_documento_id,'fecha',h.registrado_en,'autor',u.nombre,
          'origen',h.estado_origen_codigo,'destino',h.estado_destino_codigo,'motivo',h.motivo,
          'revision_juridica_id',CASE WHEN leer THEN h.revision_juridica_id END)
      FROM kvg.historial_estado_documento h JOIN kvg.usuario u ON u.usuario_id=h.responsable_usuario_id
      WHERE h.version_id=version
    ) eventos_version
    ORDER BY fecha DESC,id
    LIMIT least(greatest(coalesce((p_datos->>'limite')::integer,20),1),51)
    OFFSET least(greatest(coalesce((p_datos->>'desplazamiento')::integer,0),0),10000)
  ) q;
  PERFORM kvg_privado.auditar('DOCUMENTO_REVISION_CONSULTADA','VERSION',version);
  RETURN cabecera||jsonb_build_object('eventos',eventos);
END;
$f$;

CREATE FUNCTION kvg_privado.mutar_revision_documento(p_operacion text,p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE doc uuid := (p_datos->>'documento_id')::uuid; version uuid := (p_datos->>'version_id')::uuid;
  actor uuid; d kvg.documento; v kvg.version_documento; referencia uuid; motivo text;
  estado text; requiere_revision boolean; resultado text; observaciones text;
  solicitud uuid; huella text; previa kvg_privado.solicitud_creacion; revision_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('kvg:seguridad',0));
  actor := kvg_privado.usuario_actual();
  PERFORM kvg_privado.exigir(kvg_privado.puede_documento('documento.consultar',doc));
  SELECT * INTO d FROM kvg.documento WHERE documento_id=doc FOR UPDATE;
  SELECT * INTO v FROM kvg.version_documento WHERE version_id=version AND documento_id=doc FOR UPDATE;
  PERFORM kvg_privado.exigir(v.version_id IS NOT NULL AND kvg_privado.puede_version('documento.consultar',version));
  PERFORM kvg_privado.exigir_editable(d.expediente_id);

  IF p_operacion='documento.revisar' THEN
    PERFORM kvg_privado.validar_campos(p_datos,ARRAY['documento_id','version_id','resultado','observaciones',
      'corrige_revision_id','solicitud_id']);
    PERFORM kvg_privado.exigir(kvg_privado.puede_leer_revision(version)
      AND kvg_privado.puede_version('documento.revisar',version));
    resultado := p_datos->>'resultado';
    observaciones := btrim(p_datos->>'observaciones');
    referencia := (p_datos->>'corrige_revision_id')::uuid;
    IF jsonb_typeof(p_datos->'observaciones') IS DISTINCT FROM 'string' OR length(observaciones)>4000
      OR observaciones !~ '[^[:space:]]'
      OR coalesce(resultado,'') NOT IN ('OBSERVACIONES','APTO_PARA_VALIDAR','REQUIERE_CORRECCION') THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Resultado u observaciones inválidos.';
    END IF;
    IF p_datos ? 'solicitud_id' THEN
      solicitud := (p_datos->>'solicitud_id')::uuid;
      IF solicitud IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Solicitud inválida.'; END IF;
      huella := encode(extensions.digest((p_datos-'solicitud_id')::text,'sha256'),'hex');
      SELECT * INTO previa FROM kvg_privado.solicitud_creacion
        WHERE usuario_id=actor AND operacion=p_operacion AND solicitud_id=solicitud;
      IF FOUND THEN
        IF previa.contenido_sha256<>huella THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Solicitud reutilizada.'; END IF;
        RETURN jsonb_build_object('revision_juridica_id',previa.recurso_id,'version_vigente_cambio',
          d.version_vigente_id IS DISTINCT FROM version);
      END IF;
    END IF;
    IF p_datos ? 'corrige_revision_id' AND NOT kvg_privado.revision_documento_vigente(referencia,version) THEN
      RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='La revisión para corregir cambió o pertenece a otra versión.';
    END IF;
    INSERT INTO kvg.revision_documento (version_id,revisor_id,observaciones,resultado,corrige_revision_id)
      VALUES (version,actor,observaciones,resultado,referencia) RETURNING revision_juridica_id INTO revision_id;
    IF solicitud IS NOT NULL THEN
      INSERT INTO kvg_privado.solicitud_creacion (usuario_id,operacion,solicitud_id,contenido_sha256,recurso_id)
        VALUES (actor,p_operacion,solicitud,huella,revision_id);
    END IF;
    RETURN jsonb_build_object('revision_juridica_id',revision_id,'version_vigente_cambio',
      d.version_vigente_id IS DISTINCT FROM version);
  END IF;

  PERFORM kvg_privado.validar_campos(p_datos,ARRAY['documento_id','version_id','revision','estado','motivo','revision_juridica_id']);
  IF d.version_vigente_id IS DISTINCT FROM version THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='La versión vigente cambió.';
  END IF;
  estado := p_datos->>'estado';
  motivo := btrim(p_datos->>'motivo');
  IF jsonb_typeof(p_datos->'motivo') IS DISTINCT FROM 'string' OR length(motivo)>2000 OR motivo !~ '[^[:space:]]'
    OR jsonb_typeof(p_datos->'revision') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Motivo o revisión inválidos.';
  END IF;
  PERFORM kvg_privado.exigir_revision(v.revision,(p_datos->>'revision')::integer);
  SELECT t.requiere_revision INTO requiere_revision FROM kvg_privado.transiciones_documento(version) t WHERE t.destino=estado;
  PERFORM kvg_privado.exigir(FOUND);
  IF requiere_revision THEN
    referencia := (p_datos->>'revision_juridica_id')::uuid;
    IF NOT kvg_privado.revision_documento_vigente(referencia,version) OR NOT EXISTS (
      SELECT 1 FROM kvg.revision_documento r WHERE r.revision_juridica_id=referencia AND r.resultado='APTO_PARA_VALIDAR'
    ) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Se requiere una revisión apta de la misma versión.'; END IF;
  ELSIF p_datos ? 'revision_juridica_id' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Referencia fuera de la transición.';
  ELSIF v.estado_documento_codigo='ARCHIVADO' THEN
    SELECT h.revision_juridica_id INTO referencia FROM kvg.historial_estado_documento h
      WHERE h.version_id=version AND h.estado_origen_codigo='EN_REVISION' AND h.estado_destino_codigo='VALIDADO'
      ORDER BY h.revision_resultante DESC LIMIT 1;
    PERFORM kvg_privado.exigir(referencia IS NOT NULL);
  END IF;
  UPDATE kvg.version_documento SET estado_documento_codigo=estado WHERE version_id=version RETURNING revision INTO v.revision;
  INSERT INTO kvg.historial_estado_documento (version_id,estado_origen_codigo,estado_destino_codigo,revision_juridica_id,
    responsable_usuario_id,motivo,revision_resultante) VALUES (version,v.estado_documento_codigo,estado,referencia,actor,motivo,v.revision);
  RETURN jsonb_build_object('version_id',version,'estado',estado,'revision',v.revision);
END;
$f$;

REVOKE ALL ON FUNCTION kvg_privado.matriz_estado_documento(),kvg_privado.puede_leer_revision(uuid),
  kvg_privado.transiciones_documento(uuid),kvg_privado.revision_documento_vigente(uuid,uuid),
  kvg_privado.consultar_revision_documento(jsonb),kvg_privado.mutar_revision_documento(text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role,kvg_session_store;

DO $patch$
DECLARE src text; inicio integer; fin integer;
BEGIN
  SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='kvg_privado.documentos(text,jsonb)'::regprocedure;
  inicio := strpos(src,$s$    ELSIF p_operacion = 'documento.revisar' THEN$s$);
  fin := strpos(src,$s$    ELSIF p_operacion = 'documento.retirar' THEN$s$);
  IF inicio=0 OR fin<=inicio OR strpos(src,$s$    IF p_operacion='documento.actualizar' THEN$s$)=0
    OR strpos(src,$s$WHERE r.version_id = d.version_vigente_id$s$)=0 THEN
    RAISE EXCEPTION 'Contrato de revisión documental no reconocido.';
  END IF;
  src := left(src,inicio-1)||substr(src,fin);
  src := replace(src,$s$    IF p_operacion='documento.actualizar' THEN$s$,$s$
    IF p_operacion='documento.revision' THEN
        RETURN kvg_privado.consultar_revision_documento(p_datos);
    ELSIF p_operacion IN ('documento.revisar','documento.cambiar_estado') THEN
        RETURN kvg_privado.mutar_revision_documento(p_operacion,p_datos);
    ELSIF p_operacion='documento.actualizar' THEN$s$);
  -- La ficha conserva el campo de consulta previa para las identidades jurídicas autorizadas.
  src := replace(src,$s$WHERE r.version_id = d.version_vigente_id$s$,
    $s$WHERE r.version_id = d.version_vigente_id AND kvg_privado.puede_leer_revision(r.version_id)$s$);
  src := replace(src,$s$    v_salida jsonb; v_permiso text; v_estado text; v_revision integer; v_juridica uuid; v_evento uuid;$s$,
    $s$    v_salida jsonb; v_permiso text; v_revision integer; v_evento uuid;$s$);
  src := replace(src,$s$       WHEN 'documento.revisar' THEN 'documento.revisar' WHEN 'documento.retirar' THEN 'documento.retirar'
       WHEN 'documento.cambiar_estado' THEN 'documento.consultar' END;$s$,
    $s$       WHEN 'documento.retirar' THEN 'documento.retirar' END;$s$);
  EXECUTE 'CREATE OR REPLACE FUNCTION kvg_privado.documentos(p_operacion text,p_datos jsonb) '
    ||'RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);
END;
$patch$;
COMMIT;
