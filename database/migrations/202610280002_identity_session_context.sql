-- CU023/CU024: contexto mínimo y vigente para las peticiones privadas de la API.
-- Aplicar explícitamente como propietario sobre la baseline KVG ya instalada.
-- No inicializa identidades ni modifica tablas, roles o datos de negocio.
BEGIN;

DO $precondiciones$
BEGIN
    IF to_regprocedure('public.kvg_operar(text,jsonb)') IS NULL
       OR to_regprocedure('kvg_privado.usuario_actual()') IS NULL
       OR to_regprocedure('kvg_privado.iniciar_sesion()') IS NULL
       OR to_regprocedure('kvg_privado.cerrar_sesion()') IS NULL THEN
        RAISE EXCEPTION 'Se requiere la baseline KVG instalada antes del contexto de sesión.';
    END IF;
END;
$precondiciones$;

CREATE OR REPLACE FUNCTION kvg_privado.consultar_sesion()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE
    v_usuario uuid;
    v_nombre text;
    v_sesion uuid;
    v_expira_en timestamptz;
    v_ultima_actividad_en timestamptz;
    v_inactividad_minutos integer;
    v_ahora timestamptz;
    v_roles jsonb;
    v_capacidades jsonb;
BEGIN
    -- Conserva las comprobaciones de Auth, AAL2, cuenta y sesión de la baseline.
    v_usuario := kvg_privado.usuario_actual();
    PERFORM kvg_privado.exigir(v_usuario IS NOT NULL);
    v_ahora := clock_timestamp();

    SELECT u.nombre, s.sesion_id, s.expira_en, s.ultima_actividad_en
      INTO v_nombre, v_sesion, v_expira_en, v_ultima_actividad_en
      FROM kvg.usuario u
      JOIN kvg.sesion_aplicacion s ON s.usuario_id = u.usuario_id
      WHERE u.usuario_id = v_usuario
        AND s.auth_sesion_ref = auth.jwt()->>'session_id';
    PERFORM kvg_privado.exigir(v_sesion IS NOT NULL);

    SELECT coalesce((SELECT valor::integer FROM kvg.parametro_sistema
                     WHERE parametro_codigo = 'sesion.inactividad_minutos'),30)
      INTO v_inactividad_minutos;

    SELECT coalesce(jsonb_agg(q.codigo ORDER BY q.codigo),'[]'::jsonb)
      INTO v_roles
      FROM (
          SELECT DISTINCT r.codigo::text AS codigo
          FROM kvg.usuario_rol ur
          JOIN kvg.rol r ON r.rol_id = ur.rol_id
          WHERE ur.usuario_id = v_usuario AND r.activo
            AND ur.inicia_en <= v_ahora
            AND (ur.finaliza_en IS NULL OR ur.finaliza_en > v_ahora)
      ) q;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'permiso',q.permiso,'contexto',q.contexto,
               'requiere_mfa',q.requiere_mfa,'requiere_decision',q.requiere_decision
           ) ORDER BY q.permiso,q.contexto),'[]'::jsonb)
      INTO v_capacidades
      FROM (
          SELECT DISTINCT p.codigo::text AS permiso, rp.contexto::text AS contexto,
                 p.requiere_mfa, p.requiere_decision
          FROM kvg.usuario_rol ur
          JOIN kvg.rol r ON r.rol_id = ur.rol_id
          JOIN kvg.rol_permiso rp ON rp.rol_id = r.rol_id
          JOIN kvg.permiso p ON p.permiso_id = rp.permiso_id
          WHERE ur.usuario_id = v_usuario AND r.activo AND rp.activo AND p.activo
            AND ur.inicia_en <= v_ahora
            AND (ur.finaliza_en IS NULL OR ur.finaliza_en > v_ahora)
      ) q;

    RETURN jsonb_build_object(
        'usuario',jsonb_build_object('usuario_id',v_usuario,'nombre',v_nombre),
        'roles',v_roles,'capacidades',v_capacidades,
        'sesion',jsonb_build_object(
            'sesion_id',v_sesion,'expira_en',v_expira_en,
            'ultima_actividad_en',v_ultima_actividad_en,
            'inactividad_minutos',v_inactividad_minutos,
            'inactividad_expira_en',least(v_expira_en,
                v_ultima_actividad_en + make_interval(mins => v_inactividad_minutos))
        )
    );
