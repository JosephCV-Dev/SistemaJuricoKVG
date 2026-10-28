-- CU005: mostrar los responsables del expediente sin exponer un directorio global.
-- La consulta original verifica alcance y registra auditoría antes de añadir nombres.
BEGIN;
DO $migration$
DECLARE v_body text; v_previous text;
BEGIN
    SELECT prosrc INTO v_body FROM pg_proc
      WHERE oid = 'public.kvg_operar(text,jsonb)'::regprocedure;
    v_previous := 'ELSIF p_operacion LIKE ''expediente.%'' THEN';
    IF strpos(v_body,'crear_una_vez') = 0 OR strpos(v_body,v_previous) = 0 OR
       strpos(v_body,'nombre_abogado') > 0 THEN
        RAISE EXCEPTION 'El despachador no corresponde al contrato previo esperado.';
    END IF;
    v_body := replace(v_body,v_previous,
      'ELSIF p_operacion = ''expediente.consultar'' THEN
                v_salida := kvg_privado.expedientes(p_operacion,p_datos);
                v_salida := v_salida || jsonb_build_object(''asignaciones'',
                  coalesce((SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object(''nombre_abogado'',u.nombre)
                    ORDER BY a.inicia_en,a.asignacion_id)
                    FROM kvg.asignacion_expediente a JOIN kvg.usuario u ON u.usuario_id = a.abogado_id
                    WHERE a.expediente_id = (p_datos->>''expediente_id'')::uuid),''[]''::jsonb));
            ' || v_previous);
    EXECUTE format('CREATE OR REPLACE FUNCTION public.kvg_operar(p_operacion text,p_datos jsonb DEFAULT ''{}'')
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '''' AS %L',v_body);
END;
$migration$;
COMMIT;
