-- CU009–CU011: metadatos, clasificación y asociación sin cambiar los originales.
BEGIN;
CREATE FUNCTION kvg_privado.documento_publicado(p_documento uuid,p_version uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $f$
  SELECT EXISTS (SELECT 1 FROM kvg.version_documento v
    WHERE v.version_id=p_version AND v.documento_id=p_documento AND kvg_privado.carga_descargable(v.carga_id));
$f$;

CREATE FUNCTION kvg_privado.documento_organizable(p_documento uuid,p_permiso text)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $f$
  SELECT EXISTS (SELECT 1 FROM kvg.documento d JOIN kvg.expediente e USING(expediente_id)
    JOIN kvg.version_documento v ON v.version_id=d.version_vigente_id
    WHERE d.documento_id=p_documento AND e.estado_expediente_codigo IN ('NUEVO','EN_PROCESO','PENDIENTE')
      AND kvg_privado.puede_documento('documento.consultar',p_documento)
      AND kvg_privado.puede_documento(p_permiso,p_documento)
      AND kvg_privado.documento_publicado(p_documento,v.version_id)
      AND (CASE WHEN p_permiso='documento.asociar' THEN v.estado_documento_codigo IN ('RECIBIDO','EN_REVISION')
             ELSE v.estado_documento_codigo<>'ARCHIVADO' END)
      AND NOT EXISTS (SELECT 1 FROM kvg.carga_archivo c WHERE c.documento_id=p_documento
        AND (c.estado_tecnico='RECIBIENDO' OR (c.estado_tecnico IN ('PENDIENTE_VERIFICACION','ERROR_VERIFICACION')
          AND EXISTS (SELECT 1 FROM kvg.trabajo_operativo t WHERE t.objetivo_id=c.carga_id
            AND t.tipo IN ('VERIFICAR_CARGA','CONCILIAR_CARGA') AND t.estado IN ('EN_COLA','EN_EJECUCION'))))));
$f$;

CREATE FUNCTION kvg_privado.destino_documento_admitido(p_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $f$
  SELECT EXISTS (SELECT 1 FROM kvg.expediente e WHERE e.expediente_id=p_id
    AND e.estado_expediente_codigo IN ('NUEVO','EN_PROCESO','PENDIENTE')
    AND kvg_privado.puede_expediente('expediente.consultar',p_id)
    AND kvg_privado.puede_expediente('documento.consultar',p_id)
    AND kvg_privado.puede_expediente('documento.asociar',p_id));
$f$;

CREATE FUNCTION kvg_privado.buscar_metadatos_documento(p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE caso uuid := (p_datos->>'expediente_id')::uuid;
  categoria uuid := (p_datos->>'categoria_id')::uuid; v_nombre text := nullif(btrim(p_datos->>'texto'),'');
  v_folio text := nullif(btrim(p_datos->>'folio'),''); v_cliente text := nullif(btrim(p_datos->>'cliente'),'');
  inicio date := (p_datos->>'desde')::date; fin date := (p_datos->>'hasta')::date;
  orden text := coalesce(p_datos->>'orden','recientes'); salida jsonb;
BEGIN
  PERFORM kvg_privado.validar_campos(p_datos,ARRAY['expediente_id','categoria_id','texto','estado','limite',
    'desplazamiento','folio','cliente','desde','hasta','orden']);
  IF inicio>fin OR length(v_nombre)>200 OR length(v_cliente)>200 OR length(v_folio)>40
    OR orden NOT IN ('recientes','antiguos','nombre')
    OR (p_datos->>'estado' IS NOT NULL AND p_datos->>'estado' NOT IN ('RECIBIDO','EN_REVISION','VALIDADO','ARCHIVADO')) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Filtros de documentos inválidos.';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(q)-'clave_orden' ORDER BY
    CASE WHEN orden='nombre' THEN q.clave_orden END,
    CASE WHEN orden='antiguos' THEN q.creado_en END ASC,
    CASE WHEN orden='recientes' THEN q.creado_en END DESC,q.documento_id),'[]') INTO salida
  FROM (
    SELECT d.documento_id,d.expediente_id,d.nombre,d.categoria_id,c.nombre AS nombre_categoria,
      CASE WHEN kvg_privado.puede_expediente('expediente.consultar',e.expediente_id) THEN e.folio_interno END AS folio_expediente,
      v.version_id AS version_vigente_id,v.numero_version,v.estado_documento_codigo,d.creado_en,lower(d.nombre) AS clave_orden
    FROM kvg.documento d JOIN kvg.expediente e USING(expediente_id)
      JOIN kvg.categoria_documento c USING(categoria_id)
      LEFT JOIN kvg.version_documento v ON v.version_id=d.version_vigente_id AND kvg_privado.documento_publicado(d.documento_id,v.version_id)
    WHERE kvg_privado.puede_documento('documento.consultar',d.documento_id)
      AND (caso IS NOT NULL OR v.version_id IS NOT NULL)
      AND (caso IS NULL OR d.expediente_id=caso)
      AND (categoria IS NULL OR d.categoria_id=categoria)
      AND (p_datos->>'estado' IS NULL OR v.estado_documento_codigo=p_datos->>'estado')
      AND (v_nombre IS NULL OR to_tsvector('spanish'::regconfig,d.nombre::text) @@ plainto_tsquery('spanish'::regconfig,v_nombre))
      AND (v_folio IS NULL OR (strpos(lower(e.folio_interno),lower(v_folio))>0
        AND kvg_privado.puede_expediente('expediente.consultar',e.expediente_id)))
      AND (v_cliente IS NULL OR EXISTS (SELECT 1 FROM kvg.cliente cl WHERE cl.cliente_id=e.cliente_principal_id
        AND strpos(lower(cl.nombre_presentacion),lower(v_cliente))>0
        AND kvg_privado.puede_cliente('cliente.consultar',cl.cliente_id)))
      AND (inicio IS NULL OR d.creado_en>=(inicio::timestamp AT TIME ZONE 'UTC'))
      AND (fin IS NULL OR d.creado_en<((fin+1)::timestamp AT TIME ZONE 'UTC'))
    ORDER BY CASE WHEN orden='nombre' THEN lower(d.nombre) END,
      CASE WHEN orden='antiguos' THEN d.creado_en END ASC,
      CASE WHEN orden='recientes' THEN d.creado_en END DESC,d.documento_id
    LIMIT least(greatest(coalesce((p_datos->>'limite')::integer,20),1),51)
    OFFSET least(greatest(coalesce((p_datos->>'desplazamiento')::integer,0),0),10000)
  ) q;
  RETURN salida;
END;
$f$;

CREATE FUNCTION kvg_privado.organizar_documento(p_operacion text,p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE id uuid := (p_datos->>'documento_id')::uuid; d kvg.documento; actor uuid := kvg_privado.usuario_actual();
  categoria uuid; destino uuid; razon text := nullif(btrim(p_datos->>'motivo'),'');
  filtro text := nullif(btrim(p_datos->>'texto'),''); revision_nueva integer; salida jsonb;
BEGIN
  IF p_operacion='documento.destinos' THEN
    PERFORM kvg_privado.validar_campos(p_datos,ARRAY['documento_id','texto','limite','desplazamiento']);
    PERFORM kvg_privado.exigir(kvg_privado.documento_organizable(id,'documento.asociar'));
    IF filtro IS NULL THEN RETURN '[]'; END IF;
    IF length(filtro)>40 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Folio inválido.'; END IF;
    SELECT * INTO d FROM kvg.documento WHERE documento_id=id;
    SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.folio_interno),'[]') INTO salida FROM (
      SELECT e.expediente_id,e.folio_interno FROM kvg.expediente e
      WHERE e.expediente_id<>d.expediente_id AND strpos(lower(e.folio_interno),lower(filtro))>0
        AND kvg_privado.destino_documento_admitido(e.expediente_id)
      ORDER BY e.folio_interno LIMIT least(greatest(coalesce((p_datos->>'limite')::integer,20),1),51)
      OFFSET least(greatest(coalesce((p_datos->>'desplazamiento')::integer,0),0),10000)
    ) q;
    RETURN salida;
  END IF;
  PERFORM kvg_privado.exigir(kvg_privado.puede_documento('documento.consultar',id)
    AND kvg_privado.puede_documento(p_operacion,id));
  PERFORM pg_advisory_xact_lock(hashtextextended('kvg:seguridad',0));
  SELECT * INTO d FROM kvg.documento WHERE documento_id=id FOR UPDATE;
  PERFORM kvg_privado.exigir(kvg_privado.puede_documento('documento.consultar',id) AND kvg_privado.puede_documento(p_operacion,id));
  PERFORM kvg_privado.exigir_revision(d.revision,(p_datos->>'revision')::integer);
  PERFORM kvg_privado.exigir(kvg_privado.documento_organizable(id,p_operacion));
  IF p_operacion='documento.clasificar' THEN
    PERFORM kvg_privado.validar_campos(p_datos,ARRAY['documento_id','revision','categoria_id','motivo']);
    categoria := (p_datos->>'categoria_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM kvg.categoria_documento c WHERE c.categoria_id=categoria AND c.activo FOR SHARE)
      OR categoria=d.categoria_id
      OR (p_datos ? 'motivo' AND coalesce(razon,'') NOT IN ('CORREGIR_CLASIFICACION','ORGANIZACION_CATALOGO','OTRA_CORRECCION')) THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Categoría o motivo de clasificación inválidos.';
    END IF;
    UPDATE kvg.documento SET categoria_id=categoria WHERE documento_id=id RETURNING revision INTO revision_nueva;
    PERFORM kvg_privado.auditar('DOCUMENTO_CLASIFICADO','DOCUMENTO',id,'EXITO',
      jsonb_build_object('codigo',razon,'campos',jsonb_build_array(d.categoria_id,categoria),'revision',revision_nueva));
    destino := d.expediente_id;
  ELSIF p_operacion='documento.asociar' THEN
    PERFORM kvg_privado.validar_campos(p_datos,ARRAY['documento_id','revision','expediente_destino_id','motivo']);
    destino := (p_datos->>'expediente_destino_id')::uuid;
    PERFORM kvg_privado.exigir(destino<>d.expediente_id AND kvg_privado.destino_documento_admitido(destino));
    IF jsonb_typeof(p_datos->'motivo') IS DISTINCT FROM 'string' OR razon IS NULL OR length(razon)>2000 THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Indica el motivo de la asociación.';
    END IF;
    UPDATE kvg.documento SET expediente_id=destino WHERE documento_id=id RETURNING revision INTO revision_nueva;
    INSERT INTO kvg.historial_asociacion_documento (documento_id,expediente_origen_id,expediente_destino_id,
      version_id,registrado_por,motivo,revision_resultante)
    VALUES (id,d.expediente_id,destino,d.version_vigente_id,actor,razon,revision_nueva);
  ELSE
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Operación documental inválida.';
  END IF;
  RETURN jsonb_build_object('documento_id',id,'expediente_id',destino,'revision',revision_nueva);
END;
$f$;

CREATE FUNCTION kvg_privado.organizacion_detalle_documento(p_id uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $f$
 SELECT jsonb_build_object(
  'folio_expediente',CASE WHEN kvg_privado.puede_expediente('expediente.consultar',e.expediente_id) THEN e.folio_interno END,
  'archivo_disponible',kvg_privado.documento_publicado(d.documento_id,d.version_vigente_id),
  'puede_clasificar',kvg_privado.documento_organizable(p_id,'documento.clasificar'),
  'puede_asociar',kvg_privado.documento_organizable(p_id,'documento.asociar'),
  'clasificaciones',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',a.evento_id,'anterior',c1.nombre,'nueva',c2.nombre,'motivo',a.detalle_controlado->>'codigo',
    'autor',u.nombre,'fecha',a.ocurrido_en)
    ORDER BY a.ocurrido_en DESC,a.evento_id)
    FROM kvg.evento_auditoria a JOIN kvg.usuario u USING(usuario_id)
    JOIN kvg.categoria_documento c1 ON c1.categoria_id::text=a.detalle_controlado#>>'{campos,0}'
    JOIN kvg.categoria_documento c2 ON c2.categoria_id::text=a.detalle_controlado#>>'{campos,1}'
    WHERE a.recurso_id=p_id AND a.accion='DOCUMENTO_CLASIFICADO' AND a.resultado='EXITO'),'[]'),
  'asociaciones',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',h.asociacion_evento_id,'tiene_origen',h.expediente_origen_id IS NOT NULL,
    'origen',CASE WHEN kvg_privado.puede_expediente('expediente.consultar',orig.expediente_id) THEN orig.folio_interno END,
    'destino',CASE WHEN kvg_privado.puede_expediente('expediente.consultar',dest.expediente_id) THEN dest.folio_interno END,
    'motivo',CASE WHEN (h.expediente_origen_id IS NULL OR kvg_privado.puede_expediente('expediente.consultar',orig.expediente_id))
      AND kvg_privado.puede_expediente('expediente.consultar',dest.expediente_id) THEN h.motivo END,
    'autor',u.nombre,'fecha',h.registrado_en) ORDER BY h.revision_resultante DESC)
    FROM kvg.historial_asociacion_documento h JOIN kvg.usuario u ON u.usuario_id=h.registrado_por
    LEFT JOIN kvg.expediente orig ON orig.expediente_id=h.expediente_origen_id
    JOIN kvg.expediente dest ON dest.expediente_id=h.expediente_destino_id
    WHERE h.documento_id=p_id),'[]'))
 FROM kvg.documento d JOIN kvg.expediente e USING(expediente_id)
 WHERE d.documento_id=p_id AND kvg_privado.puede_documento('documento.consultar',p_id);
