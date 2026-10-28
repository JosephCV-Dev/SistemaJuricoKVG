-- CU001/CU004: reintentar un alta tras perder la respuesta no debe duplicarla.
-- Extensión optativa del RPC con solicitud_id; conserva las operaciones previas.
-- Ejecutar explícitamente como propietario. No cambia la baseline ni los alcances.
BEGIN;

CREATE TABLE kvg_privado.solicitud_creacion (
    usuario_id uuid NOT NULL REFERENCES kvg.usuario(usuario_id),
    operacion text NOT NULL CHECK (operacion IN ('cliente.registrar','expediente.crear')),
    solicitud_id uuid NOT NULL,
    contenido_sha256 varchar(64) NOT NULL CHECK (contenido_sha256 ~ '^[0-9a-f]{64}$'),
    recurso_id uuid NOT NULL,
    creada_en timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (usuario_id,operacion,solicitud_id)
);
REVOKE ALL ON kvg_privado.solicitud_creacion FROM PUBLIC,anon,authenticated,service_role,kvg_session_store;
ALTER TABLE kvg_privado.solicitud_creacion ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION kvg_privado.crear_una_vez(p_operacion text,p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE
    v_actor uuid := kvg_privado.usuario_actual();
    v_solicitud uuid;
    v_hash text;
    v_previa kvg_privado.solicitud_creacion;
    v_salida jsonb;
    v_recurso uuid;
BEGIN
    PERFORM kvg_privado.exigir(p_operacion IN ('cliente.registrar','expediente.crear')
        AND kvg_privado.puede_global(p_operacion));
    PERFORM kvg_privado.validar_campos(p_datos,CASE WHEN p_operacion = 'cliente.registrar'
        THEN ARRAY['solicitud_id','nombre','identificaciones','contactos']
        ELSE ARRAY['solicitud_id','cliente_id','descripcion','numero_externo','autoridad_externa'] END);
    v_solicitud := (p_datos->>'solicitud_id')::uuid;
    IF v_solicitud IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Se requiere solicitud_id.';
    END IF;
    v_hash := encode(extensions.digest((p_datos - 'solicitud_id')::text,'sha256'),'hex');
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || p_operacion || ':' || v_solicitud::text,0));
    SELECT * INTO v_previa FROM kvg_privado.solicitud_creacion
      WHERE usuario_id = v_actor AND operacion = p_operacion AND solicitud_id = v_solicitud;
    IF FOUND THEN
        IF v_previa.contenido_sha256 <> v_hash THEN
            RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Solicitud reutilizada con otro contenido.';
        END IF;
        -- Nunca se devuelve una respuesta guardada sin verificar el alcance actual.
        IF p_operacion = 'cliente.registrar' THEN
            RETURN kvg_privado.clientes('cliente.consultar',jsonb_build_object('cliente_id',v_previa.recurso_id));
        END IF;
        RETURN kvg_privado.expedientes('expediente.consultar',jsonb_build_object('expediente_id',v_previa.recurso_id));
    END IF;
    IF p_operacion = 'cliente.registrar' THEN
        v_salida := kvg_privado.clientes(p_operacion,p_datos - 'solicitud_id');
        v_recurso := (v_salida->>'cliente_id')::uuid;
    ELSE
        v_salida := kvg_privado.expedientes(p_operacion,p_datos - 'solicitud_id');
        v_recurso := (v_salida->>'expediente_id')::uuid;
    END IF;
    INSERT INTO kvg_privado.solicitud_creacion(usuario_id,operacion,solicitud_id,contenido_sha256,recurso_id)
      VALUES (v_actor,p_operacion,v_solicitud,v_hash,v_recurso);
    RETURN v_salida;
END;
$func$;
REVOKE ALL ON FUNCTION kvg_privado.crear_una_vez(text,jsonb) FROM PUBLIC,anon,authenticated,service_role,kvg_session_store;

-- Se añade únicamente una rama fija al despachador instalado por la migración 002.
-- El resto del cuerpo y los privilegios se conservan sin renombrar la función pública.
DO $migration$
DECLARE v_body text; v_previous text;
BEGIN
    SELECT prosrc INTO v_body FROM pg_proc
      WHERE oid = 'public.kvg_operar(text,jsonb)'::regprocedure;
    v_previous := 'ELSIF p_operacion LIKE ''cliente.%'' THEN';
    IF strpos(v_body,'''sesion.consultar''') = 0 OR
       strpos(v_body,v_previous) = 0 OR strpos(v_body,'crear_una_vez') > 0 THEN
        RAISE EXCEPTION 'El despachador no corresponde al contrato previo esperado.';
    END IF;
    v_body := replace(v_body,v_previous,
      'ELSIF p_operacion IN (''cliente.registrar'',''expediente.crear'') AND p_datos ? ''solicitud_id'' THEN
                v_salida := kvg_privado.crear_una_vez(p_operacion,p_datos);
            ' || v_previous);
    EXECUTE format('CREATE OR REPLACE FUNCTION public.kvg_operar(p_operacion text,p_datos jsonb DEFAULT ''{}'')
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '''' AS %L',v_body);
END;
$migration$;

COMMENT ON TABLE kvg_privado.solicitud_creacion IS
  'Idempotencia transaccional por actor, operación y UUID de solicitud. Guarda hash y recurso, sin respuestas ni datos personales. Revalidar alcance al reintentar. Sin limpieza automática mientras se necesite la garantía de reintento.';
COMMIT;
