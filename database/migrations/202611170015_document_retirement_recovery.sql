-- CU027/CU028: retiro lógico y recuperación con comprobación de todos los originales.
BEGIN;

CREATE FUNCTION kvg_privado.documento_retirable(p_doc uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $f$
  SELECT EXISTS (
    SELECT 1 FROM kvg.documento d JOIN kvg.expediente e USING(expediente_id)
    WHERE d.documento_id=p_doc AND d.version_vigente_id IS NOT NULL
      AND e.estado_expediente_codigo IN ('NUEVO','EN_PROCESO','PENDIENTE')
      AND kvg_privado.puede_documento('documento.consultar',p_doc)
      AND kvg_privado.puede_documento('documento.retirar',p_doc));
$f$;

CREATE FUNCTION kvg_privado.documento_recuperable(p_doc uuid,p_actor uuid,p_revision integer)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $f$
  SELECT kvg_privado.capacidad(p_actor,'documento.recuperar','GLOBAL_OPERATIVO')
    AND NOT EXISTS (SELECT 1 FROM kvg.parametro_sistema
      WHERE parametro_codigo='sistema.bloqueado' AND valor='true')
    AND EXISTS (SELECT 1 FROM kvg.documento d JOIN kvg.expediente e USING(expediente_id)
      JOIN kvg.version_documento v ON v.version_id=d.version_vigente_id AND v.documento_id=d.documento_id
      WHERE d.documento_id=p_doc AND d.retirado_en IS NOT NULL AND d.revision=p_revision
        AND NOT kvg_privado.medida_impide(e.cliente_principal_id,e.expediente_id,p_doc,'RECUPERAR'));
$f$;

CREATE FUNCTION kvg_privado.retirar_documento(p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE id uuid := (p_datos->>'documento_id')::uuid; d kvg.documento;
  motivo text := btrim(p_datos->>'motivo'); revision_nueva integer;
BEGIN
  PERFORM kvg_privado.validar_campos(p_datos,ARRAY['documento_id','revision','motivo']);
  IF jsonb_typeof(p_datos->'motivo') IS DISTINCT FROM 'string' OR length(motivo)>2000 OR motivo !~ '[^[:space:]]'
    OR jsonb_typeof(p_datos->'revision') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Motivo o revisión inválidos.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('kvg:seguridad',0));
  PERFORM kvg_privado.exigir(kvg_privado.documento_retirable(id));
  SELECT * INTO d FROM kvg.documento WHERE documento_id=id FOR UPDATE;
  PERFORM kvg_privado.exigir_revision(d.revision,(p_datos->>'revision')::integer);
  UPDATE kvg.documento SET retirado_en=clock_timestamp() WHERE documento_id=id RETURNING revision INTO revision_nueva;
  INSERT INTO kvg.evento_retiro_documento (documento_id,operacion,registrado_por,motivo,revision_resultante)
    VALUES (id,'RETIRO',kvg_privado.usuario_actual(),motivo,revision_nueva);
  PERFORM kvg_privado.restringir('RETIRAR_DOCUMENTO','DOCUMENTO',id::text,kvg_privado.usuario_actual());
  RETURN jsonb_build_object('documento_id',id,'revision',revision_nueva);
END;
$f$;

CREATE FUNCTION kvg_privado.estado_recuperacion(p_trabajo kvg.trabajo_operativo)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $f$
  SELECT jsonb_build_object('trabajo_id',p_trabajo.trabajo_id,'documento_id',p_trabajo.objetivo_id,
    'estado',p_trabajo.estado,'resultado',p_trabajo.resultado_codigo,
    'modo',p_trabajo.detalle_solicitud->>'modo_verificacion');
$f$;

CREATE FUNCTION kvg_privado.recuperacion_documentos(p_operacion text,p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE actor uuid:=kvg_privado.usuario_actual(); id uuid; d kvg.documento; t kvg.trabajo_operativo;
  motivo text:=btrim(p_datos->>'motivo'); filtro text:=btrim(coalesce(p_datos->>'texto','')); clave text;
  revision_esperada integer; salida jsonb;
BEGIN
  PERFORM kvg_privado.exigir(kvg_privado.puede_global('documento.recuperar'));
  IF p_operacion='documento.retirados' THEN
    PERFORM kvg_privado.validar_campos(p_datos,ARRAY['texto','limite','desplazamiento']);
    IF length(filtro)>40 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Filtro inválido.'; END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.retirado_en DESC,q.documento_id),'[]') INTO salida FROM (
      SELECT doc.documento_id,visible.folio_interno,doc.retirado_en,doc.revision,
        kvg_privado.documento_recuperable(doc.documento_id,actor,doc.revision) AS puede_recuperar,
        ult.estado AS estado_trabajo,ult.trabajo_id
      FROM kvg.documento doc JOIN kvg.expediente e USING(expediente_id)
      CROSS JOIN LATERAL (SELECT CASE WHEN NOT kvg_privado.medida_impide(e.cliente_principal_id,e.expediente_id,doc.documento_id,'LEER')
        THEN e.folio_interno END AS folio_interno) visible
      LEFT JOIN LATERAL (
        SELECT j.estado,j.trabajo_id FROM kvg.trabajo_operativo j WHERE j.tipo='VERIFICAR_RECUPERACION'
          AND j.objetivo_id=doc.documento_id AND j.detalle_solicitud->>'revision'=doc.revision::text
        ORDER BY j.creado_en DESC,j.trabajo_id DESC LIMIT 1
      ) ult ON true
      WHERE doc.retirado_en IS NOT NULL AND (filtro='' OR strpos(lower(visible.folio_interno),lower(filtro))>0
        OR doc.documento_id::text=lower(filtro))
      ORDER BY doc.retirado_en DESC,doc.documento_id LIMIT least(greatest(coalesce((p_datos->>'limite')::integer,20),1),51)
      OFFSET least(greatest(coalesce((p_datos->>'desplazamiento')::integer,0),0),10000)
    ) q;
    PERFORM kvg_privado.auditar('DOCUMENTOS_RETIRADOS_CONSULTADOS','DOCUMENTO',NULL);
    RETURN salida;
  ELSIF p_operacion='documento.estado_recuperacion' THEN
    PERFORM kvg_privado.validar_campos(p_datos,ARRAY['trabajo_id']);
    SELECT * INTO t FROM kvg.trabajo_operativo
      WHERE trabajo_id=(p_datos->>'trabajo_id')::uuid AND tipo='VERIFICAR_RECUPERACION';
    PERFORM kvg_privado.exigir(t.trabajo_id IS NOT NULL);
    RETURN kvg_privado.estado_recuperacion(t);
  END IF;

  PERFORM kvg_privado.validar_campos(p_datos,ARRAY['documento_id','revision','motivo','clave_idempotencia']);
  id:=(p_datos->>'documento_id')::uuid;
  clave:=p_datos->>'clave_idempotencia';
  IF jsonb_typeof(p_datos->'motivo') IS DISTINCT FROM 'string' OR length(motivo)>2000 OR motivo !~ '[^[:space:]]'
    OR jsonb_typeof(p_datos->'revision') IS DISTINCT FROM 'number' OR clave IS NULL OR length(btrim(clave)) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Datos de recuperación inválidos.';
  END IF;
  revision_esperada:=(p_datos->>'revision')::integer;
  PERFORM pg_advisory_xact_lock(hashtextextended('kvg:seguridad',0));
  PERFORM kvg_privado.exigir(kvg_privado.puede_global('documento.recuperar'));
  SELECT * INTO t FROM kvg.trabajo_operativo WHERE clave_idempotencia=clave;
  IF FOUND THEN
    PERFORM kvg_privado.exigir(t.tipo='VERIFICAR_RECUPERACION' AND t.objetivo_id=id AND t.solicitado_por=actor
      AND (t.detalle_solicitud->>'revision')::integer=revision_esperada AND t.detalle_solicitud->>'motivo'=motivo);
    RETURN kvg_privado.estado_recuperacion(t);
  END IF;

  SELECT * INTO d FROM kvg.documento WHERE documento_id=id FOR UPDATE;
  PERFORM kvg_privado.exigir(d.retirado_en IS NOT NULL);
  PERFORM kvg_privado.exigir_revision(d.revision,revision_esperada);
  PERFORM kvg_privado.exigir(kvg_privado.documento_recuperable(id,actor,d.revision));
  IF EXISTS (SELECT 1 FROM kvg.trabajo_operativo j WHERE j.tipo='VERIFICAR_RECUPERACION'
    AND j.objetivo_id=id AND j.detalle_solicitud->>'revision'=d.revision::text AND j.estado IN ('EN_COLA','EN_EJECUCION')) THEN
    RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='Ya hay una recuperación en curso.';
  END IF;
  INSERT INTO kvg.trabajo_operativo (tipo,objetivo_tipo,objetivo_id,clave_idempotencia,solicitado_por,correlacion_id,detalle_solicitud)
    VALUES ('VERIFICAR_RECUPERACION','DOCUMENTO',id,clave,actor,gen_random_uuid(),
      jsonb_build_object('revision',d.revision,'motivo',motivo))
    RETURNING * INTO t;
  PERFORM kvg_privado.auditar('DOCUMENTO_SOLICITAR_RECUPERACION','DOCUMENTO',id,'RECIBIDO');
  RETURN kvg_privado.estado_recuperacion(t);
END;
$f$;

CREATE FUNCTION kvg_privado.tomar_recuperacion()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE t kvg.trabajo_operativo;
BEGIN
  IF EXISTS (SELECT 1 FROM kvg.parametro_sistema WHERE parametro_codigo='sistema.bloqueado' AND valor='true') THEN
    RETURN '{}';
  END IF;
  UPDATE kvg.trabajo_operativo SET estado='FALLIDO',finalizado_en=clock_timestamp(),resultado_codigo='INTENTOS_AGOTADOS',
    bloqueo_hasta=NULL,ejecutor_codigo=NULL
    WHERE tipo='VERIFICAR_RECUPERACION' AND intentos>=max_intentos
      AND (estado='EN_COLA' OR (estado='EN_EJECUCION' AND bloqueo_hasta<=clock_timestamp()));
  SELECT * INTO t FROM kvg.trabajo_operativo
    WHERE tipo='VERIFICAR_RECUPERACION' AND intentos<max_intentos AND proximo_intento_en<=clock_timestamp()
      AND (estado='EN_COLA' OR (estado='EN_EJECUCION' AND bloqueo_hasta<=clock_timestamp()))
    ORDER BY creado_en,trabajo_id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN '{}'; END IF;
  UPDATE kvg.trabajo_operativo SET estado='EN_EJECUCION',intentos=intentos+1,
    ejecutor_codigo=encode(extensions.gen_random_bytes(32),'hex'),bloqueo_hasta=clock_timestamp()+interval '5 minutes'
    WHERE trabajo_id=t.trabajo_id RETURNING * INTO t;
  RETURN jsonb_build_object('trabajo_id',t.trabajo_id,'ejecutor_codigo',t.ejecutor_codigo);
END;
$f$;

CREATE FUNCTION kvg_privado.originales_recuperacion(p_trabajo kvg.trabajo_operativo)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $f$
  SELECT CASE WHEN kvg_privado.documento_recuperable(p_trabajo.objetivo_id,p_trabajo.solicitado_por,
      (p_trabajo.detalle_solicitud->>'revision')::integer) THEN
    jsonb_build_object('autorizada',true,'originales',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'version_id',v.version_id,'bucket','kvg-originales','localizador',v.localizador_objeto,
      'nombre_original',c.nombre_original,'sha256',v.sha256,'tamano_bytes',v.tamano_bytes,
      'objeto_id',o.id,'objeto_revision',o.xmin::text,'habilitado',kvg_privado.carga_descargable(v.carga_id))
      ORDER BY v.numero_version)
      FROM kvg.version_documento v JOIN kvg.carga_archivo c USING(carga_id)
      LEFT JOIN storage.objects o ON o.bucket_id='kvg-originales' AND o.name=v.localizador_objeto
      WHERE v.documento_id=p_trabajo.objetivo_id),'[]'))
    ELSE jsonb_build_object('autorizada',false) END;