$f$;

REVOKE ALL ON FUNCTION kvg_privado.documento_publicado(uuid,uuid), kvg_privado.documento_organizable(uuid,text),
  kvg_privado.destino_documento_admitido(uuid), kvg_privado.buscar_metadatos_documento(jsonb),
  kvg_privado.organizar_documento(text,jsonb), kvg_privado.organizacion_detalle_documento(uuid)
  FROM PUBLIC,anon,authenticated,service_role,kvg_session_store;

DO $patch$
DECLARE src text; inicio integer; fin integer;
BEGIN
  SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='kvg_privado.documentos(text,jsonb)'::regprocedure;
  inicio := strpos(src,$s$    ELSIF p_operacion = 'documento.buscar' THEN$s$);
  fin := strpos(src,$s$    ELSIF p_operacion = 'documento.descargar' THEN$s$);
  IF inicio=0 OR fin<=inicio THEN RAISE EXCEPTION 'Contrato documental no reconocido.'; END IF;
  src := left(src,inicio-1)||$s$    ELSIF p_operacion = 'documento.buscar' THEN
        RETURN kvg_privado.buscar_metadatos_documento(p_datos);
    ELSIF p_operacion IN ('documento.clasificar','documento.asociar','documento.destinos') THEN
        RETURN kvg_privado.organizar_documento(p_operacion,p_datos);
$s$||substr(src,fin);
  EXECUTE 'CREATE OR REPLACE FUNCTION kvg_privado.documentos(p_operacion text,p_datos jsonb) '
    ||'RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);

  SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='public.kvg_operar(text,jsonb)'::regprocedure;
  IF strpos(src,$s$ELSIF p_operacion = 'documento.carga'$s$)=0 THEN RAISE EXCEPTION 'Contrato de consulta documental no reconocido.'; END IF;
  src := replace(src,$s$ELSIF p_operacion = 'documento.carga'$s$,$s$
    v_salida := v_salida || kvg_privado.organizacion_detalle_documento((p_datos->>'documento_id')::uuid);
    PERFORM kvg_privado.exigir(v_salida IS NOT NULL);
  ELSIF p_operacion = 'documento.carga'$s$);
  EXECUTE 'CREATE OR REPLACE FUNCTION public.kvg_operar(p_operacion text,p_datos jsonb DEFAULT ''{}'') '
    ||'RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);
END;
$patch$;
COMMIT;
