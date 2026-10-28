-- Pruebas acotadas de contrato, privilegios y rechazo sin identidad.
-- Ejecutar explícitamente como propietario en desarrollo, tras la migración
-- 202610280002. No crea usuarios ni afirma haber probado MFA o sesiones válidas.
-- El rechazo genera auditoría dentro de esta transacción y se revierte al final.
BEGIN;

DO $contrato$
DECLARE
    v_helper oid := to_regprocedure('kvg_privado.consultar_sesion()');
    v_entrada oid := to_regprocedure('public.kvg_operar(text,jsonb)');
    v_rol text;
BEGIN
    IF v_helper IS NULL OR v_entrada IS NULL THEN
        RAISE EXCEPTION 'Falta la migración de contexto de sesión.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                   WHERE p.oid = v_helper AND p.prosecdef
                     AND p.prorettype = 'jsonb'::regtype
                     AND p.proconfig @> ARRAY['search_path=""']) THEN
        RAISE EXCEPTION 'El helper debe devolver jsonb con SECURITY DEFINER y search_path vacío.';
    END IF;
    FOREACH v_rol IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
        IF has_function_privilege(v_rol,v_helper,'EXECUTE') THEN
            RAISE EXCEPTION 'El helper privado es ejecutable por un rol de aplicación.';
        END IF;
    END LOOP;
    IF NOT has_function_privilege('authenticated',v_entrada,'EXECUTE')
       OR has_function_privilege('anon',v_entrada,'EXECUTE')
       OR has_function_privilege('service_role',v_entrada,'EXECUTE') THEN
        RAISE EXCEPTION 'Los privilegios del despachador no coinciden con el contrato.';
    END IF;
END;
$contrato$;

-- Sin identidad Auth ni sesión real; no se fabrica una identidad satisfactoria.
SET LOCAL request.jwt.claims = '{}';
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL ROLE authenticated;

DO $denegacion$
DECLARE
    v_resultado jsonb;
BEGIN
    v_resultado := public.kvg_operar('sesion.consultar','{}'::jsonb);
    IF v_resultado->'correcto' IS DISTINCT FROM 'false'::jsonb
       OR v_resultado->>'codigo' IS DISTINCT FROM '42501'
       OR v_resultado ? 'datos' THEN
        RAISE EXCEPTION 'Una petición sin identidad no debe obtener contexto de sesión.';
    END IF;
END;
$denegacion$;

ROLLBACK;