$f$;

CREATE FUNCTION kvg_privado.finalizar_recuperacion(p_trabajo kvg.trabajo_operativo,p_operacion text,p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE doc_id uuid:=p_trabajo.objetivo_id; revision_nueva integer; resultado text;
  beta boolean:=p_operacion='documento.recuperar_beta'; estado_final text; verificados jsonb:=p_datos->'verificaciones';
BEGIN
  PERFORM kvg_privado.exigir(p_trabajo.tipo='VERIFICAR_RECUPERACION');
  PERFORM 1 FROM kvg.documento WHERE documento_id=doc_id FOR UPDATE;
  IF NOT kvg_privado.documento_recuperable(doc_id,p_trabajo.solicitado_por,(p_trabajo.detalle_solicitud->>'revision')::integer) THEN
    resultado:='RECUPERACION_NO_AUTORIZADA';
  ELSIF p_operacion='recuperacion.rechazar' THEN
    resultado:='ORIGINAL_NO_VERIFICABLE';
  ELSE
    PERFORM kvg_privado.exigir(NOT beta OR kvg_privado.beta_documental_activa());
    IF jsonb_typeof(verificados) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Falta la evidencia de verificación.';
    END IF;
    IF jsonb_array_length(verificados)<>(SELECT count(*) FROM kvg.version_documento v WHERE v.documento_id=doc_id)
       OR EXISTS (
         SELECT 1 FROM kvg.version_documento v
         LEFT JOIN storage.objects o ON o.bucket_id='kvg-originales' AND o.name=v.localizador_objeto
         LEFT JOIN jsonb_to_recordset(verificados) x(version_id uuid,sha256 text,tamano_bytes bigint,
           objeto_id uuid,objeto_revision text,antimalware_apto boolean)
           ON x.version_id=v.version_id AND x.sha256=v.sha256 AND x.tamano_bytes=v.tamano_bytes
           AND x.objeto_id=o.id AND x.objeto_revision=o.xmin::text
           AND CASE WHEN beta THEN x.antimalware_apto IS NULL ELSE x.antimalware_apto IS TRUE END
         WHERE v.documento_id=doc_id AND (x.version_id IS NULL OR NOT kvg_privado.carga_descargable(v.carga_id))
       ) THEN
       resultado:='ORIGINAL_NO_VERIFICABLE';
    END IF;
  END IF;

  IF resultado IS NOT NULL THEN
    estado_final:=CASE WHEN resultado='RECUPERACION_NO_AUTORIZADA' THEN 'CANCELADO' ELSE 'FALLIDO' END;
    UPDATE kvg.trabajo_operativo SET estado=estado_final,finalizado_en=clock_timestamp(),
      ejecutor_codigo=NULL,bloqueo_hasta=NULL,resultado_codigo=resultado WHERE trabajo_id=p_trabajo.trabajo_id;
    RETURN jsonb_build_object('estado',estado_final);
  END IF;

  UPDATE kvg.trabajo_operativo SET estado='COMPLETADO',finalizado_en=clock_timestamp(),resultado_codigo='INTEGRIDAD_VERIFICADA',
    ejecutor_codigo=NULL,bloqueo_hasta=NULL,
    detalle_solicitud=detalle_solicitud||jsonb_build_object('modo_verificacion',CASE WHEN beta THEN 'BETA' ELSE 'VERIFICADO' END)
    WHERE trabajo_id=p_trabajo.trabajo_id;
  UPDATE kvg.documento SET retirado_en=NULL WHERE documento_id=doc_id RETURNING revision INTO revision_nueva;
  INSERT INTO kvg.evento_retiro_documento (documento_id,operacion,registrado_por,motivo,autorizado_por,trabajo_verificacion_id,revision_resultante)
    VALUES (doc_id,'RECUPERACION',p_trabajo.solicitado_por,p_trabajo.detalle_solicitud->>'motivo',
      p_trabajo.solicitado_por,p_trabajo.trabajo_id,revision_nueva);
  PERFORM kvg_privado.restringir('RECUPERAR_DOCUMENTO','DOCUMENTO',doc_id::text,p_trabajo.solicitado_por);
  RETURN jsonb_build_object('documento_id',doc_id,'revision',revision_nueva,'estado','COMPLETADO');
END;
$f$;

REVOKE ALL ON FUNCTION kvg_privado.documento_retirable(uuid),kvg_privado.documento_recuperable(uuid,uuid,integer),
  kvg_privado.retirar_documento(jsonb),kvg_privado.estado_recuperacion(kvg.trabajo_operativo),
  kvg_privado.recuperacion_documentos(text,jsonb),kvg_privado.tomar_recuperacion(),
  kvg_privado.originales_recuperacion(kvg.trabajo_operativo),kvg_privado.finalizar_recuperacion(kvg.trabajo_operativo,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role,kvg_session_store;

DO $patch$
DECLARE src text; inicio integer; fin integer;
BEGIN
  SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='kvg_privado.documentos(text,jsonb)'::regprocedure;
  inicio:=strpos(src,$s$    ELSIF p_operacion = 'documento.recuperar' THEN$s$);
  fin:=strpos(src,$s$    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Operación documental no admitida.';$s$);
  IF inicio=0 OR fin<=inicio OR strpos(src,$s$    IF p_operacion='documento.revision' THEN$s$)=0 THEN
    RAISE EXCEPTION 'Contrato de retiro no reconocido.';
  END IF;
  src:=left(src,inicio-1)||'    END IF;'||chr(10)||substr(src,fin);
  src:=replace(src,$s$    IF p_operacion='documento.revision' THEN$s$,$s$    IF p_operacion='documento.retirar' THEN
        RETURN kvg_privado.retirar_documento(p_datos);
    ELSIF p_operacion IN ('documento.retirados','documento.recuperar','documento.estado_recuperacion') THEN
        RETURN kvg_privado.recuperacion_documentos(p_operacion,p_datos);
    ELSIF p_operacion='documento.revision' THEN$s$);
  EXECUTE 'CREATE OR REPLACE FUNCTION kvg_privado.documentos(p_operacion text,p_datos jsonb) '
    ||'RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);

  SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='public.kvg_operar(text,jsonb)'::regprocedure;
  IF strpos(src,$s$      'puede_editar_nombre',$s$)=0 THEN RAISE EXCEPTION 'Ficha documental no reconocida.'; END IF;
  src:=replace(src,$s$      'puede_editar_nombre',$s$,$s$
      'puede_retirar',kvg_privado.documento_retirable((p_datos->>'documento_id')::uuid),
      'puede_editar_nombre',$s$);
  EXECUTE 'CREATE OR REPLACE FUNCTION public.kvg_operar(p_operacion text,p_datos jsonb DEFAULT ''{}'') '
    ||'RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);

  SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='public.kvg_trabajar(text,jsonb)'::regprocedure;
  inicio:=strpos(src,$s$        ELSIF v_trabajo.tipo = 'VERIFICAR_RECUPERACION' THEN$s$);
  fin:=strpos(src,$s$        ELSIF v_trabajo.tipo = 'RESPALDAR' THEN$s$);
  IF inicio=0 OR fin<=inicio OR strpos(src,$s$AND v_doc.retirado_en IS NULL AND kvg_privado.alcance(v_evento.usuario_id$s$)=0
    OR strpos(src,$s$ELSIF p_operacion = 'trabajo.estado' THEN$s$)=0 THEN
    RAISE EXCEPTION 'Contrato técnico de recuperación no reconocido.';
  END IF;
  src:=left(src,inicio-1)||$s$        ELSIF v_trabajo.tipo = 'VERIFICAR_RECUPERACION' THEN
            v_salida := v_salida || kvg_privado.originales_recuperacion(v_trabajo);
$s$||substr(src,fin);
  inicio:=strpos(src,$s$    ELSIF p_operacion = 'documento.recuperar' THEN$s$);
  fin:=strpos(src,$s$    ELSIF p_operacion = 'respaldo.iniciar' THEN$s$);
  IF inicio=0 OR fin<=inicio OR strpos(src,$s$    IF p_operacion IN ('carga.publicar','carga.publicar_beta') THEN$s$)=0 THEN
    RAISE EXCEPTION 'Bloqueo técnico de documentos no reconocido.';
  END IF;
  src:=left(src,inicio-1)||$s$    ELSIF p_operacion IN ('documento.recuperar','documento.recuperar_beta','recuperacion.rechazar') THEN
        RETURN kvg_privado.finalizar_recuperacion(v_trabajo,p_operacion,p_datos);
$s$||substr(src,fin);
  src:=replace(src,$s$    IF p_operacion IN ('carga.publicar','carga.publicar_beta') THEN$s$,$s$
    IF p_operacion IN ('carga.publicar','carga.publicar_beta','documento.recuperar','documento.recuperar_beta','recuperacion.rechazar') THEN$s$);
  src:=replace(src,$s$ELSIF p_operacion = 'trabajo.estado' THEN$s$,$s$
    ELSIF p_operacion='trabajo.tomar_recuperacion' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY[]::text[]);
        RETURN kvg_privado.tomar_recuperacion();
    ELSIF p_operacion = 'trabajo.estado' THEN$s$);
  src:=replace(src,$s$AND v_doc.retirado_en IS NULL AND kvg_privado.alcance(v_evento.usuario_id$s$,$s$
             AND v_doc.retirado_en IS NULL AND NOT EXISTS (SELECT 1 FROM kvg.evento_retiro_documento h
               WHERE h.documento_id=v_doc.documento_id AND h.operacion='RETIRO' AND h.registrado_en>=v_evento.ocurrido_en)
             AND kvg_privado.alcance(v_evento.usuario_id$s$);
  EXECUTE 'CREATE OR REPLACE FUNCTION public.kvg_trabajar(p_operacion text,p_datos jsonb DEFAULT ''{}'') '
    ||'RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);
END;
$patch$;
COMMIT;