END;
$func$;

-- Se conserva el despachador, la transacción y los rechazos de la baseline.
-- La única nueva operación pública es el nombre fijo sesion.consultar.
CREATE OR REPLACE FUNCTION public.kvg_operar(p_operacion text,p_datos jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE v_salida jsonb; v_codigo text; v_mensaje text; v_actor uuid;
BEGIN
    BEGIN
        IF p_operacion = 'sesion.iniciar' THEN
            PERFORM kvg_privado.validar_campos(p_datos,ARRAY[]::text[]);
            v_salida := kvg_privado.iniciar_sesion();
        ELSE
            v_actor := kvg_privado.usuario_actual();
            PERFORM kvg_privado.exigir(v_actor IS NOT NULL);
            PERFORM kvg_privado.exigir(NOT EXISTS (SELECT 1 FROM kvg.parametro_sistema
                WHERE parametro_codigo = 'sistema.bloqueado' AND valor = 'true')
                OR p_operacion IN ('sesion.cerrar','respaldo.consultar','respaldo.habilitar'));
            UPDATE kvg.sesion_aplicacion SET ultima_actividad_en = clock_timestamp()
              WHERE usuario_id = v_actor AND auth_sesion_ref = auth.jwt()->>'session_id';
            IF p_operacion = 'sesion.cerrar' THEN
                PERFORM kvg_privado.validar_campos(p_datos,ARRAY[]::text[]);
                v_salida := kvg_privado.cerrar_sesion();
            ELSIF p_operacion = 'sesion.consultar' THEN
                PERFORM kvg_privado.validar_campos(p_datos,ARRAY[]::text[]);
                v_salida := kvg_privado.consultar_sesion();
            ELSIF p_operacion LIKE 'cliente.%' THEN v_salida := kvg_privado.clientes(p_operacion,p_datos);
            ELSIF p_operacion LIKE 'expediente.%' THEN v_salida := kvg_privado.expedientes(p_operacion,p_datos);
            ELSIF p_operacion LIKE 'documento.%' THEN v_salida := kvg_privado.documentos(p_operacion,p_datos);
            ELSIF p_operacion LIKE 'respaldo.%' THEN v_salida := kvg_privado.respaldos(p_operacion,p_datos);
            ELSE v_salida := kvg_privado.administracion(p_operacion,p_datos);
            END IF;
        END IF;
        -- Las restricciones diferidas se comprueban dentro del bloque protegido.
        SET CONSTRAINTS ALL IMMEDIATE;
        SET CONSTRAINTS ALL DEFERRED;
        RETURN jsonb_build_object('correcto',true,'datos',v_salida);
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_codigo = RETURNED_SQLSTATE;
        v_mensaje := CASE v_codigo WHEN '42501' THEN 'Operación no autorizada.'
            WHEN '40001' THEN 'El recurso fue modificado; actualice la revisión.'
            WHEN '23505' THEN 'Existe un registro con la misma clave.'
            WHEN 'P0002' THEN 'Recurso no disponible.' ELSE 'La operación no cumple las reglas de datos.' END;
    END;
    PERFORM kvg_privado.auditar('OPERACION_RECHAZADA','SISTEMA',NULL,
       CASE WHEN v_codigo = '42501' THEN 'DENEGADO' ELSE 'FALLIDO' END,jsonb_build_object('codigo',v_codigo));
    RETURN jsonb_build_object('correcto',false,'codigo',v_codigo,'mensaje',v_mensaje);
END;
$func$;

REVOKE ALL ON FUNCTION kvg_privado.consultar_sesion() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.kvg_operar(text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.kvg_operar(text,jsonb) TO authenticated;

COMMENT ON FUNCTION kvg_privado.consultar_sesion() IS
 'Contexto mínimo del usuario y sesión actuales con roles y capacidades vigentes; no concede alcance sobre expedientes.';

COMMIT;
