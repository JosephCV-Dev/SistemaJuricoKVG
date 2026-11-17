-- CU007/CU015/CU025. Metadatos mínimos, participación vigente y reasignación auditada.
BEGIN;
CREATE FUNCTION kvg_privado.permite_reasignar(p_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $f$
  SELECT kvg_privado.puede_global('expediente.reasignar') AND EXISTS (
    SELECT 1 FROM kvg.expediente e WHERE e.expediente_id=p_id
    AND e.estado_expediente_codigo IN ('NUEVO','EN_PROCESO','PENDIENTE')
    AND NOT kvg_privado.medida_impide(e.cliente_principal_id,p_id,NULL,'EDITAR')
    AND EXISTS (SELECT 1 FROM kvg.asignacion_expediente a
      WHERE a.expediente_id=p_id AND a.funcion='PRINCIPAL'
        AND a.inicia_en<=clock_timestamp() AND a.finaliza_en IS NULL));
$f$;

CREATE FUNCTION kvg_privado.participaciones_expediente(p_actor uuid,p_id uuid,p_ahora timestamptz)
RETURNS text[] LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $f$
  SELECT ARRAY(
    SELECT a.funcion::text FROM kvg.asignacion_expediente a
      WHERE a.expediente_id=p_id AND a.abogado_id=p_actor AND a.inicia_en<=p_ahora
        AND (a.finaliza_en IS NULL OR a.finaliza_en>p_ahora)
        AND kvg_privado.capacidad(p_actor,'expediente.consultar',a.funcion)
    UNION
    SELECT 'EXPLICITO' WHERE kvg_privado.capacidad(p_actor,'expediente.consultar','EXPLICITO') AND EXISTS (
      SELECT 1 FROM kvg.concesion_acceso c
      JOIN kvg.concesion_permiso cp USING(concesion_id) JOIN kvg.permiso p USING(permiso_id)
      WHERE c.expediente_id=p_id AND c.usuario_id=p_actor AND p.activo AND p.codigo='expediente.consultar'
        AND c.inicia_en<=p_ahora AND (c.expira_en IS NULL OR c.expira_en>p_ahora)
        AND (c.revocado_en IS NULL OR c.revocado_en>p_ahora))
    ORDER BY 1);
$f$;

CREATE FUNCTION kvg_privado.gestion_asignaciones(p_operacion text,p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE actor uuid := kvg_privado.usuario_actual();
  instante timestamptz := clock_timestamp(); caso kvg.expediente; salida jsonb; equipo jsonb; abogados jsonb;
  filtro text := nullif(btrim(p_datos->>'texto'),'');
  n integer := least(greatest(coalesce((p_datos->>'limite')::integer,20),1),51);
  salto integer := least(greatest(coalesce((p_datos->>'desplazamiento')::integer,0),0),10000);
BEGIN
  IF length(filtro)>200 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Filtro demasiado largo.'; END IF;
  IF p_operacion='expediente.asignados' THEN
    PERFORM kvg_privado.validar_campos(p_datos,ARRAY['texto','estado','desde','hasta','participacion','limite','desplazamiento']);
    PERFORM kvg_privado.exigir(kvg_privado.rol_vigente(actor,'ABOGADO'));
    IF (p_datos->>'desde')::date > (p_datos->>'hasta')::date THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Intervalo de fechas inválido.';
    END IF;
    -- La paginación se aplica después de calcular el alcance y la participación.
    SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.creado_en DESC,q.expediente_id),'[]') INTO salida
    FROM (
      SELECT e.*, p.participaciones FROM kvg.expediente e
      CROSS JOIN LATERAL (SELECT kvg_privado.participaciones_expediente(actor,e.expediente_id,instante) AS participaciones) p
      WHERE kvg_privado.puede_expediente('expediente.consultar',e.expediente_id)
        AND cardinality(p.participaciones)>0
        AND (p_datos->>'participacion' IS NULL OR p_datos->>'participacion'=ANY(p.participaciones))
        AND (p_datos->>'estado' IS NULL OR e.estado_expediente_codigo=p_datos->>'estado')
        AND (p_datos->>'desde' IS NULL OR e.creado_en >= ((p_datos->>'desde')::date::timestamp AT TIME ZONE 'UTC'))
        AND (p_datos->>'hasta' IS NULL OR e.creado_en < (((p_datos->>'hasta')::date+1)::timestamp AT TIME ZONE 'UTC'))
        AND (filtro IS NULL OR strpos(lower(e.folio_interno),lower(filtro))>0
             OR strpos(lower(e.numero_externo),lower(filtro))>0
             OR to_tsvector('spanish'::regconfig,e.descripcion::text) @@ plainto_tsquery('spanish'::regconfig,filtro))
      ORDER BY e.creado_en DESC,e.expediente_id LIMIT n OFFSET salto
    ) q;
    RETURN salida;
  ELSIF p_operacion='expediente.reasignables' THEN
    PERFORM kvg_privado.validar_campos(p_datos,ARRAY['texto','limite','desplazamiento']);
    PERFORM kvg_privado.exigir(kvg_privado.puede_global('expediente.reasignar'));
    IF filtro IS NULL THEN RETURN '[]'; END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.folio_interno),'[]') INTO salida FROM (
      SELECT e.expediente_id,e.folio_interno,e.estado_expediente_codigo
      FROM kvg.expediente e WHERE strpos(lower(e.folio_interno),lower(filtro))>0
        AND kvg_privado.permite_reasignar(e.expediente_id)
      ORDER BY e.folio_interno LIMIT n OFFSET salto) q;
    RETURN salida;
  ELSIF p_operacion IN ('expediente.equipo','expediente.equipo_reasignacion') THEN
    PERFORM kvg_privado.validar_campos(p_datos,ARRAY['expediente_id','texto','limite','desplazamiento']);
    SELECT * INTO caso FROM kvg.expediente WHERE expediente_id=(p_datos->>'expediente_id')::uuid;
    IF p_operacion='expediente.equipo_reasignacion' THEN
      PERFORM kvg_privado.exigir(kvg_privado.permite_reasignar(caso.expediente_id));
    ELSE
      PERFORM kvg_privado.exigir(kvg_privado.puede_expediente('expediente.consultar',caso.expediente_id)
        AND kvg_privado.puede_expediente('expediente.asignar',caso.expediente_id));
      PERFORM kvg_privado.exigir_editable(caso.expediente_id);
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('asignacion_id',a.asignacion_id,'abogado_id',a.abogado_id,
      'nombre_abogado',u.nombre,'funcion',a.funcion,'inicia_en',a.inicia_en,'finaliza_en',a.finaliza_en)
      ORDER BY a.inicia_en DESC,a.asignacion_id),'[]') INTO equipo
    FROM kvg.asignacion_expediente a JOIN kvg.usuario u ON u.usuario_id=a.abogado_id
    WHERE a.expediente_id=caso.expediente_id
      AND (p_operacion='expediente.equipo' OR (a.inicia_en<=instante AND (a.finaliza_en IS NULL OR a.finaliza_en>instante)));
    SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.nombre,q.usuario_id),'[]') INTO abogados FROM (
      SELECT u.usuario_id,u.nombre FROM kvg.usuario u
      WHERE (filtro IS NULL OR strpos(lower(u.nombre),lower(filtro))>0)
        AND kvg_privado.rol_vigente(u.usuario_id,'ABOGADO')
        AND NOT (p_operacion='expediente.equipo_reasignacion' AND u.usuario_id=actor)
      ORDER BY u.nombre,u.usuario_id LIMIT n OFFSET salto) q;
    RETURN jsonb_build_object('expediente_id',caso.expediente_id,'folio_interno',caso.folio_interno,
      'estado_expediente_codigo',caso.estado_expediente_codigo,'revision',caso.revision,'equipo',equipo,'abogados',abogados);
  END IF;
  RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Operación de equipo no admitida.';
