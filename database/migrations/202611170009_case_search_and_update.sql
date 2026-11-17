-- CU005 y CU031. Filtros por alcance y edición acotada con motivo de auditoría.
BEGIN;
DO $patch$
DECLARE src text; anterior text; nuevo text;
BEGIN
  SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='kvg_privado.expedientes(text,jsonb)'::regprocedure;
  FOR anterior,nuevo IN SELECT * FROM (VALUES
    ($old$v_aprobador uuid; v_concesion uuid; v_salida jsonb; v_avance uuid; v_item jsonb; v_instante timestamptz;$old$,
     $new$v_aprobador uuid; v_concesion uuid; v_salida jsonb; v_avance uuid; v_item jsonb; v_instante timestamptz;
    v_numero text; v_autoridad text; v_descripcion text; v_campos text[];$new$),
    ($old$'asignaciones',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM kvg.asignacion_expediente a WHERE a.expediente_id = e.expediente_id),'[]'),$old$,
     $new$'asignaciones',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM kvg.asignacion_expediente a WHERE a.expediente_id = e.expediente_id),'[]'),
              'nombre_cliente',CASE WHEN kvg_privado.puede_cliente('cliente.consultar',e.cliente_principal_id)
                THEN (SELECT c.nombre_presentacion FROM kvg.cliente c WHERE c.cliente_id=e.cliente_principal_id) END,
              'puede_editar', e.estado_expediente_codigo IN ('NUEVO','EN_PROCESO','PENDIENTE')
                AND kvg_privado.puede_expediente('expediente.actualizar',e.expediente_id),$new$),
    ($old$PERFORM kvg_privado.validar_campos(p_datos,ARRAY['texto','estado','limite','desplazamiento']);$old$,
     $new$PERFORM kvg_privado.validar_campos(p_datos,CASE WHEN p_operacion='expediente.buscar'
          THEN ARRAY['texto','estado','limite','desplazamiento','cliente','responsable']
          ELSE ARRAY['texto','estado','limite','desplazamiento'] END);
        IF length(p_datos->>'texto') > 200 OR length(p_datos->>'cliente') > 200
          OR length(p_datos->>'responsable') > 200 THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Filtro demasiado largo.';
        END IF;$new$),
    ($old$        SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO v_salida FROM
          (SELECT e.* FROM kvg.expediente$old$,
     $new$        SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.creado_en DESC,q.expediente_id),'[]') INTO v_salida FROM
          (SELECT e.* FROM kvg.expediente$new$),
    ($old$            AND (p_datos->>'texto' IS NULL OR e.folio_interno ILIKE '%' || left(p_datos->>'texto',100) || '%'
              OR to_tsvector$old$,
     $new$            AND (nullif(btrim(p_datos->>'cliente'),'') IS NULL OR EXISTS (
                SELECT 1 FROM kvg.cliente c WHERE c.cliente_id=e.cliente_principal_id
                  AND kvg_privado.puede_cliente('cliente.consultar',c.cliente_id)
                  AND strpos(lower(c.nombre_presentacion),lower(btrim(p_datos->>'cliente'))) > 0))
            AND (nullif(btrim(p_datos->>'responsable'),'') IS NULL OR EXISTS (
                SELECT 1 FROM kvg.asignacion_expediente a JOIN kvg.usuario u ON u.usuario_id=a.abogado_id
                WHERE a.expediente_id=e.expediente_id AND a.funcion='PRINCIPAL'
                  AND a.inicia_en<=clock_timestamp() AND (a.finaliza_en IS NULL OR a.finaliza_en>clock_timestamp())
                  AND strpos(lower(u.nombre),lower(btrim(p_datos->>'responsable'))) > 0))
            AND (nullif(btrim(p_datos->>'texto'),'') IS NULL
              OR strpos(lower(e.folio_interno),lower(btrim(p_datos->>'texto'))) > 0
              OR strpos(lower(e.numero_externo),lower(btrim(p_datos->>'texto'))) > 0
              OR to_tsvector$new$),
    ($old$OFFSET greatest(coalesce((p_datos->>'desplazamiento')::integer,0),0)) q;$old$,
     $new$OFFSET least(greatest(coalesce((p_datos->>'desplazamiento')::integer,0),0),10000)) q;$new$),
    ($old$IF p_operacion IN ('expediente.asignar','expediente.reasignar','expediente.cambiar_estado') THEN$old$,
     $new$IF p_operacion IN ('expediente.actualizar','expediente.asignar','expediente.reasignar','expediente.cambiar_estado') THEN$new$),
    ($old$        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['expediente_id','revision','cliente_id','descripcion','numero_externo','autoridad_externa']);
        PERFORM kvg_privado.exigir(kvg_privado.puede_expediente('expediente.actualizar',v_id));
        PERFORM kvg_privado.exigir_editable(v_id);
        SELECT * INTO v_exp FROM kvg.expediente WHERE expediente_id = v_id FOR UPDATE;
        PERFORM kvg_privado.exigir_revision(v_exp.revision,(p_datos->>'revision')::integer);
        v_cliente := coalesce((p_datos->>'cliente_id')::uuid,v_exp.cliente_principal_id);
        PERFORM kvg_privado.exigir(kvg_privado.puede_cliente('cliente.consultar',v_cliente));
        UPDATE kvg.expediente SET cliente_principal_id = v_cliente,descripcion = coalesce(p_datos->>'descripcion',descripcion),
          numero_externo = CASE WHEN p_datos ? 'numero_externo' THEN p_datos->>'numero_externo' ELSE numero_externo END,
          autoridad_externa = CASE WHEN p_datos ? 'autoridad_externa' THEN p_datos->>'autoridad_externa' ELSE autoridad_externa END
          WHERE expediente_id = v_id RETURNING * INTO v_exp;
        RETURN to_jsonb(v_exp);
