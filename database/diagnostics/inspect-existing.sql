-- Diagnóstico de metadatos de una instalación Supabase existente.
-- No instala, inicializa, modifica datos ni ejecuta funciones KVG.
-- Solo consulta pg_catalog y la configuración de los dos buckets KVG.
BEGIN READ ONLY;

WITH
expected_tables(name) AS (
    VALUES
        ('cliente'), ('tipo_identificacion'), ('identificacion_cliente'),
        ('contacto_cliente'), ('estado_expediente'), ('expediente'),
        ('asignacion_expediente'), ('historial_estado_expediente'),
        ('avance_expediente'), ('avance_version'), ('categoria_documento'),
        ('estado_documento'), ('documento'), ('historial_asociacion_documento'),
        ('carga_archivo'), ('version_documento'), ('revision_documento'),
        ('historial_estado_documento'), ('evento_retiro_documento'),
        ('medida_conservacion'), ('usuario'), ('rol'), ('permiso'),
        ('usuario_rol'), ('rol_permiso'), ('concesion_acceso'),
        ('concesion_permiso'), ('sesion_aplicacion'), ('evento_auditoria'),
        ('trabajo_operativo'), ('politica_respaldo'), ('respaldo'),
        ('elemento_manifiesto'), ('restauracion'), ('parametro_sistema'),
        ('historial_parametro'), ('evento_restriccion')
),
expected_schemas(name) AS (
    VALUES ('public'), ('kvg'), ('kvg_privado'), ('auth'), ('storage')
),
expected_roles(name) AS (
    VALUES ('anon'), ('authenticated'), ('service_role')
),
roles AS (
    SELECT e.name, r.oid
    FROM expected_roles e
    LEFT JOIN pg_catalog.pg_roles r ON r.rolname = e.name
),
expected_functions(signature, allowed_role) AS (
    VALUES
        ('public.kvg_operar(text,jsonb)', 'authenticated'),
        ('public.kvg_trabajar(text,jsonb)', 'service_role'),
        ('public.kvg_inicializar(uuid,uuid,text,text,text)', NULL)
),
entry_functions AS (
    SELECT e.signature, e.allowed_role,
           pg_catalog.to_regprocedure(e.signature)::oid AS oid
    FROM expected_functions e
),
tables AS (
    SELECT c.*
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'kvg' AND c.relkind IN ('r', 'p')
),
functions AS (
    SELECT p.*, n.nspname,
           p.oid::regprocedure::text AS signature
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'kvg_privado'
       OR (n.nspname = 'public'
           AND p.proname IN ('kvg_operar', 'kvg_trabajar', 'kvg_inicializar'))
),
sequences AS (
    SELECT c.*
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'kvg' AND c.relkind = 'S'
),
-- ACL explícita cuando existe; predeterminada de PostgreSQL si es NULL.
-- No muestra las entradas del propietario; lo identifica por separado.
objects AS (
    SELECT 'FUNCION' AS type, f.signature AS name, f.proowner AS owner,
           f.proacl AS acl, 'f'::"char" AS acl_type
    FROM functions f
    UNION ALL
    SELECT 'TABLA', 'kvg.' || t.relname, t.relowner, t.relacl, 'r'::"char"
    FROM tables t
    UNION ALL
    SELECT 'SECUENCIA', 'kvg.' || s.relname, s.relowner, s.relacl, 's'::"char"
    FROM sequences s
    UNION ALL
    SELECT 'ESQUEMA', n.nspname, n.nspowner, n.nspacl, 'n'::"char"
    FROM pg_catalog.pg_namespace n
    WHERE n.nspname IN ('public', 'kvg', 'kvg_privado')
),
acl_entries AS (
    SELECT o.type, o.name,
           CASE WHEN o.acl IS NULL THEN 'PREDETERMINADA_POR_ACL_NULA'
                ELSE 'ACL_EXPLICITA' END AS source,
           CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                ELSE pg_catalog.pg_get_userbyid(a.grantee)::text END AS grantee,
           a.privilege_type AS privilege, a.is_grantable
    FROM objects o
    CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(o.acl, pg_catalog.acldefault(o.acl_type, o.owner))
    ) a
    WHERE a.grantee <> o.owner
),
entry_access AS (
    SELECT e.signature, r.name AS role, r.oid IS NOT NULL AS role_exists,
           e.oid IS NOT NULL AS function_exists,
           r.name = COALESCE(e.allowed_role, '') AS expected_execute,
           CASE WHEN r.oid IS NOT NULL AND e.oid IS NOT NULL
                THEN pg_catalog.has_function_privilege(r.oid, e.oid, 'EXECUTE')
                ELSE NULL END AS actual_execute
    FROM entry_functions e CROSS JOIN roles r
),
unexpected_function_access AS (
    SELECT f.signature, r.name AS role
    FROM functions f CROSS JOIN roles r
    WHERE r.oid IS NOT NULL
      AND pg_catalog.has_function_privilege(r.oid, f.oid, 'EXECUTE')
      AND NOT EXISTS (
          SELECT 1 FROM entry_functions e
          WHERE e.oid = f.oid AND e.allowed_role = r.name
      )
),
unexpected_table_access AS (
    SELECT 'kvg.' || t.relname AS name, r.name AS role
    FROM tables t CROSS JOIN roles r
    WHERE r.oid IS NOT NULL
      AND pg_catalog.has_table_privilege(
          r.oid, t.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      )
),
unexpected_sequence_access AS (
    SELECT 'kvg.' || s.relname AS name, r.name AS role
    FROM sequences s CROSS JOIN roles r
    WHERE r.oid IS NOT NULL
      AND pg_catalog.has_sequence_privilege(r.oid, s.oid, 'USAGE,SELECT,UPDATE')
),
table_policies AS (
    SELECT t.relname AS name, p.polname AS policy, p.polcmd::text AS command,
           p.polpermissive AS permissive,
           ARRAY(
               SELECT CASE WHEN role_oid = 0 THEN 'PUBLIC'
                           ELSE pg_catalog.pg_get_userbyid(role_oid)::text END
               FROM unnest(p.polroles) AS policy_role(role_oid)
               ORDER BY 1
           ) AS roles
    FROM tables t JOIN pg_catalog.pg_policy p ON p.polrelid = t.oid
),
expected_buckets(id) AS (
    VALUES ('kvg-cuarentena'), ('kvg-originales')
),
bucket_metadata AS (
    SELECT e.id AS expected_id, b.id IS NOT NULL AS present,
           b.name, b.public, b.file_size_limit, b.allowed_mime_types,
           b.public = false AND b.file_size_limit = 20000000
           AND b.allowed_mime_types @> ARRAY[
               'application/pdf',
               'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
               'image/jpeg', 'image/png'
           ]::text[]
           AND b.allowed_mime_types <@ ARRAY[
               'application/pdf',
               'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
               'image/jpeg', 'image/png'
           ]::text[] AS matches_expected_limits
    FROM expected_buckets e
    LEFT JOIN storage.buckets b ON b.id = e.id
),
report(section, result) AS (
    SELECT '01_entorno', jsonb_build_object(
        'postgres_version_num', current_setting('server_version_num')::integer,
        'postgres_15_o_superior', current_setting('server_version_num')::integer >= 150000,
        'transaccion_solo_lectura', current_setting('transaction_read_only') = 'on',
        'alcance', 'Metadatos; no prueba funcional ni comparación de cuerpos SQL'
    )
    UNION ALL
    SELECT '02_esquemas_y_roles', jsonb_build_object(
        'esquemas', (SELECT jsonb_agg(jsonb_build_object(
            'nombre', e.name, 'presente', n.oid IS NOT NULL
        ) ORDER BY e.name)
            FROM expected_schemas e
            LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = e.name),
        'roles', (SELECT jsonb_agg(jsonb_build_object(
            'nombre', r.name, 'presente', r.oid IS NOT NULL
        ) ORDER BY r.name) FROM roles r)
    )
    UNION ALL
    SELECT '03_tablas', jsonb_build_object(
        'cantidad_esperada', (SELECT count(*) FROM expected_tables),
        'cantidad_en_kvg', (SELECT count(*) FROM tables),
        'faltantes', (SELECT COALESCE(jsonb_agg(e.name ORDER BY e.name), '[]'::jsonb)
            FROM expected_tables e
            WHERE NOT EXISTS (SELECT 1 FROM tables t WHERE t.relname = e.name)),
        'adicionales', (SELECT COALESCE(jsonb_agg(t.relname ORDER BY t.relname), '[]'::jsonb)
            FROM tables t
            WHERE NOT EXISTS (SELECT 1 FROM expected_tables e WHERE e.name = t.relname))
    )
    UNION ALL
    SELECT '04_firmas_de_entrada', (SELECT jsonb_agg(jsonb_build_object(
        'firma_esperada', e.signature, 'presente', p.oid IS NOT NULL,
        'es_funcion', p.prokind = 'f',
        'devuelve', pg_catalog.pg_get_function_result(p.oid),
        'security_definer', p.prosecdef,
        'propietario', pg_catalog.pg_get_userbyid(p.proowner)
    ) ORDER BY e.signature)
        FROM entry_functions e LEFT JOIN pg_catalog.pg_proc p ON p.oid = e.oid)
    UNION ALL
    SELECT '05_acl_de_catalogo', jsonb_build_object(
        'objetos', (SELECT jsonb_agg(jsonb_build_object(
            'tipo', o.type, 'nombre', o.name,
            'propietario', pg_catalog.pg_get_userbyid(o.owner),
            'acl_explicita', o.acl IS NOT NULL
        ) ORDER BY o.type, o.name) FROM objects o),
        'concesiones_sin_propietario', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'tipo', a.type, 'nombre', a.name, 'origen', a.source,
            'beneficiario', a.grantee, 'privilegio', a.privilege,
            'puede_otorgar', a.is_grantable
        ) ORDER BY a.type, a.name, a.grantee, a.privilege), '[]'::jsonb)
            FROM acl_entries a)
    )
    UNION ALL
    SELECT '06_privilegios_efectivos_roles_app', jsonb_build_object(
        'entradas_rpc', (SELECT jsonb_agg(jsonb_build_object(
            'firma', e.signature, 'rol', e.role,
            'rol_presente', e.role_exists, 'funcion_presente', e.function_exists,
            'execute_esperado', e.expected_execute, 'execute_actual', e.actual_execute,
            'coincide', e.actual_execute = e.expected_execute
        ) ORDER BY e.signature, e.role) FROM entry_access e),
        'ejecucion_funciones_no_esperada', (SELECT COALESCE(jsonb_agg(to_jsonb(f)
            ORDER BY f.signature, f.role), '[]'::jsonb) FROM unexpected_function_access f),
        'acceso_directo_tablas_no_esperado', (SELECT COALESCE(jsonb_agg(to_jsonb(t)
            ORDER BY t.name, t.role), '[]'::jsonb) FROM unexpected_table_access t),
        'acceso_directo_secuencias_no_esperado', (SELECT COALESCE(jsonb_agg(to_jsonb(s)
            ORDER BY s.name, s.role), '[]'::jsonb) FROM unexpected_sequence_access s)
    )
    UNION ALL
    SELECT '07_rls_y_politicas', jsonb_build_object(
        'tablas_con_rls', (SELECT count(*) FROM tables WHERE relrowsecurity),
        'tablas_sin_rls', (SELECT COALESCE(jsonb_agg(relname ORDER BY relname), '[]'::jsonb)
            FROM tables WHERE NOT relrowsecurity),
        'tablas_con_force_rls', (SELECT COALESCE(jsonb_agg(relname ORDER BY relname), '[]'::jsonb)
            FROM tables WHERE relforcerowsecurity),
        'tablas_sin_politica_lectura_controlada', (SELECT COALESCE(jsonb_agg(t.relname
            ORDER BY t.relname), '[]'::jsonb) FROM tables t
            WHERE NOT EXISTS (SELECT 1 FROM table_policies p
                WHERE p.name = t.relname AND p.policy = 'lectura_controlada')),
        'politicas', (SELECT COALESCE(jsonb_agg(to_jsonb(p)
            ORDER BY p.name, p.policy), '[]'::jsonb) FROM table_policies p)
    )
    UNION ALL
    SELECT '08_buckets_privados', (SELECT jsonb_agg(jsonb_build_object(
        'id_esperado', b.expected_id, 'presente', b.present, 'nombre', b.name,
        'publico', b.public, 'limite_bytes', b.file_size_limit,
        'mime_permitidos', b.allowed_mime_types,
        'coincide_con_limites_baseline', b.matches_expected_limits
    ) ORDER BY b.expected_id) FROM bucket_metadata b)
)
SELECT section AS seccion, result AS resultado
FROM report
ORDER BY section;

-- Cierra la transacción de diagnóstico sin confirmar cambios.
ROLLBACK;