END;
$f$;
REVOKE ALL ON FUNCTION kvg_privado.permite_reasignar(uuid),
  kvg_privado.participaciones_expediente(uuid,uuid,timestamptz),kvg_privado.gestion_asignaciones(text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role,kvg_session_store;

DO $patch$
DECLARE src text; anterior text; nuevo text;
BEGIN
  SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='kvg_privado.expedientes(text,jsonb)'::regprocedure;
  FOR anterior,nuevo IN SELECT * FROM (VALUES
    ($old$BEGIN
    IF p_operacion = 'expediente.crear' THEN$old$,
     $new$BEGIN
    IF p_operacion IN ('expediente.equipo','expediente.equipo_reasignacion','expediente.reasignables','expediente.asignados') THEN
        RETURN kvg_privado.gestion_asignaciones(p_operacion,p_datos);
    ELSIF p_operacion = 'expediente.crear' THEN$new$),
    ($old$'puede_editar', e.estado_expediente_codigo IN ('NUEVO','EN_PROCESO','PENDIENTE')$old$,
     $new$'puede_asignar',e.estado_expediente_codigo IN ('NUEVO','EN_PROCESO','PENDIENTE')
                AND kvg_privado.puede_expediente('expediente.asignar',e.expediente_id),
              'puede_editar', e.estado_expediente_codigo IN ('NUEVO','EN_PROCESO','PENDIENTE')$new$),
    ($old$        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['expediente_id','revision','abogado_id','funcion','motivo']);
        PERFORM kvg_privado.exigir(CASE WHEN p_operacion = 'expediente.reasignar'
            THEN kvg_privado.puede_global('expediente.reasignar') ELSE kvg_privado.puede_expediente('expediente.asignar',v_id) END);
        PERFORM kvg_privado.exigir_editable(v_id);
        SELECT * INTO v_exp FROM kvg.expediente WHERE expediente_id = v_id FOR UPDATE;
        PERFORM kvg_privado.exigir_revision(v_exp.revision,(p_datos->>'revision')::integer);
        v_usuario := (p_datos->>'abogado_id')::uuid;
        PERFORM 1 FROM kvg.usuario WHERE usuario_id = v_usuario FOR UPDATE;
        PERFORM kvg_privado.exigir(kvg_privado.rol_vigente(v_usuario,'ABOGADO'));$old$,
     $new$        PERFORM kvg_privado.validar_campos(p_datos,CASE WHEN p_operacion='expediente.reasignar'
          THEN ARRAY['expediente_id','revision','abogado_id','motivo','referencia_autorizacion','conservar_colaboracion']
          ELSE ARRAY['expediente_id','revision','abogado_id','funcion','motivo'] END);
        PERFORM kvg_privado.exigir(CASE WHEN p_operacion='expediente.reasignar'
          THEN kvg_privado.puede_global('expediente.reasignar')
          ELSE kvg_privado.puede_expediente('expediente.consultar',v_id) AND kvg_privado.puede_expediente('expediente.asignar',v_id) END);
        SELECT * INTO v_exp FROM kvg.expediente WHERE expediente_id=v_id FOR UPDATE;
        PERFORM kvg_privado.exigir(CASE WHEN p_operacion='expediente.reasignar'
          THEN kvg_privado.permite_reasignar(v_id)
          ELSE kvg_privado.puede_expediente('expediente.consultar',v_id) AND kvg_privado.puede_expediente('expediente.asignar',v_id) END);
        PERFORM kvg_privado.exigir_editable(v_id);
        PERFORM kvg_privado.exigir_revision(v_exp.revision,(p_datos->>'revision')::integer);
        IF jsonb_typeof(p_datos->'motivo') IS DISTINCT FROM 'string'
          OR coalesce(length(btrim(p_datos->>'motivo')),0) NOT BETWEEN 1 AND 2000
          OR (p_operacion='expediente.asignar' AND coalesce(p_datos->>'funcion','') NOT IN ('PRINCIPAL','COLABORADOR'))
          OR (p_operacion='expediente.reasignar'
            AND (jsonb_typeof(p_datos->'referencia_autorizacion') IS DISTINCT FROM 'string'
              OR coalesce(p_datos->>'referencia_autorizacion','') !~ '^[A-Za-z0-9._:/-]{1,128}$'
              OR jsonb_typeof(p_datos->'conservar_colaboracion') IS DISTINCT FROM 'boolean')) THEN
          RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Motivo, función o autorización inválidos.';
        END IF;
        v_usuario := (p_datos->>'abogado_id')::uuid;
        PERFORM 1 FROM kvg.usuario WHERE usuario_id=v_usuario FOR UPDATE;
        IF NOT kvg_privado.rol_vigente(v_usuario,'ABOGADO') THEN
          RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Selecciona un abogado activo.';
        END IF;$new$),
    ($old$            UPDATE kvg.concesion_acceso SET revocado_en = v_instante,revocado_por = v_actor,motivo_revocacion = p_datos->>'motivo'
                 WHERE expediente_id = v_id AND usuario_id = v_old.abogado_id AND revocado_en IS NULL;
        END IF;$old$,
     $new$            UPDATE kvg.concesion_acceso SET revocado_en = greatest(v_instante,inicia_en),revocado_por=v_actor,motivo_revocacion=p_datos->>'motivo'
         WHERE expediente_id = v_id AND usuario_id = v_old.abogado_id
           AND (revocado_en IS NULL OR revocado_en>v_instante);
            -- Al promover un colaborador vigente, se cierra su asignación anterior en el mismo instante.
            FOR v_item IN
              UPDATE kvg.asignacion_expediente SET finaliza_en=v_instante,cerrado_por=v_actor,motivo_cierre=p_datos->>'motivo'
              WHERE expediente_id=v_id AND abogado_id=v_usuario AND funcion='COLABORADOR'
                AND inicia_en<=v_instante AND (finaliza_en IS NULL OR finaliza_en>v_instante)
              RETURNING to_jsonb(asignacion_expediente)
            LOOP
              PERFORM kvg_privado.restringir('CERRAR_ASIGNACION','ASIGNACION',v_item->>'asignacion_id',v_actor,
                jsonb_build_object('expediente_id',v_id,'usuario_id',v_usuario));
            END LOOP;
            IF (p_datos->>'conservar_colaboracion')::boolean THEN
              IF NOT kvg_privado.rol_vigente(v_old.abogado_id,'ABOGADO') THEN
                RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='El principal anterior ya no puede colaborar.';
              END IF;
              INSERT INTO kvg.asignacion_expediente (expediente_id,abogado_id,funcion,inicia_en,asignado_por,autorizado_por,motivo_alta)
                VALUES(v_id,v_old.abogado_id,'COLABORADOR',v_instante,v_actor,v_actor,p_datos->>'motivo');
            END IF;
        ELSIF EXISTS (SELECT 1 FROM kvg.asignacion_expediente a WHERE a.expediente_id=v_id
            AND (a.abogado_id=v_usuario OR (a.funcion='PRINCIPAL' AND p_datos->>'funcion'='PRINCIPAL'))
            AND a.inicia_en<=v_instante AND (a.finaliza_en IS NULL OR a.finaliza_en>v_instante)) THEN
            RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='La asignación ya está vigente.';
        END IF;$new$),
    ($old$        RETURN jsonb_build_object('asignacion_id',v_asignacion,'expediente_id',v_id,'revision',v_exp.revision);$old$,
     $new$        IF p_operacion='expediente.reasignar' THEN
          PERFORM kvg_privado.auditar('EXPEDIENTE_REASIGNADO','EXPEDIENTE',v_id,'EXITO',
            jsonb_build_object('codigo',p_datos->>'referencia_autorizacion','asignacion_id',v_asignacion,
              'revision',v_exp.revision,'cantidad',CASE WHEN (p_datos->>'conservar_colaboracion')::boolean THEN 1 ELSE 0 END));
        END IF;
        RETURN jsonb_build_object('asignacion_id',v_asignacion,'expediente_id',v_id,'revision',v_exp.revision);$new$)
  ) AS cambios(anterior,nuevo) LOOP
    IF strpos(src,anterior)=0 THEN RAISE EXCEPTION 'Contrato de asignaciones no reconocido.'; END IF;
    src := replace(src,anterior,nuevo);
  END LOOP;
  EXECUTE 'CREATE OR REPLACE FUNCTION kvg_privado.expedientes(p_operacion text,p_datos jsonb) '
    ||'RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);
END;
$patch$;
COMMIT;