$old$,
     $new$        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['expediente_id','revision','descripcion','numero_externo','autoridad_externa','motivo']);
        PERFORM kvg_privado.exigir(kvg_privado.puede_expediente('expediente.consultar',v_id)
          AND kvg_privado.puede_expediente('expediente.actualizar',v_id));
        SELECT * INTO v_exp FROM kvg.expediente WHERE expediente_id = v_id FOR UPDATE;
        PERFORM kvg_privado.exigir(kvg_privado.puede_expediente('expediente.consultar',v_id)
          AND kvg_privado.puede_expediente('expediente.actualizar',v_id));
        PERFORM kvg_privado.exigir_editable(v_id);
        PERFORM kvg_privado.exigir_revision(v_exp.revision,(p_datos->>'revision')::integer);
        IF p_datos->>'motivo' IS NULL OR p_datos->>'motivo' NOT IN
            ('CORREGIR_CAPTURA','PRECISAR_DESCRIPCION','ACTUALIZAR_REFERENCIA','OTRA_CORRECCION')
          OR (p_datos ? 'descripcion' AND (jsonb_typeof(p_datos->'descripcion') <> 'string'
                OR length(btrim(p_datos->>'descripcion')) NOT BETWEEN 1 AND 2000))
          OR (p_datos ? 'numero_externo') <> (p_datos ? 'autoridad_externa')
          OR (p_datos ? 'numero_externo' AND (jsonb_typeof(p_datos->'numero_externo') NOT IN ('string','null')
                OR jsonb_typeof(p_datos->'autoridad_externa') NOT IN ('string','null')
                OR (p_datos->>'numero_externo' IS NULL) <> (p_datos->>'autoridad_externa' IS NULL)
                OR length(btrim(p_datos->>'numero_externo')) NOT BETWEEN 1 AND 100
                OR length(btrim(p_datos->>'autoridad_externa')) NOT BETWEEN 1 AND 512)) THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Datos generales del expediente inválidos.';
        END IF;
        v_descripcion := coalesce(btrim(p_datos->>'descripcion'),v_exp.descripcion);
        v_numero := CASE WHEN p_datos ? 'numero_externo' THEN btrim(p_datos->>'numero_externo') ELSE v_exp.numero_externo END;
        v_autoridad := CASE WHEN p_datos ? 'autoridad_externa' THEN btrim(p_datos->>'autoridad_externa') ELSE v_exp.autoridad_externa END;
        v_campos := array_remove(ARRAY[
            CASE WHEN v_descripcion IS DISTINCT FROM v_exp.descripcion THEN 'descripcion' END,
            CASE WHEN v_numero IS DISTINCT FROM v_exp.numero_externo THEN 'numero_externo' END,
            CASE WHEN v_autoridad IS DISTINCT FROM v_exp.autoridad_externa THEN 'autoridad_externa' END
        ],NULL);
        IF cardinality(v_campos)=0 THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Indica al menos un cambio.';
        END IF;
        UPDATE kvg.expediente SET descripcion=v_descripcion,numero_externo=v_numero,autoridad_externa=v_autoridad
          WHERE expediente_id=v_id RETURNING * INTO v_exp;
        PERFORM kvg_privado.auditar('EXPEDIENTE_DATOS_ACTUALIZADOS','EXPEDIENTE',v_id,'EXITO',
          jsonb_build_object('codigo',p_datos->>'motivo','campos',v_campos,'revision',v_exp.revision));
        RETURN to_jsonb(v_exp);
$new$)
  ) AS cambios(anterior,nuevo) LOOP
    IF strpos(src,anterior)=0 THEN RAISE EXCEPTION 'Contrato de expedientes no reconocido.'; END IF;
    src := replace(src,anterior,nuevo);
  END LOOP;
  EXECUTE 'CREATE OR REPLACE FUNCTION kvg_privado.expedientes(p_operacion text,p_datos jsonb) '
    ||'RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);
END;
$patch$;
COMMIT;
