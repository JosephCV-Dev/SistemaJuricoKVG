-- CU002/CU003. Mantiene el despachador, la matriz y los triggers de auditoría.
BEGIN;

CREATE FUNCTION kvg_privado.actualizar_identificaciones_cliente(p_cliente uuid,p_items jsonb,p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE v_item jsonb;
BEGIN
    IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 20 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Colección de identificaciones inválida.';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
        PERFORM kvg_privado.validar_campos(v_item,ARRAY['tipo','valor']);
    END LOOP;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) x
        GROUP BY x->>'tipo',x->>'valor' HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'La identificación se repite.';
    END IF;
    UPDATE kvg.identificacion_cliente i SET retirado_en = clock_timestamp()
    WHERE i.cliente_id = p_cliente AND i.retirado_en IS NULL
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) x
        WHERE x->>'tipo' = i.tipo_identificacion_codigo AND x->>'valor' = i.valor_original);
    INSERT INTO kvg.identificacion_cliente (cliente_id,tipo_identificacion_codigo,valor_original,
        valor_normalizado,regla_revision,registrado_por)
    SELECT p_cliente,x->>'tipo',x->>'valor',x->>'valor',1,p_actor
    FROM jsonb_array_elements(p_items) x
    WHERE NOT EXISTS (SELECT 1 FROM kvg.identificacion_cliente i
        WHERE i.cliente_id = p_cliente AND i.retirado_en IS NULL
          AND x->>'tipo' = i.tipo_identificacion_codigo AND x->>'valor' = i.valor_original)
    ORDER BY x->>'tipo',x->>'valor';
END;
$func$;
REVOKE ALL ON FUNCTION kvg_privado.actualizar_identificaciones_cliente(uuid,jsonb,uuid)
    FROM PUBLIC, anon, authenticated, service_role, kvg_session_store;

CREATE OR REPLACE FUNCTION kvg_privado.clientes(p_operacion text,p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE v_actor uuid := kvg_privado.usuario_actual(); v_id uuid; v_cliente kvg.cliente; v_salida jsonb;
    v_texto text; v_identificacion text; v_patron text;
BEGIN
    IF p_operacion = 'cliente.registrar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['nombre','identificaciones','contactos']);
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('cliente.registrar'));
        INSERT INTO kvg.cliente (nombre_presentacion,creado_por)
          VALUES (p_datos->>'nombre',v_actor) RETURNING * INTO v_cliente;
        PERFORM kvg_privado.medios_cliente(v_cliente.cliente_id,p_datos,v_actor);
        RETURN to_jsonb(v_cliente);
    ELSIF p_operacion = 'cliente.actualizar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['cliente_id','revision','nombre','identificaciones','contactos']);
        v_id := (p_datos->>'cliente_id')::uuid;
        PERFORM kvg_privado.exigir(kvg_privado.puede_cliente('cliente.consultar',v_id)
            AND kvg_privado.puede_cliente('cliente.actualizar',v_id));
        SELECT * INTO v_cliente FROM kvg.cliente WHERE cliente_id = v_id FOR UPDATE;
        PERFORM kvg_privado.exigir(kvg_privado.puede_cliente('cliente.consultar',v_id)
            AND kvg_privado.puede_cliente('cliente.actualizar',v_id));
        PERFORM kvg_privado.exigir_revision(v_cliente.revision,(p_datos->>'revision')::integer);
        UPDATE kvg.cliente SET nombre_presentacion = coalesce(p_datos->>'nombre',nombre_presentacion),
            actualizado_en = clock_timestamp() WHERE cliente_id = v_id RETURNING * INTO v_cliente;
        IF p_datos ? 'identificaciones' THEN
            PERFORM kvg_privado.actualizar_identificaciones_cliente(v_id,p_datos->'identificaciones',v_actor);
        END IF;
        PERFORM kvg_privado.medios_cliente(v_id,p_datos - 'identificaciones',v_actor);
        RETURN to_jsonb(v_cliente);
    ELSIF p_operacion = 'cliente.consultar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['cliente_id']);
        v_id := (p_datos->>'cliente_id')::uuid;
        PERFORM kvg_privado.exigir(kvg_privado.puede_cliente('cliente.consultar',v_id));
        SELECT to_jsonb(c) || jsonb_build_object(
          'puede_editar',kvg_privado.puede_cliente('cliente.actualizar',v_id),
          'contactos',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM kvg.contacto_cliente x WHERE x.cliente_id = c.cliente_id AND x.activo),'[]'),
          'identificaciones',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM kvg.identificacion_cliente x WHERE x.cliente_id = c.cliente_id AND x.retirado_en IS NULL),'[]'))
          INTO v_salida FROM kvg.cliente c WHERE c.cliente_id = v_id;
        PERFORM kvg_privado.auditar('CLIENTE_CONSULTAR','CLIENTE',v_id);
        RETURN v_salida;
    ELSIF p_operacion = 'cliente.buscar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['texto','identificacion','limite','desplazamiento']);
        v_texto := nullif(btrim(p_datos->>'texto'),'');
        v_identificacion := nullif(btrim(p_datos->>'identificacion'),'');
        IF length(v_texto) > 200 OR length(v_identificacion) > 100 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Filtro de clientes demasiado largo.';
        END IF;
        -- ILIKE literal: %, _ y la barra invertida pueden formar parte de un nombre.
        v_patron := replace(replace(replace(v_texto,chr(92),chr(92)||chr(92)),'%',chr(92)||'%'),'_',chr(92)||'_');
        SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.nombre_presentacion,q.cliente_id),'[]') INTO v_salida FROM
          (SELECT c.* FROM kvg.cliente c WHERE kvg_privado.puede_cliente('cliente.consultar',c.cliente_id)
             AND (v_texto IS NULL OR c.nombre_presentacion ILIKE '%' || v_patron || '%')
             AND (v_identificacion IS NULL OR EXISTS (
               SELECT 1 FROM kvg.identificacion_cliente i
               JOIN kvg.tipo_identificacion t USING (tipo_identificacion_codigo)
               WHERE i.cliente_id = c.cliente_id AND i.retirado_en IS NULL
                 AND i.valor_normalizado = CASE t.regla_normalizacion
                   WHEN 'EXACTA_V1' THEN v_identificacion
                   WHEN 'MAYUSCULAS_V1' THEN upper(v_identificacion)
                   WHEN 'ALFANUMERICA_V1' THEN regexp_replace(upper(v_identificacion),'[^A-Z0-9]','','g') END))
           ORDER BY c.nombre_presentacion,c.cliente_id LIMIT least(greatest(coalesce((p_datos->>'limite')::integer,25),1),100)
           OFFSET least(greatest(coalesce((p_datos->>'desplazamiento')::integer,0),0),10000)) q;
        RETURN v_salida;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Operación de cliente no admitida.';
END;
$func$;

COMMIT;
