/*
 Despacho Jurídico KVG. Modelo físico de la base de datos.
 PostgreSQL 15 o superior con Supabase Auth y Storage.
 RUP de Elaboración 2.0 y modelo lógico 1.1.
 Instalación inicial: ejecutar el archivo completo como propietario
 en un proyecto Supabase sin un esquema kvg previo.
 Los procesos de archivos, antimalware y copias cifradas corresponden
 a los servicios de aplicación; el SQL controla su registro y autorización.
*/

BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL timezone = 'UTC';

DO $precondiciones$
BEGIN
    IF current_setting('server_version_num')::integer < 150000 THEN
        RAISE EXCEPTION 'Se requiere PostgreSQL 15 o superior.';
    END IF;
    IF to_regclass('auth.users') IS NULL OR to_regclass('auth.sessions') IS NULL
       OR to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
        RAISE EXCEPTION 'La instalación requiere los esquemas Auth y Storage de Supabase.';
    END IF;
    IF to_regnamespace('kvg') IS NOT NULL THEN
        RAISE EXCEPTION 'El esquema kvg ya existe; la instalación inicial no sobrescribe datos.';
    END IF;
END;
$precondiciones$;

-- 1. Esquemas y dominios.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
CREATE SCHEMA kvg;
CREATE SCHEMA kvg_privado;
REVOKE ALL ON SCHEMA kvg, kvg_privado FROM PUBLIC, anon, authenticated, service_role;
SET LOCAL search_path = kvg, extensions, pg_catalog;

CREATE DOMAIN kvg.codigo AS varchar(64)
    CHECK (VALUE ~ '^[A-Za-z][A-Za-z0-9_.-]{0,63}$');
CREATE DOMAIN kvg.sha256 AS varchar(64)
    CHECK (VALUE ~ '^[0-9a-f]{64}$');
CREATE DOMAIN kvg.texto_32 AS varchar(32) CHECK (length(btrim(VALUE)) > 0);
CREATE DOMAIN kvg.texto_40 AS varchar(40) CHECK (length(btrim(VALUE)) > 0);
CREATE DOMAIN kvg.texto_80 AS varchar(80) CHECK (length(btrim(VALUE)) > 0);
CREATE DOMAIN kvg.texto_100 AS varchar(100) CHECK (length(btrim(VALUE)) > 0);
CREATE DOMAIN kvg.texto_128 AS varchar(128) CHECK (length(btrim(VALUE)) > 0);
CREATE DOMAIN kvg.texto_200 AS varchar(200) CHECK (length(btrim(VALUE)) > 0);
CREATE DOMAIN kvg.texto_254 AS varchar(254) CHECK (length(btrim(VALUE)) > 0);
CREATE DOMAIN kvg.texto_255 AS varchar(255) CHECK (length(btrim(VALUE)) > 0);
CREATE DOMAIN kvg.texto_512 AS varchar(512) CHECK (length(btrim(VALUE)) > 0);
CREATE DOMAIN kvg.texto_1024 AS varchar(1024) CHECK (length(btrim(VALUE)) > 0);
CREATE DOMAIN kvg.texto_2000 AS varchar(2000) CHECK (length(btrim(VALUE)) > 0);
CREATE DOMAIN kvg.texto_4000 AS varchar(4000) CHECK (length(btrim(VALUE)) > 0);

CREATE FUNCTION kvg_privado.metadatos_validos(p_datos jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $func$
    SELECT p_datos IS NULL OR
      (jsonb_typeof(p_datos) = 'object' AND octet_length(p_datos::text) <= 8192
       AND NOT EXISTS (
          SELECT 1 FROM jsonb_each(p_datos) x
          WHERE x.key <> ALL(ARRAY['tabla','campos','revision','version_id',
             'carga_id','expediente_id','usuario_id','rol_id','permiso_id',
             'contexto','numero_version','estado','codigo','cantidad','tipo',
             'efecto','asignacion_id','concesion_id','medida_id','auth_usuario_id',
             'estado_cuenta','trabajo_id','respaldo_id','restauracion_id'])
             OR jsonb_typeof(x.value) NOT IN ('string','number','boolean','null','array')
             OR octet_length(x.value::text) > 1024));
$func$;
CREATE SEQUENCE kvg.folio_expediente_seq AS bigint START WITH 1;

-- 2. Tablas del modelo relacional.

-- D01. Cliente.
CREATE TABLE kvg.cliente (
    cliente_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tipo_cliente kvg.codigo DEFAULT 'PERSONA_FISICA' NOT NULL,
    nombre_presentacion kvg.texto_200 NOT NULL,
    creado_por uuid NOT NULL,
    creado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    actualizado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    CONSTRAINT pk_cliente PRIMARY KEY (cliente_id),
    CONSTRAINT ck_cliente_revision CHECK (revision > 0)
);

-- D02. Tipo de identificación.
CREATE TABLE kvg.tipo_identificacion (
    tipo_identificacion_codigo kvg.codigo NOT NULL,
    nombre kvg.texto_200 NOT NULL,
    regla_normalizacion kvg.texto_512 NOT NULL,
    unicidad_exigida boolean DEFAULT false NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    CONSTRAINT pk_tipo_identificacion PRIMARY KEY (tipo_identificacion_codigo),
    CONSTRAINT ck_tipo_identificacion_revision CHECK (revision > 0)
);

-- D03. Identificación del cliente.
CREATE TABLE kvg.identificacion_cliente (
    identificacion_id uuid DEFAULT gen_random_uuid() NOT NULL,
    cliente_id uuid NOT NULL,
    tipo_identificacion_codigo kvg.codigo NOT NULL,
    valor_original kvg.texto_100 NOT NULL,
    valor_normalizado kvg.texto_100 NOT NULL,
    regla_revision integer NOT NULL,
    registrado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    registrado_por uuid NOT NULL,
    retirado_en timestamptz,
    CONSTRAINT pk_identificacion_cliente PRIMARY KEY (identificacion_id),
    CONSTRAINT ck_identificacion_cliente_regla_revision CHECK (regla_revision > 0)
);

-- D04. Medio de contacto.
CREATE TABLE kvg.contacto_cliente (
    contacto_id uuid DEFAULT gen_random_uuid() NOT NULL,
    cliente_id uuid NOT NULL,
    tipo kvg.codigo NOT NULL,
    valor kvg.texto_254 NOT NULL,
    etiqueta kvg.texto_80,
    preferente boolean DEFAULT false NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    registrado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    registrado_por uuid NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    CONSTRAINT pk_contacto_cliente PRIMARY KEY (contacto_id),
    CONSTRAINT ck_contacto_cliente_revision CHECK (revision > 0)
);

-- D05. Estado del expediente.
CREATE TABLE kvg.estado_expediente (
    estado_expediente_codigo kvg.codigo NOT NULL,
    nombre kvg.texto_200 NOT NULL,
    definicion kvg.texto_2000 NOT NULL,
    CONSTRAINT pk_estado_expediente PRIMARY KEY (estado_expediente_codigo)
);

-- D06. Expediente.
CREATE TABLE kvg.expediente (
    expediente_id uuid DEFAULT gen_random_uuid() NOT NULL,
    folio_interno kvg.texto_40 NOT NULL,
    cliente_principal_id uuid NOT NULL,
    descripcion kvg.texto_2000 NOT NULL,
    numero_externo kvg.texto_100,
    autoridad_externa kvg.texto_512,
    estado_expediente_codigo kvg.codigo DEFAULT 'NUEVO' NOT NULL,
    creado_por uuid NOT NULL,
    creado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    actualizado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    CONSTRAINT pk_expediente PRIMARY KEY (expediente_id),
    CONSTRAINT uq_expediente_folio_interno UNIQUE (folio_interno),
    CONSTRAINT ck_expediente_revision CHECK (revision > 0)
);

-- D07. Asignación de abogado.
CREATE TABLE kvg.asignacion_expediente (
    asignacion_id uuid DEFAULT gen_random_uuid() NOT NULL,
    expediente_id uuid NOT NULL,
    abogado_id uuid NOT NULL,
    funcion kvg.codigo NOT NULL,
    inicia_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    finaliza_en timestamptz,
    asignado_por uuid NOT NULL,
    motivo_alta kvg.texto_2000 NOT NULL,
    autorizado_por uuid,
    cerrado_por uuid,
    motivo_cierre kvg.texto_2000,
    CONSTRAINT pk_asignacion_expediente PRIMARY KEY (asignacion_id)
);

-- D08. Historial de estados del expediente.
CREATE TABLE kvg.historial_estado_expediente (
    cambio_expediente_id uuid DEFAULT gen_random_uuid() NOT NULL,
    expediente_id uuid NOT NULL,
    estado_origen_codigo kvg.codigo,
    estado_destino_codigo kvg.codigo NOT NULL,
    motivo kvg.texto_2000 NOT NULL,
    registrado_por uuid NOT NULL,
    registrado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    decidido_por uuid,
    referencia_autorizacion kvg.texto_512,
    revision_resultante integer NOT NULL,
    CONSTRAINT pk_historial_estado_expediente PRIMARY KEY (cambio_expediente_id),
    CONSTRAINT ck_historial_estado_expediente_revision_resultante CHECK (revision_resultante > 0)
);

-- D09. Avance del expediente.
CREATE TABLE kvg.avance_expediente (
    avance_id uuid DEFAULT gen_random_uuid() NOT NULL,
    expediente_id uuid NOT NULL,
    descripcion kvg.texto_4000 NOT NULL,
    autor_id uuid NOT NULL,
    registrado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    corrige_avance_id uuid,
    fecha_hecho date,
    procedencia kvg.texto_512,
    CONSTRAINT pk_avance_expediente PRIMARY KEY (avance_id)
);

-- D10. Referencia documental del avance.
CREATE TABLE kvg.avance_version (
    avance_id uuid NOT NULL,
    version_id uuid NOT NULL,
    nota kvg.texto_512,
    CONSTRAINT pk_avance_version PRIMARY KEY (avance_id, version_id)
);

-- D11. Categoría documental.
CREATE TABLE kvg.categoria_documento (
    categoria_id uuid DEFAULT gen_random_uuid() NOT NULL,
    codigo kvg.codigo NOT NULL,
    nombre kvg.texto_200 NOT NULL,
    descripcion kvg.texto_2000,
    activo boolean DEFAULT true NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    CONSTRAINT pk_categoria_documento PRIMARY KEY (categoria_id),
    CONSTRAINT uq_categoria_documento_codigo UNIQUE (codigo),
    CONSTRAINT ck_categoria_documento_revision CHECK (revision > 0)
);

-- D12. Estado jurídico del documento.
CREATE TABLE kvg.estado_documento (
    estado_documento_codigo kvg.codigo NOT NULL,
    nombre kvg.texto_200 NOT NULL,
    definicion kvg.texto_2000 NOT NULL,
    CONSTRAINT pk_estado_documento PRIMARY KEY (estado_documento_codigo)
);

-- D13. Documento.
CREATE TABLE kvg.documento (
    documento_id uuid DEFAULT gen_random_uuid() NOT NULL,
    expediente_id uuid NOT NULL,
    nombre kvg.texto_200 NOT NULL,
    categoria_id uuid NOT NULL,
    version_vigente_id uuid,
    retirado_en timestamptz,
    creado_por uuid NOT NULL,
    creado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    actualizado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    CONSTRAINT pk_documento PRIMARY KEY (documento_id),
    CONSTRAINT ck_documento_revision CHECK (revision > 0)
);

-- D14. Historial de asociación documental.
CREATE TABLE kvg.historial_asociacion_documento (
    asociacion_evento_id uuid DEFAULT gen_random_uuid() NOT NULL,
    documento_id uuid NOT NULL,
    expediente_origen_id uuid,
    expediente_destino_id uuid NOT NULL,
    version_id uuid,
    registrado_por uuid NOT NULL,
    registrado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    motivo kvg.texto_2000 NOT NULL,
    revision_resultante integer NOT NULL,
    CONSTRAINT pk_historial_asociacion_documento PRIMARY KEY (asociacion_evento_id),
    CONSTRAINT ck_historial_asociacion_documento_revision_resultante CHECK (revision_resultante > 0)
);

-- D15. Carga de archivo.
CREATE TABLE kvg.carga_archivo (
    carga_id uuid DEFAULT gen_random_uuid() NOT NULL,
    documento_id uuid NOT NULL,
    expediente_destino_id uuid NOT NULL,
    solicitado_por uuid NOT NULL,
    revision_documento_base integer NOT NULL,
    clave_idempotencia kvg.texto_128 NOT NULL,
    nombre_original kvg.texto_255 NOT NULL,
    estado_tecnico kvg.codigo DEFAULT 'RECIBIENDO' NOT NULL,
    localizador_cuarentena kvg.texto_1024,
    tamano_recibido_bytes bigint,
    resultado_tecnico_codigo kvg.texto_512,
    motor_version kvg.texto_512,
    solicitado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    verificado_en timestamptz,
    motivo_version kvg.texto_2000 NOT NULL,
    CONSTRAINT pk_carga_archivo PRIMARY KEY (carga_id),
    CONSTRAINT ck_carga_archivo_revision_documento_base CHECK (revision_documento_base > 0),
    CONSTRAINT uq_carga_archivo_clave_idempotencia UNIQUE (clave_idempotencia),
    CONSTRAINT ck_carga_archivo_tamano_recibido_bytes CHECK (tamano_recibido_bytes > 0)
);

-- D16. Versión del documento.
CREATE TABLE kvg.version_documento (
    version_id uuid DEFAULT gen_random_uuid() NOT NULL,
    documento_id uuid NOT NULL,
    numero_version integer NOT NULL,
    carga_id uuid NOT NULL,
    localizador_objeto kvg.texto_1024 NOT NULL,
    sha256 kvg.sha256 NOT NULL,
    tamano_bytes bigint NOT NULL,
    formato kvg.codigo NOT NULL,
    mime_verificado kvg.texto_512 NOT NULL,
    estado_documento_codigo kvg.codigo DEFAULT 'RECIBIDO' NOT NULL,
    publicado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    fecha_origen date,
    procedencia kvg.texto_512,
    revision integer DEFAULT 1 NOT NULL,
    CONSTRAINT pk_version_documento PRIMARY KEY (version_id),
    CONSTRAINT ck_version_documento_numero_version CHECK (numero_version > 0),
    CONSTRAINT uq_version_documento_carga_id UNIQUE (carga_id),
    CONSTRAINT uq_version_documento_localizador_objeto UNIQUE (localizador_objeto),
    CONSTRAINT ck_version_documento_tamano_bytes CHECK (tamano_bytes > 0),
    CONSTRAINT ck_version_documento_revision CHECK (revision > 0)
);

-- D17. Revisión jurídica de versión.
CREATE TABLE kvg.revision_documento (
    revision_juridica_id uuid DEFAULT gen_random_uuid() NOT NULL,
    version_id uuid NOT NULL,
    revisor_id uuid NOT NULL,
    observaciones kvg.texto_4000 NOT NULL,
    resultado kvg.codigo NOT NULL,
    registrado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    corrige_revision_id uuid,
    CONSTRAINT pk_revision_documento PRIMARY KEY (revision_juridica_id)
);

-- D18. Historial de estados de versión.
CREATE TABLE kvg.historial_estado_documento (
    cambio_documento_id uuid DEFAULT gen_random_uuid() NOT NULL,
    version_id uuid NOT NULL,
    estado_origen_codigo kvg.codigo,
    estado_destino_codigo kvg.codigo NOT NULL,
    revision_juridica_id uuid,
    responsable_usuario_id uuid NOT NULL,
    registrado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    motivo kvg.texto_2000 NOT NULL,
    revision_resultante integer NOT NULL,
    CONSTRAINT pk_historial_estado_documento PRIMARY KEY (cambio_documento_id),
    CONSTRAINT ck_historial_estado_documento_revision_resultante CHECK (revision_resultante > 0)
);

-- D19. Historial de retiro y recuperación.
CREATE TABLE kvg.evento_retiro_documento (
    retiro_evento_id uuid DEFAULT gen_random_uuid() NOT NULL,
    documento_id uuid NOT NULL,
    operacion kvg.codigo NOT NULL,
    registrado_por uuid NOT NULL,
    registrado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    motivo kvg.texto_2000 NOT NULL,
    autorizado_por uuid,
    trabajo_verificacion_id uuid,
    revision_resultante integer NOT NULL,
    CONSTRAINT pk_evento_retiro_documento PRIMARY KEY (retiro_evento_id),
    CONSTRAINT ck_evento_retiro_documento_revision_resultante CHECK (revision_resultante > 0)
);

-- D20. Medida de conservación y bloqueo.
CREATE TABLE kvg.medida_conservacion (
    medida_id uuid DEFAULT gen_random_uuid() NOT NULL,
    cliente_id uuid,
    expediente_id uuid,
    documento_id uuid,
    tipo kvg.codigo NOT NULL,
    motivo kvg.texto_2000 NOT NULL,
    autorizado_por uuid NOT NULL,
    inicia_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    finaliza_en timestamptz,
    levantado_por uuid,
    referencia_decision kvg.texto_512 NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    CONSTRAINT pk_medida_conservacion PRIMARY KEY (medida_id),
    CONSTRAINT ck_medida_conservacion_revision CHECK (revision > 0)
);

-- D21. Usuario del personal.
CREATE TABLE kvg.usuario (
    usuario_id uuid DEFAULT gen_random_uuid() NOT NULL,
    auth_usuario_id uuid,
    nombre kvg.texto_200 NOT NULL,
    correo_operativo kvg.texto_254 NOT NULL,
    estado_cuenta kvg.codigo DEFAULT 'INVITADO' NOT NULL,
    creado_por uuid,
    creado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    desactivado_en timestamptz,
    motivo_desactivacion kvg.texto_2000,
    revision_autorizacion integer DEFAULT 1 NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    CONSTRAINT pk_usuario PRIMARY KEY (usuario_id),
    CONSTRAINT uq_usuario_auth_usuario_id UNIQUE (auth_usuario_id),
    CONSTRAINT uq_usuario_correo_operativo UNIQUE (correo_operativo),
    CONSTRAINT ck_usuario_revision_autorizacion CHECK (revision_autorizacion > 0),
    CONSTRAINT ck_usuario_revision CHECK (revision > 0)
);

-- D22. Rol funcional.
CREATE TABLE kvg.rol (
    rol_id uuid DEFAULT gen_random_uuid() NOT NULL,
    codigo kvg.codigo NOT NULL,
    nombre kvg.texto_200 NOT NULL,
    descripcion kvg.texto_2000 NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    CONSTRAINT pk_rol PRIMARY KEY (rol_id),
    CONSTRAINT uq_rol_codigo UNIQUE (codigo),
    CONSTRAINT ck_rol_revision CHECK (revision > 0)
);

-- D23. Permiso de operación.
CREATE TABLE kvg.permiso (
    permiso_id uuid DEFAULT gen_random_uuid() NOT NULL,
    codigo kvg.codigo NOT NULL,
    recurso kvg.codigo NOT NULL,
    descripcion kvg.texto_2000 NOT NULL,
    requiere_mfa boolean DEFAULT true NOT NULL,
    requiere_decision boolean DEFAULT false NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    CONSTRAINT pk_permiso PRIMARY KEY (permiso_id),
    CONSTRAINT uq_permiso_codigo UNIQUE (codigo)
);

-- D24. Asignación temporal de rol.
CREATE TABLE kvg.usuario_rol (
    usuario_rol_id uuid DEFAULT gen_random_uuid() NOT NULL,
    usuario_id uuid NOT NULL,
    rol_id uuid NOT NULL,
    inicia_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    finaliza_en timestamptz,
    otorgado_por uuid NOT NULL,
    motivo_alta kvg.texto_2000 NOT NULL,
    revocado_por uuid,
    motivo_cierre kvg.texto_2000,
    CONSTRAINT pk_usuario_rol PRIMARY KEY (usuario_rol_id)
);

-- D25. Capacidad del rol por contexto.
CREATE TABLE kvg.rol_permiso (
    rol_id uuid NOT NULL,
    permiso_id uuid NOT NULL,
    contexto kvg.codigo NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    aprobado_por uuid NOT NULL,
    aprobado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    CONSTRAINT pk_rol_permiso PRIMARY KEY (rol_id, permiso_id, contexto),
    CONSTRAINT ck_rol_permiso_revision CHECK (revision > 0)
);

-- D26. Acceso explícito a expediente.
CREATE TABLE kvg.concesion_acceso (
    concesion_id uuid DEFAULT gen_random_uuid() NOT NULL,
    expediente_id uuid NOT NULL,
    usuario_id uuid NOT NULL,
    inicia_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    expira_en timestamptz,
    revocado_en timestamptz,
    otorgado_por uuid NOT NULL,
    aprobado_por uuid NOT NULL,
    motivo kvg.texto_2000 NOT NULL,
    referencia_autorizacion kvg.texto_512 NOT NULL,
    revocado_por uuid,
    motivo_revocacion kvg.texto_2000,
    CONSTRAINT pk_concesion_acceso PRIMARY KEY (concesion_id)
);

-- D27. Permiso de una concesión.
CREATE TABLE kvg.concesion_permiso (
    concesion_id uuid NOT NULL,
    permiso_id uuid NOT NULL,
    CONSTRAINT pk_concesion_permiso PRIMARY KEY (concesion_id, permiso_id)
);

-- D28. Sesión operativa.
CREATE TABLE kvg.sesion_aplicacion (
    sesion_id uuid DEFAULT gen_random_uuid() NOT NULL,
    usuario_id uuid NOT NULL,
    identificador_hash kvg.sha256 NOT NULL,
    auth_sesion_ref kvg.texto_128,
    creada_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    ultima_actividad_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    expira_en timestamptz DEFAULT clock_timestamp() + interval '8 hours' NOT NULL,
    mfa_verificado_en timestamptz,
    revocada_en timestamptz,
    motivo_revocacion kvg.codigo,
    CONSTRAINT pk_sesion_aplicacion PRIMARY KEY (sesion_id),
    CONSTRAINT uq_sesion_aplicacion_identificador_hash UNIQUE (identificador_hash)
);

-- D29. Evento de auditoría.
CREATE TABLE kvg.evento_auditoria (
    evento_id uuid DEFAULT gen_random_uuid() NOT NULL,
    ocurrido_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    tipo_actor kvg.codigo NOT NULL,
    usuario_id uuid,
    servicio_codigo kvg.texto_512,
    sesion_id uuid,
    accion kvg.codigo NOT NULL,
    recurso_tipo kvg.codigo NOT NULL,
    recurso_id uuid,
    resultado kvg.codigo NOT NULL,
    correlacion_id uuid NOT NULL,
    detalle_controlado jsonb,
    CONSTRAINT pk_evento_auditoria PRIMARY KEY (evento_id)
);

-- D30. Trabajo operativo persistente.
CREATE TABLE kvg.trabajo_operativo (
    trabajo_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tipo kvg.codigo NOT NULL,
    objetivo_tipo kvg.codigo NOT NULL,
    objetivo_id uuid NOT NULL,
    clave_idempotencia kvg.texto_128 NOT NULL,
    estado kvg.codigo DEFAULT 'EN_COLA' NOT NULL,
    intentos integer DEFAULT 0 NOT NULL,
    max_intentos integer DEFAULT 5 NOT NULL,
    creado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    proximo_intento_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    bloqueo_hasta timestamptz,
    ejecutor_codigo kvg.texto_512,
    finalizado_en timestamptz,
    solicitado_por uuid,
    resultado_codigo kvg.texto_512,
    correlacion_id uuid NOT NULL,
    detalle_solicitud jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detalle_solicitud) = 'object' AND octet_length(detalle_solicitud::text) <= 8192),
    CONSTRAINT pk_trabajo_operativo PRIMARY KEY (trabajo_id),
    CONSTRAINT uq_trabajo_operativo_clave_idempotencia UNIQUE (clave_idempotencia),
    CONSTRAINT ck_trabajo_operativo_intentos CHECK (intentos >= 0),
    CONSTRAINT ck_trabajo_operativo_max_intentos CHECK (max_intentos > 0)
);

-- D31. Política operativa de respaldo.
CREATE TABLE kvg.politica_respaldo (
    politica_respaldo_id uuid DEFAULT gen_random_uuid() NOT NULL,
    numero_revision integer NOT NULL,
    nombre kvg.texto_200 NOT NULL,
    frecuencia_minutos integer NOT NULL,
    rpo_objetivo_segundos integer NOT NULL,
    rto_objetivo_segundos integer NOT NULL,
    destino_ref kvg.texto_512 NOT NULL,
    custodia_clave_ref kvg.texto_512 NOT NULL,
    activa boolean DEFAULT true NOT NULL,
    aprobado_por uuid NOT NULL,
    aprobado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT pk_politica_respaldo PRIMARY KEY (politica_respaldo_id),
    CONSTRAINT ck_politica_respaldo_numero_revision CHECK (numero_revision > 0),
    CONSTRAINT ck_politica_respaldo_frecuencia_minutos CHECK (frecuencia_minutos > 0),
    CONSTRAINT ck_politica_respaldo_rpo_objetivo_segundos CHECK (rpo_objetivo_segundos > 0),
    CONSTRAINT ck_politica_respaldo_rto_objetivo_segundos CHECK (rto_objetivo_segundos > 0)
);

-- D32. Respaldo compuesto.
CREATE TABLE kvg.respaldo (
    respaldo_id uuid DEFAULT gen_random_uuid() NOT NULL,
    politica_respaldo_id uuid NOT NULL,
    trabajo_id uuid NOT NULL,
    punto_recuperacion_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    estado kvg.codigo DEFAULT 'PENDIENTE' NOT NULL,
    manifiesto_localizador kvg.texto_1024,
    manifiesto_sha256 kvg.sha256,
    verificado_en timestamptz,
    evidencia_ref kvg.texto_512,
    CONSTRAINT pk_respaldo PRIMARY KEY (respaldo_id),
    CONSTRAINT uq_respaldo_trabajo_id UNIQUE (trabajo_id)
);

-- D33. Elemento del manifiesto.
CREATE TABLE kvg.elemento_manifiesto (
    respaldo_id uuid NOT NULL,
    numero_elemento bigint NOT NULL,
    tipo kvg.codigo NOT NULL,
    version_origen_id uuid,
    localizador_origen kvg.texto_1024 NOT NULL,
    localizador_copia kvg.texto_1024 NOT NULL,
    sha256_copia kvg.sha256 NOT NULL,
    tamano_copia_bytes bigint NOT NULL,
    sha256_original kvg.sha256,
    tamano_original_bytes bigint,
    copiado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    verificado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    custodia_clave_ref kvg.texto_512 NOT NULL,
    CONSTRAINT pk_elemento_manifiesto PRIMARY KEY (respaldo_id, numero_elemento),
    CONSTRAINT ck_elemento_manifiesto_numero_elemento CHECK (numero_elemento > 0),
    CONSTRAINT ck_elemento_manifiesto_tamano_copia_bytes CHECK (tamano_copia_bytes > 0),
    CONSTRAINT ck_elemento_manifiesto_tamano_original_bytes CHECK (tamano_original_bytes > 0)
);

-- D34. Restauración verificada.
CREATE TABLE kvg.restauracion (
    restauracion_id uuid DEFAULT gen_random_uuid() NOT NULL,
    respaldo_id uuid NOT NULL,
    trabajo_id uuid NOT NULL,
    modalidad kvg.codigo NOT NULL,
    estado kvg.codigo DEFAULT 'SOLICITADA' NOT NULL,
    entorno_aislado_ref kvg.texto_512 NOT NULL,
    autorizado_por uuid,
    autorizado_en timestamptz,
    incidente_en timestamptz,
    verificado_en timestamptz,
    restricciones_hasta timestamptz,
    estado_previo_ref kvg.texto_512,
    servicio_habilitado_en timestamptz,
    rpo_medido_segundos integer,
    rto_medido_segundos integer,
    evidencia_ref kvg.texto_512,
    CONSTRAINT pk_restauracion PRIMARY KEY (restauracion_id),
    CONSTRAINT uq_restauracion_trabajo_id UNIQUE (trabajo_id),
    CONSTRAINT ck_restauracion_rpo_medido_segundos CHECK (rpo_medido_segundos >= 0),
    CONSTRAINT ck_restauracion_rto_medido_segundos CHECK (rto_medido_segundos >= 0)
);

-- D35. Parámetro autorizado.
CREATE TABLE kvg.parametro_sistema (
    parametro_codigo kvg.codigo NOT NULL,
    tipo_valor kvg.codigo NOT NULL,
    valor kvg.texto_1024 NOT NULL,
    regla_validacion kvg.texto_512 NOT NULL,
    editable boolean DEFAULT false NOT NULL,
    modificado_por uuid NOT NULL,
    modificado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    CONSTRAINT pk_parametro_sistema PRIMARY KEY (parametro_codigo),
    CONSTRAINT ck_parametro_sistema_revision CHECK (revision > 0)
);

-- D36. Historial de configuración.
CREATE TABLE kvg.historial_parametro (
    parametro_evento_id uuid DEFAULT gen_random_uuid() NOT NULL,
    parametro_codigo kvg.codigo NOT NULL,
    valor_anterior kvg.texto_1024,
    valor_nuevo kvg.texto_1024 NOT NULL,
    registrado_por uuid NOT NULL,
    registrado_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    motivo kvg.texto_2000 NOT NULL,
    revision_resultante integer NOT NULL,
    CONSTRAINT pk_historial_parametro PRIMARY KEY (parametro_evento_id),
    CONSTRAINT ck_historial_parametro_revision_resultante CHECK (revision_resultante > 0)
);

-- D37. Registro para impedir restitución de accesos.
CREATE TABLE kvg.evento_restriccion (
    restriccion_evento_id uuid DEFAULT gen_random_uuid() NOT NULL,
    ocurrido_en timestamptz DEFAULT clock_timestamp() NOT NULL,
    accion kvg.codigo NOT NULL,
    recurso_tipo kvg.codigo NOT NULL,
    recurso_id kvg.texto_200 NOT NULL,
    registrado_por uuid NOT NULL,
    detalle_controlado jsonb NOT NULL,
    correlacion_id uuid NOT NULL,
    CONSTRAINT pk_evento_restriccion PRIMARY KEY (restriccion_evento_id)
);

-- 3. Claves foráneas. No se utilizan eliminaciones en cascada.
ALTER TABLE kvg.cliente ADD CONSTRAINT fk_d01_creado_por
    FOREIGN KEY (creado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.identificacion_cliente ADD CONSTRAINT fk_d03_cliente_id
    FOREIGN KEY (cliente_id) REFERENCES kvg.cliente (cliente_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.identificacion_cliente ADD CONSTRAINT fk_d03_tipo_identificacion_codigo
    FOREIGN KEY (tipo_identificacion_codigo) REFERENCES kvg.tipo_identificacion (tipo_identificacion_codigo) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.identificacion_cliente ADD CONSTRAINT fk_d03_registrado_por
    FOREIGN KEY (registrado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.contacto_cliente ADD CONSTRAINT fk_d04_cliente_id
    FOREIGN KEY (cliente_id) REFERENCES kvg.cliente (cliente_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.contacto_cliente ADD CONSTRAINT fk_d04_registrado_por
    FOREIGN KEY (registrado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.expediente ADD CONSTRAINT fk_d06_cliente_principal_id
    FOREIGN KEY (cliente_principal_id) REFERENCES kvg.cliente (cliente_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.expediente ADD CONSTRAINT fk_d06_estado_expediente_codigo
    FOREIGN KEY (estado_expediente_codigo) REFERENCES kvg.estado_expediente (estado_expediente_codigo) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.expediente ADD CONSTRAINT fk_d06_creado_por
    FOREIGN KEY (creado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.asignacion_expediente ADD CONSTRAINT fk_d07_expediente_id
    FOREIGN KEY (expediente_id) REFERENCES kvg.expediente (expediente_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.asignacion_expediente ADD CONSTRAINT fk_d07_abogado_id
    FOREIGN KEY (abogado_id) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.asignacion_expediente ADD CONSTRAINT fk_d07_asignado_por
    FOREIGN KEY (asignado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.asignacion_expediente ADD CONSTRAINT fk_d07_autorizado_por
    FOREIGN KEY (autorizado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.asignacion_expediente ADD CONSTRAINT fk_d07_cerrado_por
    FOREIGN KEY (cerrado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.historial_estado_expediente ADD CONSTRAINT fk_d08_expediente_id
    FOREIGN KEY (expediente_id) REFERENCES kvg.expediente (expediente_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.historial_estado_expediente ADD CONSTRAINT fk_d08_estado_origen_codigo
    FOREIGN KEY (estado_origen_codigo) REFERENCES kvg.estado_expediente (estado_expediente_codigo) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.historial_estado_expediente ADD CONSTRAINT fk_d08_estado_destino_codigo
    FOREIGN KEY (estado_destino_codigo) REFERENCES kvg.estado_expediente (estado_expediente_codigo) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.historial_estado_expediente ADD CONSTRAINT fk_d08_registrado_por
    FOREIGN KEY (registrado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.historial_estado_expediente ADD CONSTRAINT fk_d08_decidido_por
    FOREIGN KEY (decidido_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.avance_expediente ADD CONSTRAINT fk_d09_expediente_id
    FOREIGN KEY (expediente_id) REFERENCES kvg.expediente (expediente_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.avance_expediente ADD CONSTRAINT fk_d09_autor_id
    FOREIGN KEY (autor_id) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.avance_expediente ADD CONSTRAINT fk_d09_corrige_avance_id
    FOREIGN KEY (corrige_avance_id) REFERENCES kvg.avance_expediente (avance_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.avance_version ADD CONSTRAINT fk_d10_avance_id
    FOREIGN KEY (avance_id) REFERENCES kvg.avance_expediente (avance_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.avance_version ADD CONSTRAINT fk_d10_version_id
    FOREIGN KEY (version_id) REFERENCES kvg.version_documento (version_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.documento ADD CONSTRAINT fk_d13_expediente_id
    FOREIGN KEY (expediente_id) REFERENCES kvg.expediente (expediente_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.documento ADD CONSTRAINT fk_d13_categoria_id
    FOREIGN KEY (categoria_id) REFERENCES kvg.categoria_documento (categoria_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.documento ADD CONSTRAINT fk_d13_version_vigente_id
    FOREIGN KEY (version_vigente_id) REFERENCES kvg.version_documento (version_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.documento ADD CONSTRAINT fk_d13_creado_por
    FOREIGN KEY (creado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.historial_asociacion_documento ADD CONSTRAINT fk_d14_documento_id
    FOREIGN KEY (documento_id) REFERENCES kvg.documento (documento_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.historial_asociacion_documento ADD CONSTRAINT fk_d14_expediente_origen_id
    FOREIGN KEY (expediente_origen_id) REFERENCES kvg.expediente (expediente_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.historial_asociacion_documento ADD CONSTRAINT fk_d14_expediente_destino_id
    FOREIGN KEY (expediente_destino_id) REFERENCES kvg.expediente (expediente_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.historial_asociacion_documento ADD CONSTRAINT fk_d14_version_id
    FOREIGN KEY (version_id) REFERENCES kvg.version_documento (version_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.historial_asociacion_documento ADD CONSTRAINT fk_d14_registrado_por
    FOREIGN KEY (registrado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.carga_archivo ADD CONSTRAINT fk_d15_documento_id
    FOREIGN KEY (documento_id) REFERENCES kvg.documento (documento_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.carga_archivo ADD CONSTRAINT fk_d15_expediente_destino_id
    FOREIGN KEY (expediente_destino_id) REFERENCES kvg.expediente (expediente_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.carga_archivo ADD CONSTRAINT fk_d15_solicitado_por
    FOREIGN KEY (solicitado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.version_documento ADD CONSTRAINT fk_d16_documento_id
    FOREIGN KEY (documento_id) REFERENCES kvg.documento (documento_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.version_documento ADD CONSTRAINT fk_d16_carga_id
    FOREIGN KEY (carga_id) REFERENCES kvg.carga_archivo (carga_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.version_documento ADD CONSTRAINT fk_d16_estado_documento_codigo
    FOREIGN KEY (estado_documento_codigo) REFERENCES kvg.estado_documento (estado_documento_codigo) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.revision_documento ADD CONSTRAINT fk_d17_version_id
    FOREIGN KEY (version_id) REFERENCES kvg.version_documento (version_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.revision_documento ADD CONSTRAINT fk_d17_revisor_id
    FOREIGN KEY (revisor_id) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.revision_documento ADD CONSTRAINT fk_d17_corrige_revision_id
    FOREIGN KEY (corrige_revision_id) REFERENCES kvg.revision_documento (revision_juridica_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.historial_estado_documento ADD CONSTRAINT fk_d18_version_id
    FOREIGN KEY (version_id) REFERENCES kvg.version_documento (version_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.historial_estado_documento ADD CONSTRAINT fk_d18_estado_origen_codigo
    FOREIGN KEY (estado_origen_codigo) REFERENCES kvg.estado_documento (estado_documento_codigo) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.historial_estado_documento ADD CONSTRAINT fk_d18_estado_destino_codigo
    FOREIGN KEY (estado_destino_codigo) REFERENCES kvg.estado_documento (estado_documento_codigo) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.historial_estado_documento ADD CONSTRAINT fk_d18_revision_juridica_id
    FOREIGN KEY (revision_juridica_id) REFERENCES kvg.revision_documento (revision_juridica_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.historial_estado_documento ADD CONSTRAINT fk_d18_responsable_usuario_id
    FOREIGN KEY (responsable_usuario_id) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.evento_retiro_documento ADD CONSTRAINT fk_d19_documento_id
    FOREIGN KEY (documento_id) REFERENCES kvg.documento (documento_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.evento_retiro_documento ADD CONSTRAINT fk_d19_registrado_por
    FOREIGN KEY (registrado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.evento_retiro_documento ADD CONSTRAINT fk_d19_autorizado_por
    FOREIGN KEY (autorizado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.evento_retiro_documento ADD CONSTRAINT fk_d19_trabajo_verificacion_id
    FOREIGN KEY (trabajo_verificacion_id) REFERENCES kvg.trabajo_operativo (trabajo_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.medida_conservacion ADD CONSTRAINT fk_d20_cliente_id
    FOREIGN KEY (cliente_id) REFERENCES kvg.cliente (cliente_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.medida_conservacion ADD CONSTRAINT fk_d20_expediente_id
    FOREIGN KEY (expediente_id) REFERENCES kvg.expediente (expediente_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.medida_conservacion ADD CONSTRAINT fk_d20_documento_id
    FOREIGN KEY (documento_id) REFERENCES kvg.documento (documento_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.medida_conservacion ADD CONSTRAINT fk_d20_autorizado_por
    FOREIGN KEY (autorizado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.medida_conservacion ADD CONSTRAINT fk_d20_levantado_por
    FOREIGN KEY (levantado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.usuario ADD CONSTRAINT fk_d21_auth_usuario_id
    FOREIGN KEY (auth_usuario_id) REFERENCES auth.users (id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.usuario ADD CONSTRAINT fk_d21_creado_por
    FOREIGN KEY (creado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.usuario_rol ADD CONSTRAINT fk_d24_usuario_id
    FOREIGN KEY (usuario_id) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.usuario_rol ADD CONSTRAINT fk_d24_rol_id
    FOREIGN KEY (rol_id) REFERENCES kvg.rol (rol_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.usuario_rol ADD CONSTRAINT fk_d24_otorgado_por
    FOREIGN KEY (otorgado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.usuario_rol ADD CONSTRAINT fk_d24_revocado_por
    FOREIGN KEY (revocado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.rol_permiso ADD CONSTRAINT fk_d25_rol_id
    FOREIGN KEY (rol_id) REFERENCES kvg.rol (rol_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.rol_permiso ADD CONSTRAINT fk_d25_permiso_id
    FOREIGN KEY (permiso_id) REFERENCES kvg.permiso (permiso_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.rol_permiso ADD CONSTRAINT fk_d25_aprobado_por
    FOREIGN KEY (aprobado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.concesion_acceso ADD CONSTRAINT fk_d26_expediente_id
    FOREIGN KEY (expediente_id) REFERENCES kvg.expediente (expediente_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.concesion_acceso ADD CONSTRAINT fk_d26_usuario_id
    FOREIGN KEY (usuario_id) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.concesion_acceso ADD CONSTRAINT fk_d26_otorgado_por
    FOREIGN KEY (otorgado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.concesion_acceso ADD CONSTRAINT fk_d26_aprobado_por
    FOREIGN KEY (aprobado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.concesion_acceso ADD CONSTRAINT fk_d26_revocado_por
    FOREIGN KEY (revocado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.concesion_permiso ADD CONSTRAINT fk_d27_concesion_id
    FOREIGN KEY (concesion_id) REFERENCES kvg.concesion_acceso (concesion_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.concesion_permiso ADD CONSTRAINT fk_d27_permiso_id
    FOREIGN KEY (permiso_id) REFERENCES kvg.permiso (permiso_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.sesion_aplicacion ADD CONSTRAINT fk_d28_usuario_id
    FOREIGN KEY (usuario_id) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.evento_auditoria ADD CONSTRAINT fk_d29_usuario_id
    FOREIGN KEY (usuario_id) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.evento_auditoria ADD CONSTRAINT fk_d29_sesion_id
    FOREIGN KEY (sesion_id) REFERENCES kvg.sesion_aplicacion (sesion_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.trabajo_operativo ADD CONSTRAINT fk_d30_solicitado_por
    FOREIGN KEY (solicitado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.politica_respaldo ADD CONSTRAINT fk_d31_aprobado_por
    FOREIGN KEY (aprobado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.respaldo ADD CONSTRAINT fk_d32_politica_respaldo_id
    FOREIGN KEY (politica_respaldo_id) REFERENCES kvg.politica_respaldo (politica_respaldo_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.respaldo ADD CONSTRAINT fk_d32_trabajo_id
    FOREIGN KEY (trabajo_id) REFERENCES kvg.trabajo_operativo (trabajo_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.elemento_manifiesto ADD CONSTRAINT fk_d33_respaldo_id
    FOREIGN KEY (respaldo_id) REFERENCES kvg.respaldo (respaldo_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.restauracion ADD CONSTRAINT fk_d34_respaldo_id
    FOREIGN KEY (respaldo_id) REFERENCES kvg.respaldo (respaldo_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.restauracion ADD CONSTRAINT fk_d34_trabajo_id
    FOREIGN KEY (trabajo_id) REFERENCES kvg.trabajo_operativo (trabajo_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.restauracion ADD CONSTRAINT fk_d34_autorizado_por
    FOREIGN KEY (autorizado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.parametro_sistema ADD CONSTRAINT fk_d35_modificado_por
    FOREIGN KEY (modificado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.historial_parametro ADD CONSTRAINT fk_d36_parametro_codigo
    FOREIGN KEY (parametro_codigo) REFERENCES kvg.parametro_sistema (parametro_codigo) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.historial_parametro ADD CONSTRAINT fk_d36_registrado_por
    FOREIGN KEY (registrado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE kvg.evento_restriccion ADD CONSTRAINT fk_d37_registrado_por
    FOREIGN KEY (registrado_por) REFERENCES kvg.usuario (usuario_id) ON UPDATE RESTRICT ON DELETE RESTRICT;

-- 4. Identidades compuestas y correspondencia de versiones.
ALTER TABLE kvg.carga_archivo ADD CONSTRAINT uq_carga_documento UNIQUE (documento_id, carga_id);
ALTER TABLE kvg.version_documento ADD CONSTRAINT uq_version_documento UNIQUE (documento_id, version_id);
ALTER TABLE kvg.version_documento ADD CONSTRAINT uq_numero_version UNIQUE (documento_id, numero_version);
ALTER TABLE kvg.revision_documento ADD CONSTRAINT uq_revision_version UNIQUE (version_id, revision_juridica_id);
ALTER TABLE kvg.avance_expediente ADD CONSTRAINT uq_avance_expediente UNIQUE (expediente_id, avance_id);
ALTER TABLE kvg.sesion_aplicacion ADD CONSTRAINT uq_sesion_usuario UNIQUE (usuario_id, sesion_id);
ALTER TABLE kvg.documento ADD CONSTRAINT fk_vigente_mismo_documento
    FOREIGN KEY (documento_id, version_vigente_id) REFERENCES kvg.version_documento (documento_id, version_id)
    DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE kvg.version_documento ADD CONSTRAINT fk_carga_mismo_documento
    FOREIGN KEY (documento_id, carga_id) REFERENCES kvg.carga_archivo (documento_id, carga_id);
ALTER TABLE kvg.revision_documento ADD CONSTRAINT fk_correccion_misma_version
    FOREIGN KEY (version_id, corrige_revision_id) REFERENCES kvg.revision_documento (version_id, revision_juridica_id);
ALTER TABLE kvg.historial_estado_documento ADD CONSTRAINT fk_revision_estado_misma_version
    FOREIGN KEY (version_id, revision_juridica_id) REFERENCES kvg.revision_documento (version_id, revision_juridica_id);
ALTER TABLE kvg.avance_expediente ADD CONSTRAINT fk_correccion_mismo_expediente
    FOREIGN KEY (expediente_id, corrige_avance_id) REFERENCES kvg.avance_expediente (expediente_id, avance_id);
ALTER TABLE kvg.historial_asociacion_documento ADD CONSTRAINT fk_asociacion_misma_version
    FOREIGN KEY (documento_id, version_id) REFERENCES kvg.version_documento (documento_id, version_id);
ALTER TABLE kvg.evento_auditoria ADD CONSTRAINT fk_actor_sesion
    FOREIGN KEY (usuario_id, sesion_id) REFERENCES kvg.sesion_aplicacion (usuario_id, sesion_id);

-- 5. Restricciones de dominio, temporalidad y estados.
ALTER TABLE kvg.cliente ADD CONSTRAINT ck_tipo_cliente CHECK ((tipo_cliente = 'PERSONA_FISICA') IS TRUE);
ALTER TABLE kvg.tipo_identificacion ADD CONSTRAINT ck_regla_identificacion
 CHECK ((regla_normalizacion IN ('EXACTA_V1','MAYUSCULAS_V1','ALFANUMERICA_V1')) IS TRUE);
ALTER TABLE kvg.contacto_cliente ADD CONSTRAINT ck_contacto CHECK
 (((tipo = 'CORREO' AND valor ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
  OR (tipo = 'TELEFONO' AND length(valor) <= 32 AND valor ~ '^[+0-9][0-9 ()-]{5,31}$')) IS TRUE);
ALTER TABLE kvg.estado_expediente ADD CONSTRAINT ck_estado_expediente
 CHECK ((estado_expediente_codigo IN ('NUEVO','EN_PROCESO','PENDIENTE','CONCLUIDO','ARCHIVADO')) IS TRUE);
ALTER TABLE kvg.estado_documento ADD CONSTRAINT ck_estado_documento
 CHECK ((estado_documento_codigo IN ('RECIBIDO','EN_REVISION','VALIDADO','ARCHIVADO')) IS TRUE);
ALTER TABLE kvg.expediente ADD CONSTRAINT ck_referencia_externa
 CHECK (((numero_externo IS NULL) = (autoridad_externa IS NULL)) IS TRUE);
ALTER TABLE kvg.asignacion_expediente ADD CONSTRAINT ck_funcion_asignacion CHECK ((funcion IN ('PRINCIPAL','COLABORADOR')) IS TRUE);
ALTER TABLE kvg.asignacion_expediente ADD CONSTRAINT ck_cierre_asignacion
 CHECK (((finaliza_en IS NULL AND cerrado_por IS NULL AND motivo_cierre IS NULL)
   OR (finaliza_en >= inicia_en AND cerrado_por IS NOT NULL AND motivo_cierre IS NOT NULL)) IS TRUE);
ALTER TABLE kvg.usuario_rol ADD CONSTRAINT ck_cierre_rol
 CHECK (((finaliza_en IS NULL AND revocado_por IS NULL AND motivo_cierre IS NULL)
   OR (finaliza_en >= inicia_en AND revocado_por IS NOT NULL AND motivo_cierre IS NOT NULL)) IS TRUE);
ALTER TABLE kvg.asignacion_expediente ADD CONSTRAINT ex_principal_temporal
 EXCLUDE USING gist (expediente_id WITH =, tstzrange(inicia_en, finaliza_en, '[)') WITH &&)
 WHERE (funcion = 'PRINCIPAL') DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE kvg.asignacion_expediente ADD CONSTRAINT ex_participacion_temporal
 EXCLUDE USING gist (expediente_id WITH =, abogado_id WITH =, tstzrange(inicia_en, finaliza_en, '[)') WITH &&)
 DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE kvg.usuario_rol ADD CONSTRAINT ex_usuario_rol_temporal
 EXCLUDE USING gist (usuario_id WITH =, rol_id WITH =, tstzrange(inicia_en, finaliza_en, '[)') WITH &&)
 DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE kvg.usuario ADD CONSTRAINT ck_cuenta CHECK
 ((estado_cuenta IN ('INVITADO','ACTIVO','DESACTIVADO') AND
  (estado_cuenta <> 'ACTIVO' OR auth_usuario_id IS NOT NULL) AND
  ((estado_cuenta = 'DESACTIVADO' AND desactivado_en IS NOT NULL AND motivo_desactivacion IS NOT NULL)
    OR (estado_cuenta <> 'DESACTIVADO' AND desactivado_en IS NULL AND motivo_desactivacion IS NULL))) IS TRUE);
ALTER TABLE kvg.usuario ADD CONSTRAINT ck_correo_normalizado CHECK
 ((correo_operativo = lower(btrim(correo_operativo)) AND correo_operativo ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') IS TRUE);
ALTER TABLE kvg.rol ADD CONSTRAINT ck_roles_base CHECK ((codigo IN ('SECRETARIA','ABOGADO','ADMINISTRADOR')) IS TRUE);
ALTER TABLE kvg.permiso ADD CONSTRAINT ck_recurso_permiso CHECK
 ((recurso IN ('CLIENTE','EXPEDIENTE','DOCUMENTO','USUARIO','AUDITORIA','CONFIGURACION','RESPALDO')) IS TRUE);
ALTER TABLE kvg.rol_permiso ADD CONSTRAINT ck_contexto CHECK
 ((contexto IN ('PRINCIPAL','COLABORADOR','EXPLICITO','GLOBAL_OPERATIVO','REGISTRO_PROPIO')) IS TRUE);
ALTER TABLE kvg.concesion_acceso ADD CONSTRAINT ck_vigencia_concesion CHECK
 (((expira_en IS NULL OR expira_en > inicia_en) AND (revocado_en IS NULL OR revocado_en >= inicia_en)
  AND ((revocado_en IS NULL AND revocado_por IS NULL AND motivo_revocacion IS NULL)
   OR (revocado_en IS NOT NULL AND revocado_por IS NOT NULL AND motivo_revocacion IS NOT NULL))) IS TRUE);
ALTER TABLE kvg.sesion_aplicacion ADD CONSTRAINT ck_sesion CHECK
 ((expira_en > creada_en AND ultima_actividad_en >= creada_en
  AND ultima_actividad_en <= expira_en AND mfa_verificado_en IS NOT NULL
  AND ((revocada_en IS NULL AND motivo_revocacion IS NULL)
    OR (revocada_en >= creada_en AND motivo_revocacion IN ('CIERRE','CADUCIDAD','DESACTIVACION','INCIDENTE')))) IS TRUE);
ALTER TABLE kvg.carga_archivo ADD CONSTRAINT ck_estado_carga CHECK
 ((estado_tecnico IN ('RECIBIENDO','PENDIENTE_VERIFICACION','HABILITADO','RECHAZADO','ERROR_VERIFICACION','ABANDONADO')) IS TRUE);
ALTER TABLE kvg.carga_archivo ADD CONSTRAINT ck_carga_recibida
 CHECK ((estado_tecnico NOT IN ('PENDIENTE_VERIFICACION','ERROR_VERIFICACION','HABILITADO') OR tamano_recibido_bytes BETWEEN 1 AND 20000000) IS TRUE);
ALTER TABLE kvg.carga_archivo ADD CONSTRAINT ck_carga_habilitada CHECK
 ((estado_tecnico <> 'HABILITADO' OR (verificado_en IS NOT NULL AND motor_version IS NOT NULL
  AND resultado_tecnico_codigo = 'SEGURO' AND tamano_recibido_bytes BETWEEN 1 AND 20000000)) IS TRUE);
ALTER TABLE kvg.version_documento ADD CONSTRAINT ck_formato_mime CHECK
 (((formato = 'PDF' AND mime_verificado = 'application/pdf') OR
  (formato = 'DOCX' AND mime_verificado = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') OR
  (formato = 'JPG' AND mime_verificado = 'image/jpeg') OR (formato = 'PNG' AND mime_verificado = 'image/png')) IS TRUE);
ALTER TABLE kvg.version_documento ADD CONSTRAINT ck_tamano_version CHECK ((tamano_bytes BETWEEN 1 AND 20000000) IS TRUE);
ALTER TABLE kvg.version_documento ADD CONSTRAINT ck_procedencia_version CHECK ((fecha_origen IS NULL OR procedencia IS NOT NULL) IS TRUE);
ALTER TABLE kvg.avance_expediente ADD CONSTRAINT ck_procedencia_avance CHECK ((fecha_hecho IS NULL OR procedencia IS NOT NULL) IS TRUE);
ALTER TABLE kvg.revision_documento ADD CONSTRAINT ck_resultado_revision CHECK
 ((resultado IN ('OBSERVACIONES','APTO_PARA_VALIDAR','REQUIERE_CORRECCION')) IS TRUE);
ALTER TABLE kvg.revision_documento ADD CONSTRAINT ck_no_autocorreccion_revision CHECK ((corrige_revision_id IS DISTINCT FROM revision_juridica_id) IS TRUE);
ALTER TABLE kvg.avance_expediente ADD CONSTRAINT ck_no_autocorreccion_avance CHECK ((corrige_avance_id IS DISTINCT FROM avance_id) IS TRUE);
ALTER TABLE kvg.historial_estado_expediente ADD CONSTRAINT ck_transicion_expediente CHECK
 (((estado_origen_codigo IS NULL AND estado_destino_codigo = 'NUEVO' AND revision_resultante = 1)
  OR (estado_origen_codigo = 'NUEVO' AND estado_destino_codigo = 'EN_PROCESO')
  OR (estado_origen_codigo = 'EN_PROCESO' AND estado_destino_codigo = 'PENDIENTE')
  OR (estado_origen_codigo = 'PENDIENTE' AND estado_destino_codigo = 'EN_PROCESO')
  OR (estado_origen_codigo IN ('EN_PROCESO','PENDIENTE') AND estado_destino_codigo = 'CONCLUIDO'
      AND decidido_por IS NOT NULL AND referencia_autorizacion IS NOT NULL)
  OR (estado_origen_codigo = 'CONCLUIDO' AND estado_destino_codigo = 'ARCHIVADO')
  OR (estado_origen_codigo IN ('CONCLUIDO','ARCHIVADO') AND estado_destino_codigo = 'EN_PROCESO'
      AND decidido_por IS NOT NULL AND referencia_autorizacion IS NOT NULL)) IS TRUE);
ALTER TABLE kvg.historial_estado_documento ADD CONSTRAINT ck_transicion_documento CHECK
 (((estado_origen_codigo IS NULL AND estado_destino_codigo = 'RECIBIDO' AND revision_resultante = 1)
  OR (estado_origen_codigo = 'RECIBIDO' AND estado_destino_codigo = 'EN_REVISION')
  OR (estado_origen_codigo = 'EN_REVISION' AND estado_destino_codigo = 'RECIBIDO')
  OR (estado_origen_codigo = 'EN_REVISION' AND estado_destino_codigo = 'VALIDADO' AND revision_juridica_id IS NOT NULL)
  OR (estado_origen_codigo = 'VALIDADO' AND estado_destino_codigo = 'ARCHIVADO')
  OR (estado_origen_codigo = 'ARCHIVADO' AND estado_destino_codigo = 'VALIDADO')) IS TRUE);
ALTER TABLE kvg.evento_retiro_documento ADD CONSTRAINT ck_operacion_retiro CHECK
 ((operacion IN ('RETIRO','RECUPERACION') AND (operacion <> 'RECUPERACION' OR trabajo_verificacion_id IS NOT NULL)) IS TRUE);
ALTER TABLE kvg.medida_conservacion ADD CONSTRAINT ck_destino_medida CHECK ((num_nonnulls(cliente_id,expediente_id,documento_id) = 1) IS TRUE);
ALTER TABLE kvg.medida_conservacion ADD CONSTRAINT ck_tipo_medida CHECK
 ((tipo IN ('PRESERVAR_ORIGINAL','IMPEDIR_RETIRO','BLOQUEAR_ACCESO','IMPEDIR_RECUPERACION','IMPEDIR_EDICION','CANCELACION_PENDIENTE')) IS TRUE);
ALTER TABLE kvg.medida_conservacion ADD CONSTRAINT ck_fin_medida CHECK
 (((finaliza_en IS NULL AND levantado_por IS NULL) OR (finaliza_en >= inicia_en AND levantado_por IS NOT NULL)) IS TRUE);
ALTER TABLE kvg.evento_auditoria ADD CONSTRAINT ck_actor_auditoria CHECK
 (((tipo_actor = 'USUARIO' AND usuario_id IS NOT NULL AND servicio_codigo IS NULL)
  OR (tipo_actor = 'SERVICIO' AND usuario_id IS NULL AND servicio_codigo IS NOT NULL AND sesion_id IS NULL)
  OR (tipo_actor = 'NO_AUTENTICADO' AND usuario_id IS NULL AND servicio_codigo IS NULL AND sesion_id IS NULL)) IS TRUE);
ALTER TABLE kvg.evento_auditoria ADD CONSTRAINT ck_resultado_auditoria CHECK ((resultado IN ('EXITO','DENEGADO','FALLIDO','RECIBIDO')) IS TRUE);
ALTER TABLE kvg.evento_auditoria ADD CONSTRAINT ck_detalle_auditoria CHECK ((kvg_privado.metadatos_validos(detalle_controlado)) IS TRUE);
ALTER TABLE kvg.evento_restriccion ADD CONSTRAINT ck_detalle_restriccion CHECK ((kvg_privado.metadatos_validos(detalle_controlado)) IS TRUE);
ALTER TABLE kvg.evento_restriccion ADD CONSTRAINT ck_accion_restriccion CHECK
 ((accion IN ('DESACTIVAR_USUARIO','REVOCAR_ROL','REVOCAR_CAPACIDAD','RESTABLECER_CAPACIDAD','CERRAR_ASIGNACION','REVOCAR_CONCESION',
 'RETIRAR_DOCUMENTO','RECUPERAR_DOCUMENTO','APLICAR_MEDIDA','LEVANTAR_MEDIDA')) IS TRUE);
ALTER TABLE kvg.evento_restriccion ADD CONSTRAINT ck_recurso_restriccion CHECK
 ((recurso_tipo IN ('USUARIO','USUARIO_ROL','ROL_PERMISO','ASIGNACION','CONCESION','DOCUMENTO','MEDIDA')) IS TRUE);
ALTER TABLE kvg.trabajo_operativo ADD CONSTRAINT ck_tipo_trabajo CHECK
 (((tipo IN ('VERIFICAR_CARGA','CONCILIAR_CARGA') AND objetivo_tipo = 'CARGA')
 OR (tipo = 'VERIFICAR_RECUPERACION' AND objetivo_tipo = 'DOCUMENTO')
 OR (tipo = 'RESPALDAR' AND objetivo_tipo = 'RESPALDO')
 OR (tipo = 'RESTAURAR' AND objetivo_tipo = 'RESTAURACION')
 OR (tipo = 'CONCILIAR_IDENTIDAD' AND objetivo_tipo = 'USUARIO')) IS TRUE);
ALTER TABLE kvg.trabajo_operativo ADD CONSTRAINT ck_ciclo_trabajo CHECK
 ((estado IN ('EN_COLA','EN_EJECUCION','COMPLETADO','FALLIDO','CANCELADO') AND intentos <= max_intentos
  AND ((estado IN ('COMPLETADO','FALLIDO','CANCELADO') AND finalizado_en IS NOT NULL)
    OR (estado IN ('EN_COLA','EN_EJECUCION') AND finalizado_en IS NULL))
  AND (estado <> 'EN_EJECUCION' OR (bloqueo_hasta IS NOT NULL AND ejecutor_codigo IS NOT NULL))) IS TRUE);
ALTER TABLE kvg.respaldo ADD CONSTRAINT ck_estado_respaldo CHECK
 ((estado IN ('PENDIENTE','VERIFICANDO','VERIFICADO','INCOMPLETO','FALLIDO') AND
  (estado <> 'VERIFICADO' OR (manifiesto_localizador IS NOT NULL AND manifiesto_sha256 IS NOT NULL
    AND verificado_en IS NOT NULL AND evidencia_ref IS NOT NULL))) IS TRUE);
ALTER TABLE kvg.elemento_manifiesto ADD CONSTRAINT ck_tipo_elemento CHECK
 ((tipo IN ('DATOS','OBJETO','CONFIGURACION','IDENTIDAD','RESTRICCIONES') AND
 ((tipo = 'OBJETO' AND version_origen_id IS NOT NULL AND sha256_original IS NOT NULL AND tamano_original_bytes IS NOT NULL)
  OR (tipo <> 'OBJETO' AND version_origen_id IS NULL AND sha256_original IS NULL AND tamano_original_bytes IS NULL))) IS TRUE);
ALTER TABLE kvg.elemento_manifiesto ADD CONSTRAINT ck_fechas_copia CHECK ((verificado_en >= copiado_en) IS TRUE);
ALTER TABLE kvg.restauracion ADD CONSTRAINT ck_estado_restauracion CHECK
 ((modalidad IN ('ENSAYO','INCIDENTE') AND estado IN ('SOLICITADA','EN_AISLAMIENTO','VERIFICADA','HABILITADA','ABORTADA','FALLIDA')
 AND (modalidad <> 'ENSAYO' OR estado <> 'HABILITADA')
 AND (modalidad <> 'INCIDENTE' OR incidente_en IS NOT NULL)
 AND (estado NOT IN ('VERIFICADA','HABILITADA') OR (verificado_en IS NOT NULL AND restricciones_hasta IS NOT NULL AND evidencia_ref IS NOT NULL))
 AND (estado <> 'HABILITADA' OR (autorizado_por IS NOT NULL AND autorizado_en IS NOT NULL
    AND servicio_habilitado_en IS NOT NULL AND estado_previo_ref IS NOT NULL))) IS TRUE);
ALTER TABLE kvg.parametro_sistema ADD CONSTRAINT ck_tipo_parametro CHECK ((tipo_valor IN ('ENTERO','BOOLEANO','CODIGO','TEXTO')) IS TRUE);

-- 6. Índices de integridad y consulta.
CREATE UNIQUE INDEX uq_identificacion_vigente ON kvg.identificacion_cliente (cliente_id, tipo_identificacion_codigo, valor_normalizado) WHERE retirado_en IS NULL;
CREATE UNIQUE INDEX uq_contacto_preferente ON kvg.contacto_cliente (cliente_id, tipo) WHERE activo AND preferente;
CREATE UNIQUE INDEX uq_estado_expediente_revision ON kvg.historial_estado_expediente (expediente_id, revision_resultante);
CREATE UNIQUE INDEX uq_estado_documento_revision ON kvg.historial_estado_documento (version_id, revision_resultante);
CREATE UNIQUE INDEX uq_asociacion_revision ON kvg.historial_asociacion_documento (documento_id, revision_resultante);
CREATE UNIQUE INDEX uq_retiro_revision ON kvg.evento_retiro_documento (documento_id, revision_resultante);
CREATE UNIQUE INDEX uq_historial_parametro_revision ON kvg.historial_parametro (parametro_codigo, revision_resultante);
CREATE UNIQUE INDEX uq_auth_sesion ON kvg.sesion_aplicacion (auth_sesion_ref) WHERE auth_sesion_ref IS NOT NULL;
CREATE UNIQUE INDEX uq_politica_revision ON kvg.politica_respaldo (nombre, numero_revision);
CREATE UNIQUE INDEX uq_politica_activa ON kvg.politica_respaldo (nombre) WHERE activa;
CREATE UNIQUE INDEX uq_manifiesto_objeto ON kvg.elemento_manifiesto (respaldo_id, version_origen_id) WHERE tipo = 'OBJETO';
CREATE INDEX ix_cliente_nombre ON kvg.cliente (lower(nombre_presentacion));
CREATE INDEX ix_expediente_listado ON kvg.expediente (estado_expediente_codigo, creado_en DESC);
CREATE INDEX ix_documento_listado ON kvg.documento (expediente_id, categoria_id, creado_en DESC) WHERE retirado_en IS NULL;
CREATE INDEX ix_documento_busqueda ON kvg.documento USING gin (to_tsvector('spanish'::regconfig, nombre::text));
CREATE INDEX ix_expediente_busqueda ON kvg.expediente USING gin (to_tsvector('spanish'::regconfig, descripcion::text));
CREATE INDEX ix_avances_fecha ON kvg.avance_expediente (expediente_id, registrado_en DESC);
CREATE INDEX ix_auditoria_fecha ON kvg.evento_auditoria (ocurrido_en DESC);
CREATE INDEX ix_auditoria_recurso ON kvg.evento_auditoria (recurso_tipo, recurso_id, ocurrido_en DESC);
CREATE INDEX ix_restriccion_fecha ON kvg.evento_restriccion (ocurrido_en, restriccion_evento_id);
CREATE INDEX ix_trabajo_pendiente ON kvg.trabajo_operativo (proximo_intento_en, creado_en) WHERE estado IN ('EN_COLA','EN_EJECUCION');
CREATE INDEX ix_identificacion_normalizada ON kvg.identificacion_cliente (tipo_identificacion_codigo, valor_normalizado) WHERE retirado_en IS NULL;
CREATE INDEX ix_d01_creado_por ON kvg.cliente (creado_por);
CREATE INDEX ix_d03_cliente_id ON kvg.identificacion_cliente (cliente_id);
CREATE INDEX ix_d03_tipo_identificacion_codigo ON kvg.identificacion_cliente (tipo_identificacion_codigo);
CREATE INDEX ix_d03_registrado_por ON kvg.identificacion_cliente (registrado_por);
CREATE INDEX ix_d04_cliente_id ON kvg.contacto_cliente (cliente_id);
CREATE INDEX ix_d04_registrado_por ON kvg.contacto_cliente (registrado_por);
CREATE INDEX ix_d06_cliente_principal_id ON kvg.expediente (cliente_principal_id);
CREATE INDEX ix_d06_estado_expediente_codigo ON kvg.expediente (estado_expediente_codigo);
CREATE INDEX ix_d06_creado_por ON kvg.expediente (creado_por);
CREATE INDEX ix_d07_expediente_id ON kvg.asignacion_expediente (expediente_id);
CREATE INDEX ix_d07_abogado_id ON kvg.asignacion_expediente (abogado_id);
CREATE INDEX ix_d07_asignado_por ON kvg.asignacion_expediente (asignado_por);
CREATE INDEX ix_d07_autorizado_por ON kvg.asignacion_expediente (autorizado_por);
CREATE INDEX ix_d07_cerrado_por ON kvg.asignacion_expediente (cerrado_por);
CREATE INDEX ix_d08_expediente_id ON kvg.historial_estado_expediente (expediente_id);
CREATE INDEX ix_d08_estado_origen_codigo ON kvg.historial_estado_expediente (estado_origen_codigo);
CREATE INDEX ix_d08_estado_destino_codigo ON kvg.historial_estado_expediente (estado_destino_codigo);
CREATE INDEX ix_d08_registrado_por ON kvg.historial_estado_expediente (registrado_por);
CREATE INDEX ix_d08_decidido_por ON kvg.historial_estado_expediente (decidido_por);
CREATE INDEX ix_d09_expediente_id ON kvg.avance_expediente (expediente_id);
CREATE INDEX ix_d09_autor_id ON kvg.avance_expediente (autor_id);
CREATE INDEX ix_d09_corrige_avance_id ON kvg.avance_expediente (corrige_avance_id);
CREATE INDEX ix_d10_version_id ON kvg.avance_version (version_id);
CREATE INDEX ix_d13_expediente_id ON kvg.documento (expediente_id);
CREATE INDEX ix_d13_categoria_id ON kvg.documento (categoria_id);
CREATE INDEX ix_d13_version_vigente_id ON kvg.documento (version_vigente_id);
CREATE INDEX ix_d13_creado_por ON kvg.documento (creado_por);
CREATE INDEX ix_d14_documento_id ON kvg.historial_asociacion_documento (documento_id);
CREATE INDEX ix_d14_expediente_origen_id ON kvg.historial_asociacion_documento (expediente_origen_id);
CREATE INDEX ix_d14_expediente_destino_id ON kvg.historial_asociacion_documento (expediente_destino_id);
CREATE INDEX ix_d14_version_id ON kvg.historial_asociacion_documento (version_id);
CREATE INDEX ix_d14_registrado_por ON kvg.historial_asociacion_documento (registrado_por);
CREATE INDEX ix_d15_documento_id ON kvg.carga_archivo (documento_id);
CREATE INDEX ix_d15_expediente_destino_id ON kvg.carga_archivo (expediente_destino_id);
CREATE INDEX ix_d15_solicitado_por ON kvg.carga_archivo (solicitado_por);
CREATE INDEX ix_d16_documento_id ON kvg.version_documento (documento_id);
CREATE INDEX ix_d16_estado_documento_codigo ON kvg.version_documento (estado_documento_codigo);
CREATE INDEX ix_d17_version_id ON kvg.revision_documento (version_id);
CREATE INDEX ix_d17_revisor_id ON kvg.revision_documento (revisor_id);
CREATE INDEX ix_d17_corrige_revision_id ON kvg.revision_documento (corrige_revision_id);
CREATE INDEX ix_d18_version_id ON kvg.historial_estado_documento (version_id);
CREATE INDEX ix_d18_estado_origen_codigo ON kvg.historial_estado_documento (estado_origen_codigo);
CREATE INDEX ix_d18_estado_destino_codigo ON kvg.historial_estado_documento (estado_destino_codigo);
CREATE INDEX ix_d18_revision_juridica_id ON kvg.historial_estado_documento (revision_juridica_id);
CREATE INDEX ix_d18_responsable_usuario_id ON kvg.historial_estado_documento (responsable_usuario_id);
CREATE INDEX ix_d19_documento_id ON kvg.evento_retiro_documento (documento_id);
CREATE INDEX ix_d19_registrado_por ON kvg.evento_retiro_documento (registrado_por);
CREATE INDEX ix_d19_autorizado_por ON kvg.evento_retiro_documento (autorizado_por);
CREATE INDEX ix_d19_trabajo_verificacion_id ON kvg.evento_retiro_documento (trabajo_verificacion_id);
CREATE INDEX ix_d20_cliente_id ON kvg.medida_conservacion (cliente_id);
CREATE INDEX ix_d20_expediente_id ON kvg.medida_conservacion (expediente_id);
CREATE INDEX ix_d20_documento_id ON kvg.medida_conservacion (documento_id);
CREATE INDEX ix_d20_autorizado_por ON kvg.medida_conservacion (autorizado_por);
CREATE INDEX ix_d20_levantado_por ON kvg.medida_conservacion (levantado_por);
CREATE INDEX ix_d21_creado_por ON kvg.usuario (creado_por);
CREATE INDEX ix_d24_usuario_id ON kvg.usuario_rol (usuario_id);
CREATE INDEX ix_d24_rol_id ON kvg.usuario_rol (rol_id);
CREATE INDEX ix_d24_otorgado_por ON kvg.usuario_rol (otorgado_por);
CREATE INDEX ix_d24_revocado_por ON kvg.usuario_rol (revocado_por);
CREATE INDEX ix_d25_permiso_id ON kvg.rol_permiso (permiso_id);
CREATE INDEX ix_d25_aprobado_por ON kvg.rol_permiso (aprobado_por);
CREATE INDEX ix_d26_expediente_id ON kvg.concesion_acceso (expediente_id);
CREATE INDEX ix_d26_usuario_id ON kvg.concesion_acceso (usuario_id);
CREATE INDEX ix_d26_otorgado_por ON kvg.concesion_acceso (otorgado_por);
CREATE INDEX ix_d26_aprobado_por ON kvg.concesion_acceso (aprobado_por);
CREATE INDEX ix_d26_revocado_por ON kvg.concesion_acceso (revocado_por);
CREATE INDEX ix_d27_permiso_id ON kvg.concesion_permiso (permiso_id);
CREATE INDEX ix_d28_usuario_id ON kvg.sesion_aplicacion (usuario_id);
CREATE INDEX ix_d29_usuario_id ON kvg.evento_auditoria (usuario_id);
CREATE INDEX ix_d29_sesion_id ON kvg.evento_auditoria (sesion_id);
CREATE INDEX ix_d30_solicitado_por ON kvg.trabajo_operativo (solicitado_por);
CREATE INDEX ix_d31_aprobado_por ON kvg.politica_respaldo (aprobado_por);
CREATE INDEX ix_d32_politica_respaldo_id ON kvg.respaldo (politica_respaldo_id);
CREATE INDEX ix_d34_respaldo_id ON kvg.restauracion (respaldo_id);
CREATE INDEX ix_d34_autorizado_por ON kvg.restauracion (autorizado_por);
CREATE INDEX ix_d35_modificado_por ON kvg.parametro_sistema (modificado_por);
CREATE INDEX ix_d36_parametro_codigo ON kvg.historial_parametro (parametro_codigo);
CREATE INDEX ix_d36_registrado_por ON kvg.historial_parametro (registrado_por);
CREATE INDEX ix_d37_registrado_por ON kvg.evento_restriccion (registrado_por);

-- 7. Catálogos iniciales.
INSERT INTO kvg.estado_expediente VALUES ('NUEVO', 'Nuevo', 'Alta del expediente antes de comenzar el trabajo jurídico.');
INSERT INTO kvg.estado_expediente VALUES ('EN_PROCESO', 'En proceso', 'Trabajo activo con un abogado principal vigente.');
INSERT INTO kvg.estado_expediente VALUES ('PENDIENTE', 'Pendiente', 'Espera documentada con responsable vigente.');
INSERT INTO kvg.estado_expediente VALUES ('CONCLUIDO', 'Concluido', 'Terminación jurídica autorizada.');
INSERT INTO kvg.estado_expediente VALUES ('ARCHIVADO', 'Archivado', 'Conservación del expediente sin edición ordinaria.');
INSERT INTO kvg.estado_documento VALUES ('RECIBIDO', 'Recibido', 'Original publicado tras verificación técnica.');
INSERT INTO kvg.estado_documento VALUES ('EN_REVISION', 'En revisión', 'Versión en revisión jurídica.');
INSERT INTO kvg.estado_documento VALUES ('VALIDADO', 'Validado', 'Versión exacta con revisión jurídica y decisión autorizadas.');
INSERT INTO kvg.estado_documento VALUES ('ARCHIVADO', 'Archivado', 'Versión conservada y archivada.');
INSERT INTO kvg.categoria_documento (codigo,nombre) VALUES ('DEMANDAS', 'Demandas');
INSERT INTO kvg.categoria_documento (codigo,nombre) VALUES ('CONTRATOS', 'Contratos');
INSERT INTO kvg.categoria_documento (codigo,nombre) VALUES ('ESCRITOS', 'Escritos');
INSERT INTO kvg.categoria_documento (codigo,nombre) VALUES ('IDENTIFICACIONES', 'Identificaciones');
INSERT INTO kvg.categoria_documento (codigo,nombre) VALUES ('PRUEBAS', 'Pruebas');
INSERT INTO kvg.categoria_documento (codigo,nombre) VALUES ('OTROS', 'Otros');
INSERT INTO kvg.rol (codigo,nombre,descripcion) VALUES ('SECRETARIA','Secretaria','Registro y organización dentro del alcance concedido.');
INSERT INTO kvg.rol (codigo,nombre,descripcion) VALUES ('ABOGADO','Abogado','Seguimiento, revisión y facultades jurídicas expresamente asignadas.');
INSERT INTO kvg.rol (codigo,nombre,descripcion) VALUES ('ADMINISTRADOR','Administrador','Administración técnica sin lectura jurídica automática.');
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('cliente.registrar','CLIENTE','Operación cliente.registrar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('cliente.consultar','CLIENTE','Operación cliente.consultar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('cliente.actualizar','CLIENTE','Operación cliente.actualizar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('expediente.crear','EXPEDIENTE','Operación expediente.crear dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('expediente.consultar','EXPEDIENTE','Operación expediente.consultar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('expediente.actualizar','EXPEDIENTE','Operación expediente.actualizar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('expediente.iniciar','EXPEDIENTE','Operación expediente.iniciar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('expediente.suspender','EXPEDIENTE','Operación expediente.suspender dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('expediente.reanudar','EXPEDIENTE','Operación expediente.reanudar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('expediente.concluir','EXPEDIENTE','Operación expediente.concluir dentro del contexto autorizado.',true,true,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('expediente.archivar','EXPEDIENTE','Operación expediente.archivar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('expediente.reabrir','EXPEDIENTE','Operación expediente.reabrir dentro del contexto autorizado.',true,true,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('expediente.asignar','EXPEDIENTE','Operación expediente.asignar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('expediente.reasignar','EXPEDIENTE','Operación expediente.reasignar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('expediente.metadatos','EXPEDIENTE','Operación expediente.metadatos dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('expediente.avanzar','EXPEDIENTE','Operación expediente.avanzar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('expediente.conceder','EXPEDIENTE','Operación expediente.conceder dentro del contexto autorizado.',true,true,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('documento.cargar','DOCUMENTO','Operación documento.cargar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('documento.consultar','DOCUMENTO','Operación documento.consultar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('documento.clasificar','DOCUMENTO','Operación documento.clasificar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('documento.asociar','DOCUMENTO','Operación documento.asociar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('documento.actualizar','DOCUMENTO','Operación documento.actualizar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('documento.descargar','DOCUMENTO','Operación documento.descargar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('documento.versiones','DOCUMENTO','Operación documento.versiones dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('documento.revisar','DOCUMENTO','Operación documento.revisar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('documento.iniciar_revision','DOCUMENTO','Operación documento.iniciar_revision dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('documento.corregir','DOCUMENTO','Operación documento.corregir dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('documento.validar','DOCUMENTO','Operación documento.validar dentro del contexto autorizado.',true,true,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('documento.archivar','DOCUMENTO','Operación documento.archivar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('documento.reactivar','DOCUMENTO','Operación documento.reactivar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('documento.retirar','DOCUMENTO','Operación documento.retirar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('documento.recuperar','DOCUMENTO','Operación documento.recuperar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('documento.metadatos','DOCUMENTO','Operación documento.metadatos dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('documento.conservar','DOCUMENTO','Operación documento.conservar dentro del contexto autorizado.',true,true,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('usuario.administrar','USUARIO','Operación usuario.administrar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('usuario.permisos','USUARIO','Operación usuario.permisos dentro del contexto autorizado.',true,true,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('auditoria.consultar','AUDITORIA','Operación auditoria.consultar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('configuracion.administrar','CONFIGURACION','Operación configuracion.administrar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('respaldo.consultar','RESPALDO','Operación respaldo.consultar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('respaldo.solicitar','RESPALDO','Operación respaldo.solicitar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('respaldo.configurar','RESPALDO','Operación respaldo.configurar dentro del contexto autorizado.',true,false,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('respaldo.restaurar','RESPALDO','Operación respaldo.restaurar dentro del contexto autorizado.',true,true,true);
INSERT INTO kvg.permiso (codigo,recurso,descripcion,requiere_mfa,requiere_decision,activo) VALUES ('respaldo.habilitar','RESPALDO','Operación respaldo.habilitar dentro del contexto autorizado.',true,true,true);

-- Definición de entidades y atributos del diccionario de datos.
COMMENT ON TABLE kvg.cliente IS 'Persona que contrata o solicita la atención del despacho. Tiene identidad propia y puede ser principal de varios expedientes.';
COMMENT ON COLUMN kvg.cliente.cliente_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.cliente.tipo_cliente IS 'PERSONA_FISICA como base provisional. PERSONA_MORAL no se habilita sin resolver PT01.';
COMMENT ON COLUMN kvg.cliente.nombre_presentacion IS 'Nombre completo; razón social solo si se aprueba el tipo correspondiente. No es una clave única.';
COMMENT ON COLUMN kvg.cliente.creado_por IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.cliente.creado_en IS 'Fecha y hora confiables del alta.';
COMMENT ON COLUMN kvg.cliente.actualizado_en IS 'Última modificación de datos.';
COMMENT ON COLUMN kvg.cliente.revision IS 'Número positivo para detectar edición concurrente; inicia en 1.';
COMMENT ON TABLE kvg.tipo_identificacion IS 'Define las identificaciones admitidas y el criterio autorizado para detectar duplicados.';
COMMENT ON COLUMN kvg.tipo_identificacion.tipo_identificacion_codigo IS 'Código estable del tipo admitido.';
COMMENT ON COLUMN kvg.tipo_identificacion.nombre IS 'Nombre legible del tipo.';
COMMENT ON COLUMN kvg.tipo_identificacion.regla_normalizacion IS 'Regla aprobada de comparación; se identifica por versión. No se improvisa con cada captura.';
COMMENT ON COLUMN kvg.tipo_identificacion.unicidad_exigida IS 'Si es verdadero, el valor normalizado no puede corresponder a dos clientes.';
COMMENT ON COLUMN kvg.tipo_identificacion.activo IS 'Disponible para nuevas capturas.';
COMMENT ON COLUMN kvg.tipo_identificacion.revision IS 'Versión de la definición; un cambio revisa los datos afectados.';
COMMENT ON TABLE kvg.identificacion_cliente IS 'Identificación opcional cuya normalización permite advertir o impedir duplicados sin utilizar el nombre como clave.';
COMMENT ON COLUMN kvg.identificacion_cliente.identificacion_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.identificacion_cliente.cliente_id IS 'Referencia a cliente.cliente_id.';
COMMENT ON COLUMN kvg.identificacion_cliente.tipo_identificacion_codigo IS 'Tipo autorizado.';
COMMENT ON COLUMN kvg.identificacion_cliente.valor_original IS 'Valor proporcionado, protegido como dato personal.';
COMMENT ON COLUMN kvg.identificacion_cliente.valor_normalizado IS 'Representación de comparación obtenida con la regla del tipo.';
COMMENT ON COLUMN kvg.identificacion_cliente.regla_revision IS 'Revisión de normalización utilizada al capturar.';
COMMENT ON COLUMN kvg.identificacion_cliente.registrado_en IS 'Fecha de registro.';
COMMENT ON COLUMN kvg.identificacion_cliente.registrado_por IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.identificacion_cliente.retirado_en IS 'Fin de vigencia por corrección autorizada; conserva trazabilidad.';
COMMENT ON TABLE kvg.contacto_cliente IS 'Medio opcional de contacto del cliente; admite varios teléfonos o correos sin campos numerados.';
COMMENT ON COLUMN kvg.contacto_cliente.contacto_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.contacto_cliente.cliente_id IS 'Referencia a cliente.cliente_id.';
COMMENT ON COLUMN kvg.contacto_cliente.tipo IS 'TELEFONO o CORREO; otros tipos requieren validación.';
COMMENT ON COLUMN kvg.contacto_cliente.valor IS 'Medio de contacto con formato validado.';
COMMENT ON COLUMN kvg.contacto_cliente.etiqueta IS 'Descripción breve, como móvil u oficina.';
COMMENT ON COLUMN kvg.contacto_cliente.preferente IS 'Indica el medio preferido dentro de su tipo.';
COMMENT ON COLUMN kvg.contacto_cliente.activo IS 'Vigente para contacto.';
COMMENT ON COLUMN kvg.contacto_cliente.registrado_en IS 'Fecha de alta.';
COMMENT ON COLUMN kvg.contacto_cliente.registrado_por IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.contacto_cliente.revision IS 'Control de edición concurrente.';
COMMENT ON TABLE kvg.estado_expediente IS 'Catálogo cerrado de estados jurídicos definidos en el RUP.';
COMMENT ON COLUMN kvg.estado_expediente.estado_expediente_codigo IS 'Clave estable del estado.';
COMMENT ON COLUMN kvg.estado_expediente.nombre IS 'Nuevo, En proceso, Pendiente, Concluido o Archivado.';
COMMENT ON COLUMN kvg.estado_expediente.definicion IS 'Significado operativo y jurídico del estado.';
COMMENT ON TABLE kvg.expediente IS 'Registro organizado de un asunto jurídico y su cliente principal. El folio interno conserva su identidad aunque cambien datos generales.';
COMMENT ON COLUMN kvg.expediente.expediente_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.expediente.folio_interno IS 'Folio asignado por el servidor, único y estable.';
COMMENT ON COLUMN kvg.expediente.cliente_principal_id IS 'Referencia a cliente.cliente_id.';
COMMENT ON COLUMN kvg.expediente.descripcion IS 'Descripción necesaria del asunto; no admite campos vacíos.';
COMMENT ON COLUMN kvg.expediente.numero_externo IS 'Número atribuido por una autoridad, si existe.';
COMMENT ON COLUMN kvg.expediente.autoridad_externa IS 'Autoridad que emitió el número; necesaria cuando el número requiere contexto.';
COMMENT ON COLUMN kvg.expediente.estado_expediente_codigo IS 'Estado actual; inicia en NUEVO.';
COMMENT ON COLUMN kvg.expediente.creado_por IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.expediente.creado_en IS 'Fecha de apertura en el sistema.';
COMMENT ON COLUMN kvg.expediente.actualizado_en IS 'Última modificación confirmada.';
COMMENT ON COLUMN kvg.expediente.revision IS 'Control común para datos, estado y asignaciones.';
COMMENT ON TABLE kvg.asignacion_expediente IS 'Relación temporal entre un expediente y un abogado, con función principal o colaborador y trazabilidad de su cierre.';
COMMENT ON COLUMN kvg.asignacion_expediente.asignacion_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.asignacion_expediente.expediente_id IS 'Referencia a expediente.expediente_id.';
COMMENT ON COLUMN kvg.asignacion_expediente.abogado_id IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.asignacion_expediente.funcion IS 'PRINCIPAL o COLABORADOR.';
COMMENT ON COLUMN kvg.asignacion_expediente.inicia_en IS 'Inicio de la asignación.';
COMMENT ON COLUMN kvg.asignacion_expediente.finaliza_en IS 'Cierre efectivo; nulo mientras la asignación siga abierta.';
COMMENT ON COLUMN kvg.asignacion_expediente.asignado_por IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.asignacion_expediente.motivo_alta IS 'Motivo de la asignación.';
COMMENT ON COLUMN kvg.asignacion_expediente.autorizado_por IS 'Responsable de negocio cuando la asignación lo requiera.';
COMMENT ON COLUMN kvg.asignacion_expediente.cerrado_por IS 'Obligatorio si se cierra la asignación.';
COMMENT ON COLUMN kvg.asignacion_expediente.motivo_cierre IS 'Razón del cierre o reasignación.';
COMMENT ON TABLE kvg.historial_estado_expediente IS 'Entrada inmutable por alta o transición. Conserva el motivo y la decisión jurídica sin sustituir la bitácora general.';
COMMENT ON COLUMN kvg.historial_estado_expediente.cambio_expediente_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.historial_estado_expediente.expediente_id IS 'Referencia a expediente.expediente_id.';
COMMENT ON COLUMN kvg.historial_estado_expediente.estado_origen_codigo IS 'Nulo solo en el alta inicial.';
COMMENT ON COLUMN kvg.historial_estado_expediente.estado_destino_codigo IS 'Estado alcanzado.';
COMMENT ON COLUMN kvg.historial_estado_expediente.motivo IS 'Razón del cambio; obligatoria para transiciones.';
COMMENT ON COLUMN kvg.historial_estado_expediente.registrado_por IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.historial_estado_expediente.registrado_en IS 'Fecha del servidor.';
COMMENT ON COLUMN kvg.historial_estado_expediente.decidido_por IS 'Responsable jurídico para conclusión o reapertura.';
COMMENT ON COLUMN kvg.historial_estado_expediente.referencia_autorizacion IS 'Referencia restringida de la decisión, sin secretos.';
COMMENT ON COLUMN kvg.historial_estado_expediente.revision_resultante IS 'Revisión del expediente después del cambio.';
COMMENT ON TABLE kvg.avance_expediente IS 'Entrada cronológica del seguimiento. Una corrección es una entrada nueva que referencia a la anterior.';
COMMENT ON COLUMN kvg.avance_expediente.avance_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.avance_expediente.expediente_id IS 'Referencia a expediente.expediente_id.';
COMMENT ON COLUMN kvg.avance_expediente.descripcion IS 'Avance u observación no vacía; contenido jurídico restringido.';
COMMENT ON COLUMN kvg.avance_expediente.autor_id IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.avance_expediente.registrado_en IS 'Fecha confiable de incorporación al sistema.';
COMMENT ON COLUMN kvg.avance_expediente.corrige_avance_id IS 'Entrada corregida del mismo expediente.';
COMMENT ON COLUMN kvg.avance_expediente.fecha_hecho IS 'Fecha declarada del hecho, distinta de la fecha del servidor.';
COMMENT ON COLUMN kvg.avance_expediente.procedencia IS 'Fuente cuando se incorpora información histórica.';
COMMENT ON TABLE kvg.avance_version IS 'Relación entre un avance y las versiones que sustentan su contenido, evitando listas de identificadores dentro de un texto.';
COMMENT ON COLUMN kvg.avance_version.avance_id IS 'Referencia a avance_expediente.avance_id.';
COMMENT ON COLUMN kvg.avance_version.version_id IS 'Referencia a version_documento.version_id.';
COMMENT ON COLUMN kvg.avance_version.nota IS 'Contexto breve de la referencia.';
COMMENT ON TABLE kvg.categoria_documento IS 'Clasifica documentos sin conceder permisos ni determinar su validez jurídica.';
COMMENT ON COLUMN kvg.categoria_documento.categoria_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.categoria_documento.codigo IS 'Identificador legible y estable.';
COMMENT ON COLUMN kvg.categoria_documento.nombre IS 'Nombre de la categoría.';
COMMENT ON COLUMN kvg.categoria_documento.descripcion IS 'Criterio para su clasificación.';
COMMENT ON COLUMN kvg.categoria_documento.activo IS 'Disponible para nuevas selecciones.';
COMMENT ON COLUMN kvg.categoria_documento.revision IS 'Control de cambios del catálogo.';
COMMENT ON TABLE kvg.estado_documento IS 'Catálogo cerrado aplicado a cada versión publicada, distinto del estado técnico de su carga.';
COMMENT ON COLUMN kvg.estado_documento.estado_documento_codigo IS 'Clave estable del estado.';
COMMENT ON COLUMN kvg.estado_documento.nombre IS 'Recibido, En revisión, Validado o Archivado.';
COMMENT ON COLUMN kvg.estado_documento.definicion IS 'Significado jurídico y administrativo.';
COMMENT ON TABLE kvg.documento IS 'Unidad documental con metadatos, expediente actual y una versión vigente. Puede existir en preparación mientras su primera carga se verifica.';
COMMENT ON COLUMN kvg.documento.documento_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.documento.expediente_id IS 'Referencia a expediente.expediente_id.';
COMMENT ON COLUMN kvg.documento.nombre IS 'Nombre de negocio del documento.';
COMMENT ON COLUMN kvg.documento.categoria_id IS 'Referencia a categoria_documento.categoria_id.';
COMMENT ON COLUMN kvg.documento.version_vigente_id IS 'Nula antes de la primera publicación; debe pertenecer a este documento.';
COMMENT ON COLUMN kvg.documento.retirado_en IS 'Retiro lógico actual; nulo si no está retirado.';
COMMENT ON COLUMN kvg.documento.creado_por IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.documento.creado_en IS 'Alta de los metadatos.';
COMMENT ON COLUMN kvg.documento.actualizado_en IS 'Último cambio de metadatos, publicación, asociación o retiro.';
COMMENT ON COLUMN kvg.documento.revision IS 'Control de concurrencia del documento.';
COMMENT ON TABLE kvg.historial_asociacion_documento IS 'Entrada inmutable que conserva el alta y las correcciones del expediente al que pertenece un documento.';
COMMENT ON COLUMN kvg.historial_asociacion_documento.asociacion_evento_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.historial_asociacion_documento.documento_id IS 'Referencia a documento.documento_id.';
COMMENT ON COLUMN kvg.historial_asociacion_documento.expediente_origen_id IS 'Nulo en la asociación inicial.';
COMMENT ON COLUMN kvg.historial_asociacion_documento.expediente_destino_id IS 'Referencia a expediente.expediente_id.';
COMMENT ON COLUMN kvg.historial_asociacion_documento.version_id IS 'Versión vigente al corregir; debe pertenecer al documento.';
COMMENT ON COLUMN kvg.historial_asociacion_documento.registrado_por IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.historial_asociacion_documento.registrado_en IS 'Fecha de la asociación.';
COMMENT ON COLUMN kvg.historial_asociacion_documento.motivo IS 'Razón de la asociación inicial o de su corrección.';
COMMENT ON COLUMN kvg.historial_asociacion_documento.revision_resultante IS 'Revisión del documento después del evento.';
COMMENT ON TABLE kvg.carga_archivo IS 'Intento durable de recepción y verificación técnica. Existe aunque se rechace el archivo; no es todavía una versión publicada.';
COMMENT ON COLUMN kvg.carga_archivo.carga_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.carga_archivo.documento_id IS 'Referencia a documento.documento_id.';
COMMENT ON COLUMN kvg.carga_archivo.expediente_destino_id IS 'Referencia a expediente.expediente_id.';
COMMENT ON COLUMN kvg.carga_archivo.solicitado_por IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.carga_archivo.revision_documento_base IS 'Revisión esperada al solicitar publicación.';
COMMENT ON COLUMN kvg.carga_archivo.clave_idempotencia IS 'Clave opaca estable del intento.';
COMMENT ON COLUMN kvg.carga_archivo.nombre_original IS 'Nombre presentado por el usuario; se trata como texto no confiable.';
COMMENT ON COLUMN kvg.carga_archivo.estado_tecnico IS 'RECIBIENDO, PENDIENTE_VERIFICACION, HABILITADO, RECHAZADO, ERROR_VERIFICACION o ABANDONADO.';
COMMENT ON COLUMN kvg.carga_archivo.localizador_cuarentena IS 'Referencia privada del objeto temporal; nunca URL pública ni credencial.';
COMMENT ON COLUMN kvg.carga_archivo.tamano_recibido_bytes IS 'Tamaño comprobado por el servidor, si la recepción terminó.';
COMMENT ON COLUMN kvg.carga_archivo.resultado_tecnico_codigo IS 'Resultado acotado del análisis; sin contenido jurídico ni secretos.';
COMMENT ON COLUMN kvg.carga_archivo.motor_version IS 'Versión del verificador y firmas de análisis utilizadas.';
COMMENT ON COLUMN kvg.carga_archivo.solicitado_en IS 'Inicio del intento.';
COMMENT ON COLUMN kvg.carga_archivo.verificado_en IS 'Final de una verificación concluida.';
COMMENT ON COLUMN kvg.carga_archivo.motivo_version IS 'Razón de la primera carga o actualización.';
COMMENT ON TABLE kvg.version_documento IS 'Original publicado e inmutable en su contenido. El archivo reside en almacenamiento privado; la relación conserva sus metadatos de integridad.';
COMMENT ON COLUMN kvg.version_documento.version_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.version_documento.documento_id IS 'Referencia a documento.documento_id.';
COMMENT ON COLUMN kvg.version_documento.numero_version IS 'Secuencia positiva única dentro del documento.';
COMMENT ON COLUMN kvg.version_documento.carga_id IS 'Carga habilitada que originó la versión; una carga publica como máximo una versión.';
COMMENT ON COLUMN kvg.version_documento.localizador_objeto IS 'Clave opaca y estable del objeto privado; nueva para cada versión.';
COMMENT ON COLUMN kvg.version_documento.sha256 IS 'Resumen confiable de 64 caracteres hexadecimales del contenido.';
COMMENT ON COLUMN kvg.version_documento.tamano_bytes IS 'Tamaño real positivo del archivo.';
COMMENT ON COLUMN kvg.version_documento.formato IS 'PDF, DOCX, JPG o PNG, confirmado por contenido.';
COMMENT ON COLUMN kvg.version_documento.mime_verificado IS 'Tipo de contenido comprobado, distinto de la declaración del navegador.';
COMMENT ON COLUMN kvg.version_documento.estado_documento_codigo IS 'Estado jurídico actual de esta versión; inicia RECIBIDO.';
COMMENT ON COLUMN kvg.version_documento.publicado_en IS 'Fecha confiable en la que se habilitó como nueva versión.';
COMMENT ON COLUMN kvg.version_documento.fecha_origen IS 'Fecha histórica declarada del documento, si se conoce.';
COMMENT ON COLUMN kvg.version_documento.procedencia IS 'Fuente cuando se incorpora un original histórico.';
COMMENT ON COLUMN kvg.version_documento.revision IS 'Control de concurrencia de los cambios de estado jurídico.';
COMMENT ON TABLE kvg.revision_documento IS 'Observación jurídica inmutable sobre una versión específica; nunca valida automáticamente otra versión.';
COMMENT ON COLUMN kvg.revision_documento.revision_juridica_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.revision_documento.version_id IS 'Referencia a version_documento.version_id.';
COMMENT ON COLUMN kvg.revision_documento.revisor_id IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.revision_documento.observaciones IS 'Contenido de la revisión, no vacío y de acceso jurídico restringido.';
COMMENT ON COLUMN kvg.revision_documento.resultado IS 'OBSERVACIONES, APTO_PARA_VALIDAR o REQUIERE_CORRECCION; valoración registrada por el abogado.';
COMMENT ON COLUMN kvg.revision_documento.registrado_en IS 'Fecha confiable de la revisión.';
COMMENT ON COLUMN kvg.revision_documento.corrige_revision_id IS 'Revisión anterior de la misma versión que se corrige.';
COMMENT ON TABLE kvg.historial_estado_documento IS 'Registro inmutable del alta y las transiciones jurídicas de una versión exacta.';
COMMENT ON COLUMN kvg.historial_estado_documento.cambio_documento_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.historial_estado_documento.version_id IS 'Referencia a version_documento.version_id.';
COMMENT ON COLUMN kvg.historial_estado_documento.estado_origen_codigo IS 'Nulo únicamente para la publicación inicial.';
COMMENT ON COLUMN kvg.historial_estado_documento.estado_destino_codigo IS 'Estado alcanzado.';
COMMENT ON COLUMN kvg.historial_estado_documento.revision_juridica_id IS 'Necesaria al pasar de EN_REVISION a VALIDADO; de esta misma versión.';
COMMENT ON COLUMN kvg.historial_estado_documento.responsable_usuario_id IS 'Usuario responsable de la transición; en la publicación inicial, quien aportó el archivo. El ejecutor técnico se identifica en auditoría.';
COMMENT ON COLUMN kvg.historial_estado_documento.registrado_en IS 'Fecha de servidor de la transición.';
COMMENT ON COLUMN kvg.historial_estado_documento.motivo IS 'Razón y observación de la transición.';
COMMENT ON COLUMN kvg.historial_estado_documento.revision_resultante IS 'Revisión de la versión después del cambio.';
COMMENT ON TABLE kvg.evento_retiro_documento IS 'Entrada inmutable por retiro o recuperación de un documento; mantiene los originales y las razones de cada operación.';
COMMENT ON COLUMN kvg.evento_retiro_documento.retiro_evento_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.evento_retiro_documento.documento_id IS 'Referencia a documento.documento_id.';
COMMENT ON COLUMN kvg.evento_retiro_documento.operacion IS 'RETIRO o RECUPERACION.';
COMMENT ON COLUMN kvg.evento_retiro_documento.registrado_por IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.evento_retiro_documento.registrado_en IS 'Fecha de servidor.';
COMMENT ON COLUMN kvg.evento_retiro_documento.motivo IS 'Justificación obligatoria.';
COMMENT ON COLUMN kvg.evento_retiro_documento.autorizado_por IS 'Responsable de negocio cuando la conservación o recuperación lo exija.';
COMMENT ON COLUMN kvg.evento_retiro_documento.trabajo_verificacion_id IS 'Obligatorio en recuperación; evidencia de relaciones, existencia, hash y condición técnica.';
COMMENT ON COLUMN kvg.evento_retiro_documento.revision_resultante IS 'Revisión del documento tras la operación.';
COMMENT ON TABLE kvg.medida_conservacion IS 'Decisión aprobada que restringe un cliente, expediente o documento. No inventa plazos legales ni autoriza borrado automático.';
COMMENT ON COLUMN kvg.medida_conservacion.medida_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.medida_conservacion.cliente_id IS 'Referencia a cliente.cliente_id.';
COMMENT ON COLUMN kvg.medida_conservacion.expediente_id IS 'Referencia a expediente.expediente_id.';
COMMENT ON COLUMN kvg.medida_conservacion.documento_id IS 'Referencia a documento.documento_id.';
COMMENT ON COLUMN kvg.medida_conservacion.tipo IS 'PRESERVAR_ORIGINAL, IMPEDIR_RETIRO, BLOQUEAR_ACCESO, IMPEDIR_RECUPERACION, IMPEDIR_EDICION o CANCELACION_PENDIENTE.';
COMMENT ON COLUMN kvg.medida_conservacion.motivo IS 'Fundamento restringido de la decisión; no se copia completo en auditoría.';
COMMENT ON COLUMN kvg.medida_conservacion.autorizado_por IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.medida_conservacion.inicia_en IS 'Inicio de la medida.';
COMMENT ON COLUMN kvg.medida_conservacion.finaliza_en IS 'Fin efectivo autorizado; nulo mientras siga vigente.';
COMMENT ON COLUMN kvg.medida_conservacion.levantado_por IS 'Responsable que autoriza el cierre de la medida.';
COMMENT ON COLUMN kvg.medida_conservacion.referencia_decision IS 'Referencia al expediente o decisión de conservación.';
COMMENT ON COLUMN kvg.medida_conservacion.revision IS 'Control de cambios autorizados.';
COMMENT ON TABLE kvg.usuario IS 'Perfil operativo estable del personal, separado de las credenciales administradas por Supabase Auth.';
COMMENT ON COLUMN kvg.usuario.usuario_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.usuario.auth_usuario_id IS 'Referencia externa a auth.users.id; nula mientras no exista identidad vinculada.';
COMMENT ON COLUMN kvg.usuario.nombre IS 'Nombre del integrante del personal.';
COMMENT ON COLUMN kvg.usuario.correo_operativo IS 'Correo normalizado de invitación o contacto institucional, único entre perfiles conservados.';
COMMENT ON COLUMN kvg.usuario.estado_cuenta IS 'INVITADO, ACTIVO o DESACTIVADO. ACTIVO exige identidad vinculada.';
COMMENT ON COLUMN kvg.usuario.creado_por IS 'Administrador que invitó; nulo solo en el alta inicial controlada.';
COMMENT ON COLUMN kvg.usuario.creado_en IS 'Alta del perfil.';
COMMENT ON COLUMN kvg.usuario.desactivado_en IS 'Fecha de desactivación efectiva.';
COMMENT ON COLUMN kvg.usuario.motivo_desactivacion IS 'Justificación si se desactiva.';
COMMENT ON COLUMN kvg.usuario.revision_autorizacion IS 'Número positivo que cambia al modificar roles o accesos; no sustituye consultar la política actual.';
COMMENT ON COLUMN kvg.usuario.revision IS 'Control de actualización del perfil.';
COMMENT ON TABLE kvg.rol IS 'Conjunto de capacidades funcionales. No equivale a una cuenta de PostgreSQL ni al alcance sobre todos los expedientes.';
COMMENT ON COLUMN kvg.rol.rol_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.rol.codigo IS 'SECRETARIA, ABOGADO o ADMINISTRADOR en la base inicial.';
COMMENT ON COLUMN kvg.rol.nombre IS 'Nombre del rol.';
COMMENT ON COLUMN kvg.rol.descripcion IS 'Responsabilidad y límites.';
COMMENT ON COLUMN kvg.rol.activo IS 'Disponible para asignaciones vigentes.';
COMMENT ON COLUMN kvg.rol.revision IS 'Revisión de su definición.';
COMMENT ON TABLE kvg.permiso IS 'Capacidad atómica de realizar una operación, independiente de que exista acceso a un expediente concreto.';
COMMENT ON COLUMN kvg.permiso.permiso_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.permiso.codigo IS 'Código estable, como documento.descargar o expediente.concluir.';
COMMENT ON COLUMN kvg.permiso.recurso IS 'CLIENTE, EXPEDIENTE, DOCUMENTO, USUARIO, AUDITORIA, CONFIGURACION o RESPALDO.';
COMMENT ON COLUMN kvg.permiso.descripcion IS 'Acción específica autorizable.';
COMMENT ON COLUMN kvg.permiso.requiere_mfa IS 'Exige autenticación reforzada según la acción.';
COMMENT ON COLUMN kvg.permiso.requiere_decision IS 'Requiere además decisión de negocio u operativa identificable.';
COMMENT ON COLUMN kvg.permiso.activo IS 'Capacidad disponible en esta versión.';
COMMENT ON TABLE kvg.usuario_rol IS 'Historial de roles de cada integrante, sin eliminar la atribución al revocar facultades.';
COMMENT ON COLUMN kvg.usuario_rol.usuario_rol_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.usuario_rol.usuario_id IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.usuario_rol.rol_id IS 'Referencia a rol.rol_id.';
COMMENT ON COLUMN kvg.usuario_rol.inicia_en IS 'Inicio efectivo del rol.';
COMMENT ON COLUMN kvg.usuario_rol.finaliza_en IS 'Fin efectivo; nulo mientras siga abierto.';
COMMENT ON COLUMN kvg.usuario_rol.otorgado_por IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.usuario_rol.motivo_alta IS 'Justificación del otorgamiento.';
COMMENT ON COLUMN kvg.usuario_rol.revocado_por IS 'Obligatorio si se cierra.';
COMMENT ON COLUMN kvg.usuario_rol.motivo_cierre IS 'Razón de la revocación.';
COMMENT ON TABLE kvg.rol_permiso IS 'Resuelve la relación muchos a muchos entre roles y permisos y limita el contexto en que una capacidad puede utilizarse.';
COMMENT ON COLUMN kvg.rol_permiso.rol_id IS 'Referencia a rol.rol_id.';
COMMENT ON COLUMN kvg.rol_permiso.permiso_id IS 'Referencia a permiso.permiso_id.';
COMMENT ON COLUMN kvg.rol_permiso.contexto IS 'PRINCIPAL, COLABORADOR, EXPLICITO, GLOBAL_OPERATIVO o REGISTRO_PROPIO; forma parte de la PK.';
COMMENT ON COLUMN kvg.rol_permiso.activo IS 'Capacidad vigente para ese contexto.';
COMMENT ON COLUMN kvg.rol_permiso.aprobado_por IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.rol_permiso.aprobado_en IS 'Fecha de aprobación de la matriz.';
COMMENT ON COLUMN kvg.rol_permiso.revision IS 'Revisión de la entrada.';
COMMENT ON TABLE kvg.concesion_acceso IS 'Autorización temporal a una persona para un expediente, con aprobación de negocio y permisos específicos en una relación hija.';
COMMENT ON COLUMN kvg.concesion_acceso.concesion_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.concesion_acceso.expediente_id IS 'Referencia a expediente.expediente_id.';
COMMENT ON COLUMN kvg.concesion_acceso.usuario_id IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.concesion_acceso.inicia_en IS 'Inicio permitido.';
COMMENT ON COLUMN kvg.concesion_acceso.expira_en IS 'Caducidad programada, si procede.';
COMMENT ON COLUMN kvg.concesion_acceso.revocado_en IS 'Revocación efectiva anticipada.';
COMMENT ON COLUMN kvg.concesion_acceso.otorgado_por IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.concesion_acceso.aprobado_por IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.concesion_acceso.motivo IS 'Justificación del acceso.';
COMMENT ON COLUMN kvg.concesion_acceso.referencia_autorizacion IS 'Referencia de la aprobación verificable.';
COMMENT ON COLUMN kvg.concesion_acceso.revocado_por IS 'Responsable cuando se revoca.';
COMMENT ON COLUMN kvg.concesion_acceso.motivo_revocacion IS 'Razón de revocar.';
COMMENT ON TABLE kvg.concesion_permiso IS 'Operaciones concretas admitidas por una concesión; evita interpretar un acceso como autorización para editar, validar o descargar todo.';
COMMENT ON COLUMN kvg.concesion_permiso.concesion_id IS 'Referencia a concesion_acceso.concesion_id.';
COMMENT ON COLUMN kvg.concesion_permiso.permiso_id IS 'Referencia a permiso.permiso_id.';
COMMENT ON TABLE kvg.sesion_aplicacion IS 'Sesión comprobable por el backend que permite aplicar inactividad, cierre y revocación actuales.';
COMMENT ON COLUMN kvg.sesion_aplicacion.sesion_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.sesion_aplicacion.usuario_id IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.sesion_aplicacion.identificador_hash IS 'Resumen de un identificador aleatorio de sesión de alta entropía; no el secreto original.';
COMMENT ON COLUMN kvg.sesion_aplicacion.auth_sesion_ref IS 'Referencia opaca a la sesión de Auth cuando el proveedor la proporcione.';
COMMENT ON COLUMN kvg.sesion_aplicacion.creada_en IS 'Inicio de sesión operativa.';
COMMENT ON COLUMN kvg.sesion_aplicacion.ultima_actividad_en IS 'Actividad válida reciente.';
COMMENT ON COLUMN kvg.sesion_aplicacion.expira_en IS 'Límite máximo efectivo de duración.';
COMMENT ON COLUMN kvg.sesion_aplicacion.mfa_verificado_en IS 'Segundo factor validado por el proveedor.';
COMMENT ON COLUMN kvg.sesion_aplicacion.revocada_en IS 'Cierre o revocación efectiva.';
COMMENT ON COLUMN kvg.sesion_aplicacion.motivo_revocacion IS 'CIERRE, CADUCIDAD, DESACTIVACION o INCIDENTE.';
COMMENT ON TABLE kvg.evento_auditoria IS 'Evento append only generado por componentes confiables para acciones críticas, denegaciones y resultados observados.';
COMMENT ON COLUMN kvg.evento_auditoria.evento_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.evento_auditoria.ocurrido_en IS 'Instante UTC del componente confiable.';
COMMENT ON COLUMN kvg.evento_auditoria.tipo_actor IS 'USUARIO, SERVICIO o NO_AUTENTICADO.';
COMMENT ON COLUMN kvg.evento_auditoria.usuario_id IS 'Requerido si el actor es USUARIO.';
COMMENT ON COLUMN kvg.evento_auditoria.servicio_codigo IS 'Identidad técnica validada si el actor es SERVICIO.';
COMMENT ON COLUMN kvg.evento_auditoria.sesion_id IS 'Referencia a sesion_aplicacion.sesion_id.';
COMMENT ON COLUMN kvg.evento_auditoria.accion IS 'Código de la acción registrada.';
COMMENT ON COLUMN kvg.evento_auditoria.recurso_tipo IS 'Tipo validado de recurso; sin nombres jurídicos.';
COMMENT ON COLUMN kvg.evento_auditoria.recurso_id IS 'Identificador histórico del recurso; referencia lógica, no FK polimórfica.';
COMMENT ON COLUMN kvg.evento_auditoria.resultado IS 'EXITO, DENEGADO, FALLIDO o RECIBIDO, conforme al hecho observado.';
COMMENT ON COLUMN kvg.evento_auditoria.correlacion_id IS 'Agrupa solicitudes, trabajos y evidencias relacionadas.';
COMMENT ON COLUMN kvg.evento_auditoria.detalle_controlado IS 'Metadatos con esquema permitido: códigos, campos modificados y revisiones; sin contenidos completos ni secretos.';
COMMENT ON TABLE kvg.trabajo_operativo IS 'Unidad durable del trabajador para verificación, conciliación, respaldo, restauración o invitación, con reintentos controlados.';
COMMENT ON COLUMN kvg.trabajo_operativo.trabajo_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.trabajo_operativo.tipo IS 'VERIFICAR_CARGA, CONCILIAR_CARGA, VERIFICAR_RECUPERACION, RESPALDAR, RESTAURAR o CONCILIAR_IDENTIDAD.';
COMMENT ON COLUMN kvg.trabajo_operativo.objetivo_tipo IS 'CARGA, DOCUMENTO, RESPALDO, RESTAURACION o USUARIO, según el tipo de trabajo.';
COMMENT ON COLUMN kvg.trabajo_operativo.objetivo_id IS 'Referencia lógica tipada resuelta por el trabajador; no es una FK polimórfica.';
COMMENT ON COLUMN kvg.trabajo_operativo.clave_idempotencia IS 'Clave opaca única de la operación.';
COMMENT ON COLUMN kvg.trabajo_operativo.estado IS 'EN_COLA, EN_EJECUCION, COMPLETADO, FALLIDO o CANCELADO.';
COMMENT ON COLUMN kvg.trabajo_operativo.intentos IS 'Número no negativo de intentos efectuados.';
COMMENT ON COLUMN kvg.trabajo_operativo.max_intentos IS 'Límite positivo de reintentos autorizado.';
COMMENT ON COLUMN kvg.trabajo_operativo.creado_en IS 'Alta del trabajo.';
COMMENT ON COLUMN kvg.trabajo_operativo.proximo_intento_en IS 'Momento elegible de ejecución o reintento.';
COMMENT ON COLUMN kvg.trabajo_operativo.bloqueo_hasta IS 'Fin del arrendamiento del trabajador; evita una toma simultánea sin control.';
COMMENT ON COLUMN kvg.trabajo_operativo.ejecutor_codigo IS 'Identidad técnica que posee la ejecución.';
COMMENT ON COLUMN kvg.trabajo_operativo.finalizado_en IS 'Final de la ejecución terminal.';
COMMENT ON COLUMN kvg.trabajo_operativo.solicitado_por IS 'Usuario solicitante; nulo para programación técnica.';
COMMENT ON COLUMN kvg.trabajo_operativo.resultado_codigo IS 'Código de resultado sin secretos.';
COMMENT ON COLUMN kvg.trabajo_operativo.correlacion_id IS 'Relación con los eventos auditados.';
COMMENT ON TABLE kvg.politica_respaldo IS 'Configuración versionada de frecuencia, destino independiente y objetivos de recuperación aprobados.';
COMMENT ON COLUMN kvg.politica_respaldo.politica_respaldo_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.politica_respaldo.numero_revision IS 'Revisión de política; cada cambio crea otra definición.';
COMMENT ON COLUMN kvg.politica_respaldo.nombre IS 'Nombre de la programación.';
COMMENT ON COLUMN kvg.politica_respaldo.frecuencia_minutos IS 'Intervalo de programación positivo.';
COMMENT ON COLUMN kvg.politica_respaldo.rpo_objetivo_segundos IS 'Pérdida máxima objetivo; propuesta 3600 segundos.';
COMMENT ON COLUMN kvg.politica_respaldo.rto_objetivo_segundos IS 'Tiempo de recuperación objetivo; propuesta 14400 segundos.';
COMMENT ON COLUMN kvg.politica_respaldo.destino_ref IS 'Destino independiente cifrado, identificado sin claves ni URL de acceso.';
COMMENT ON COLUMN kvg.politica_respaldo.custodia_clave_ref IS 'Referencia del mecanismo de custodia recuperable; nunca la clave.';
COMMENT ON COLUMN kvg.politica_respaldo.activa IS 'Política utilizada por la programación.';
COMMENT ON COLUMN kvg.politica_respaldo.aprobado_por IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.politica_respaldo.aprobado_en IS 'Fecha de autorización operativa.';
COMMENT ON TABLE kvg.respaldo IS 'Punto de recuperación con datos, archivos, configuración necesaria y manifiesto verificable, almacenado fuera de la custodia principal.';
COMMENT ON COLUMN kvg.respaldo.respaldo_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.respaldo.politica_respaldo_id IS 'Referencia a politica_respaldo.politica_respaldo_id.';
COMMENT ON COLUMN kvg.respaldo.trabajo_id IS 'Referencia a trabajo_operativo.trabajo_id.';
COMMENT ON COLUMN kvg.respaldo.punto_recuperacion_en IS 'Corte consistente de datos y objetos correspondiente a la copia.';
COMMENT ON COLUMN kvg.respaldo.estado IS 'PENDIENTE, VERIFICANDO, VERIFICADO, INCOMPLETO o FALLIDO.';
COMMENT ON COLUMN kvg.respaldo.manifiesto_localizador IS 'Referencia privada del manifiesto externo.';
COMMENT ON COLUMN kvg.respaldo.manifiesto_sha256 IS 'Hash del manifiesto final.';
COMMENT ON COLUMN kvg.respaldo.verificado_en IS 'Fecha de comprobación completa.';
COMMENT ON COLUMN kvg.respaldo.evidencia_ref IS 'Referencia privada de cobertura, integridad y cifrado comprobados.';
COMMENT ON TABLE kvg.elemento_manifiesto IS 'Registro de correspondencia de un artefacto copiado. Sus metadatos son una instantánea histórica verificable de la copia.';
COMMENT ON COLUMN kvg.elemento_manifiesto.respaldo_id IS 'Referencia a respaldo.respaldo_id.';
COMMENT ON COLUMN kvg.elemento_manifiesto.numero_elemento IS 'Número positivo dentro del manifiesto; parte de la PK.';
COMMENT ON COLUMN kvg.elemento_manifiesto.tipo IS 'DATOS, OBJETO, CONFIGURACION, IDENTIDAD o RESTRICCIONES.';
COMMENT ON COLUMN kvg.elemento_manifiesto.version_origen_id IS 'Para OBJETO: identificador histórico de la versión, sin dependencia FK de producción.';
COMMENT ON COLUMN kvg.elemento_manifiesto.localizador_origen IS 'Clave del artefacto en el origen o referencia del corte de datos.';
COMMENT ON COLUMN kvg.elemento_manifiesto.localizador_copia IS 'Clave opaca en el destino independiente.';
COMMENT ON COLUMN kvg.elemento_manifiesto.sha256_copia IS 'Hash confiable del artefacto copiado, no de una URL.';
COMMENT ON COLUMN kvg.elemento_manifiesto.tamano_copia_bytes IS 'Tamaño del artefacto cifrado o copiado, según la definición del formato.';
COMMENT ON COLUMN kvg.elemento_manifiesto.sha256_original IS 'Para OBJETO: hash de los bytes originales que se comprobarán al restaurar.';
COMMENT ON COLUMN kvg.elemento_manifiesto.tamano_original_bytes IS 'Para OBJETO: tamaño de los bytes originales.';
COMMENT ON COLUMN kvg.elemento_manifiesto.copiado_en IS 'Fecha de copia.';
COMMENT ON COLUMN kvg.elemento_manifiesto.verificado_en IS 'Fecha de comprobación.';
COMMENT ON COLUMN kvg.elemento_manifiesto.custodia_clave_ref IS 'Referencia de clave o envoltura necesaria si el artefacto está cifrado; nunca el secreto.';
COMMENT ON TABLE kvg.restauracion IS 'Ejecución de ensayo o recuperación de un respaldo en aislamiento, con aprobación separada antes de habilitar producción.';
COMMENT ON COLUMN kvg.restauracion.restauracion_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.restauracion.respaldo_id IS 'Referencia a respaldo.respaldo_id.';
COMMENT ON COLUMN kvg.restauracion.trabajo_id IS 'Referencia a trabajo_operativo.trabajo_id.';
COMMENT ON COLUMN kvg.restauracion.modalidad IS 'ENSAYO o INCIDENTE.';
COMMENT ON COLUMN kvg.restauracion.estado IS 'SOLICITADA, EN_AISLAMIENTO, VERIFICADA, HABILITADA, ABORTADA o FALLIDA.';
COMMENT ON COLUMN kvg.restauracion.entorno_aislado_ref IS 'Referencia del entorno sin acceso ordinario.';
COMMENT ON COLUMN kvg.restauracion.autorizado_por IS 'Responsable que permite habilitar producción.';
COMMENT ON COLUMN kvg.restauracion.autorizado_en IS 'Fecha de esa decisión operativa.';
COMMENT ON COLUMN kvg.restauracion.incidente_en IS 'Instante del incidente para medir pérdida y recuperación.';
COMMENT ON COLUMN kvg.restauracion.verificado_en IS 'Fin de comprobaciones de datos, objetos, integridad y acceso.';
COMMENT ON COLUMN kvg.restauracion.restricciones_hasta IS 'Corte del registro independiente de restricciones aplicado.';
COMMENT ON COLUMN kvg.restauracion.estado_previo_ref IS 'Referencia cifrada de la copia del estado previo a sustituir producción.';
COMMENT ON COLUMN kvg.restauracion.servicio_habilitado_en IS 'Momento en que se recuperó el servicio.';
COMMENT ON COLUMN kvg.restauracion.rpo_medido_segundos IS 'Pérdida efectiva medida; nulo si todavía no se evaluó.';
COMMENT ON COLUMN kvg.restauracion.rto_medido_segundos IS 'Tiempo medido de recuperación o ensayo, con criterio documentado.';
COMMENT ON COLUMN kvg.restauracion.evidencia_ref IS 'Acta técnica de verificaciones y medición; referencia privada.';
COMMENT ON TABLE kvg.parametro_sistema IS 'Valor operativo acotado por una definición de configuración; no sustituye entidades de negocio ni almacena secretos.';
COMMENT ON COLUMN kvg.parametro_sistema.parametro_codigo IS 'Clave estable y permitida, como sesion.inactividad_minutos.';
COMMENT ON COLUMN kvg.parametro_sistema.tipo_valor IS 'ENTERO, BOOLEANO, CODIGO o TEXTO.';
COMMENT ON COLUMN kvg.parametro_sistema.valor IS 'Representación canónica del valor, validada con el tipo y la regla.';
COMMENT ON COLUMN kvg.parametro_sistema.regla_validacion IS 'Referencia a límites y opciones aprobados, sin código ejecutable.';
COMMENT ON COLUMN kvg.parametro_sistema.editable IS 'Permite edición ordinaria dentro de los límites aprobados.';
COMMENT ON COLUMN kvg.parametro_sistema.modificado_por IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.parametro_sistema.modificado_en IS 'Fecha de la configuración vigente.';
COMMENT ON COLUMN kvg.parametro_sistema.revision IS 'Control de cambios concurrentes.';
COMMENT ON TABLE kvg.historial_parametro IS 'Entrada inmutable de cambios de valores operativos permitidos.';
COMMENT ON COLUMN kvg.historial_parametro.parametro_evento_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.historial_parametro.parametro_codigo IS 'Parámetro modificado.';
COMMENT ON COLUMN kvg.historial_parametro.valor_anterior IS 'Valor anterior; nulo en el alta controlada.';
COMMENT ON COLUMN kvg.historial_parametro.valor_nuevo IS 'Valor admitido tras el cambio.';
COMMENT ON COLUMN kvg.historial_parametro.registrado_por IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.historial_parametro.registrado_en IS 'Fecha de servidor.';
COMMENT ON COLUMN kvg.historial_parametro.motivo IS 'Justificación obligatoria.';
COMMENT ON COLUMN kvg.historial_parametro.revision_resultante IS 'Revisión del parámetro después del cambio.';
COMMENT ON TABLE kvg.evento_restriccion IS 'Evento inmutable de una revocación o medida que debe mantenerse al recuperar una copia antigua. Se replica bajo custodia independiente.';
COMMENT ON COLUMN kvg.evento_restriccion.restriccion_evento_id IS 'Identificador estable generado por el servidor.';
COMMENT ON COLUMN kvg.evento_restriccion.ocurrido_en IS 'Instante efectivo de la restricción o su levantamiento aprobado.';
COMMENT ON COLUMN kvg.evento_restriccion.accion IS 'DESACTIVAR_USUARIO, REVOCAR_ROL, REVOCAR_CAPACIDAD, CERRAR_ASIGNACION, REVOCAR_CONCESION, RETIRAR_DOCUMENTO, RECUPERAR_DOCUMENTO, APLICAR_MEDIDA o LEVANTAR_MEDIDA.';
COMMENT ON COLUMN kvg.evento_restriccion.recurso_tipo IS 'USUARIO, USUARIO_ROL, ROL_PERMISO, ASIGNACION, CONCESION, DOCUMENTO o MEDIDA.';
COMMENT ON COLUMN kvg.evento_restriccion.recurso_id IS 'Identificador histórico tipado; en capacidades se registra su clave compuesta en detalle_controlado.';
COMMENT ON COLUMN kvg.evento_restriccion.registrado_por IS 'Referencia a usuario.usuario_id.';
COMMENT ON COLUMN kvg.evento_restriccion.detalle_controlado IS 'Esquema acotado con claves afectadas, contexto y efecto; sin fundamento jurídico completo ni secretos.';
COMMENT ON COLUMN kvg.evento_restriccion.correlacion_id IS 'Vincula la decisión con auditoría y sus evidencias.';


-- 8. Identidad, sesión y autorización por recurso.
CREATE FUNCTION kvg_privado.usuario_actual()
RETURNS uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $func$
    SELECT u.usuario_id
    FROM kvg.usuario u
    JOIN kvg.sesion_aplicacion s ON s.usuario_id = u.usuario_id
    JOIN auth.sessions a ON a.id::text = s.auth_sesion_ref AND a.user_id = u.auth_usuario_id
    WHERE u.auth_usuario_id = auth.uid() AND u.estado_cuenta = 'ACTIVO'
      AND s.auth_sesion_ref = auth.jwt()->>'session_id'
      AND auth.jwt()->>'aal' = 'aal2'
      AND coalesce((auth.jwt()->>'is_anonymous')::boolean,false) = false
      AND s.revocada_en IS NULL AND s.expira_en > clock_timestamp()
      AND s.mfa_verificado_en IS NOT NULL
      AND s.ultima_actividad_en > clock_timestamp() - make_interval(mins =>
           coalesce((SELECT valor::integer FROM kvg.parametro_sistema
                     WHERE parametro_codigo = 'sesion.inactividad_minutos'),30))
    LIMIT 1;
$func$;

CREATE FUNCTION kvg_privado.rol_vigente(p_usuario uuid, p_rol text)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $func$
    SELECT EXISTS (SELECT 1 FROM kvg.usuario u
      JOIN kvg.usuario_rol ur ON ur.usuario_id = u.usuario_id
      JOIN kvg.rol r ON r.rol_id = ur.rol_id
      WHERE u.usuario_id = p_usuario AND u.estado_cuenta = 'ACTIVO'
       AND r.codigo = p_rol AND r.activo
       AND ur.inicia_en <= clock_timestamp()
       AND (ur.finaliza_en IS NULL OR ur.finaliza_en > clock_timestamp()));
$func$;

CREATE FUNCTION kvg_privado.capacidad(p_usuario uuid, p_permiso text, p_contexto text)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $func$
    SELECT EXISTS (SELECT 1 FROM kvg.usuario u
      JOIN kvg.usuario_rol ur ON ur.usuario_id = u.usuario_id
      JOIN kvg.rol r ON r.rol_id = ur.rol_id
      JOIN kvg.rol_permiso rp ON rp.rol_id = r.rol_id
      JOIN kvg.permiso p ON p.permiso_id = rp.permiso_id
      WHERE u.usuario_id = p_usuario AND u.estado_cuenta = 'ACTIVO'
       AND r.activo AND rp.activo AND p.activo AND p.codigo = p_permiso
       AND rp.contexto = p_contexto AND ur.inicia_en <= clock_timestamp()
       AND (ur.finaliza_en IS NULL OR ur.finaliza_en > clock_timestamp()));
$func$;

CREATE FUNCTION kvg_privado.medida_impide(p_cliente uuid, p_expediente uuid, p_documento uuid, p_accion text)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $func$
    SELECT EXISTS (SELECT 1 FROM kvg.medida_conservacion m
      WHERE (m.cliente_id = p_cliente OR m.expediente_id = p_expediente OR m.documento_id = p_documento)
      AND m.inicia_en <= clock_timestamp()
      AND (m.finaliza_en IS NULL OR m.finaliza_en > clock_timestamp())
      AND (m.tipo IN ('BLOQUEAR_ACCESO','CANCELACION_PENDIENTE')
       OR (p_accion = 'EDITAR' AND m.tipo = 'IMPEDIR_EDICION')
       OR (p_accion = 'RETIRAR' AND m.tipo = 'IMPEDIR_RETIRO')
       OR (p_accion = 'RECUPERAR' AND m.tipo = 'IMPEDIR_RECUPERACION')));
$func$;

CREATE FUNCTION kvg_privado.alcance(p_usuario uuid, p_permiso text, p_expediente uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $func$
    SELECT p_usuario IS NOT NULL AND (
      EXISTS (SELECT 1 FROM kvg.asignacion_expediente a
       WHERE a.expediente_id = p_expediente AND a.abogado_id = p_usuario
       AND a.inicia_en <= clock_timestamp()
       AND (a.finaliza_en IS NULL OR a.finaliza_en > clock_timestamp())
       AND kvg_privado.rol_vigente(p_usuario,'ABOGADO')
       AND kvg_privado.capacidad(p_usuario,p_permiso,a.funcion))
      OR (kvg_privado.capacidad(p_usuario,p_permiso,'EXPLICITO') AND EXISTS
       (SELECT 1 FROM kvg.concesion_acceso c
        JOIN kvg.concesion_permiso cp ON cp.concesion_id = c.concesion_id
        JOIN kvg.permiso p ON p.permiso_id = cp.permiso_id
        WHERE c.usuario_id = p_usuario AND c.expediente_id = p_expediente
         AND p.codigo = p_permiso AND p.activo AND c.inicia_en <= clock_timestamp()
         AND (c.expira_en IS NULL OR c.expira_en > clock_timestamp())
         AND (c.revocado_en IS NULL OR c.revocado_en > clock_timestamp()))));
$func$;

CREATE FUNCTION kvg_privado.puede_expediente(p_permiso text, p_expediente uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $func$
    SELECT EXISTS (SELECT 1 FROM kvg.expediente e
      WHERE e.expediente_id = p_expediente
       AND kvg_privado.alcance(kvg_privado.usuario_actual(),p_permiso,e.expediente_id)
       AND NOT kvg_privado.medida_impide(e.cliente_principal_id,e.expediente_id,NULL,
         CASE WHEN p_permiso IN ('cliente.consultar','expediente.consultar','documento.consultar','documento.descargar','documento.versiones')
              THEN 'LEER' ELSE 'EDITAR' END));
$func$;

CREATE FUNCTION kvg_privado.puede_cliente(p_permiso text, p_cliente uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $func$
    SELECT EXISTS (SELECT 1 FROM kvg.cliente c WHERE c.cliente_id = p_cliente
       AND NOT kvg_privado.medida_impide(c.cliente_id,NULL,NULL,
            CASE WHEN p_permiso = 'cliente.consultar' THEN 'LEER' ELSE 'EDITAR' END)
       AND (EXISTS (SELECT 1 FROM kvg.expediente e WHERE e.cliente_principal_id = c.cliente_id
                    AND kvg_privado.puede_expediente(p_permiso,e.expediente_id))
        OR (c.creado_por = kvg_privado.usuario_actual()
            AND kvg_privado.capacidad(c.creado_por,p_permiso,'REGISTRO_PROPIO')
            AND NOT EXISTS (SELECT 1 FROM kvg.expediente e WHERE e.cliente_principal_id = c.cliente_id))));
$func$;

CREATE FUNCTION kvg_privado.puede_documento(p_permiso text, p_documento uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $func$
    SELECT EXISTS (SELECT 1 FROM kvg.documento d
      JOIN kvg.expediente e ON e.expediente_id = d.expediente_id
      WHERE d.documento_id = p_documento AND d.retirado_en IS NULL
       AND kvg_privado.puede_expediente(p_permiso,d.expediente_id)
       AND NOT kvg_privado.medida_impide(e.cliente_principal_id,d.expediente_id,d.documento_id,
          CASE WHEN p_permiso IN ('documento.consultar','documento.descargar','documento.versiones') THEN 'LEER'
               WHEN p_permiso = 'documento.retirar' THEN 'RETIRAR' ELSE 'EDITAR' END)
       AND (p_permiso NOT IN ('documento.descargar','documento.versiones') OR d.version_vigente_id IS NOT NULL));
$func$;

CREATE FUNCTION kvg_privado.puede_version(p_permiso text, p_version uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $func$
    SELECT EXISTS (SELECT 1 FROM kvg.version_documento v JOIN kvg.carga_archivo c ON c.carga_id = v.carga_id
      WHERE v.version_id = p_version AND c.estado_tecnico = 'HABILITADO'
       AND kvg_privado.puede_documento(p_permiso,v.documento_id));
$func$;

CREATE FUNCTION kvg_privado.puede_global(p_permiso text)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $func$
    SELECT kvg_privado.capacidad(kvg_privado.usuario_actual(),p_permiso,'GLOBAL_OPERATIVO');
$func$;

CREATE FUNCTION kvg_privado.exigir(p_condicion boolean)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $func$
BEGIN
    IF p_condicion IS DISTINCT FROM true THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Operación no autorizada.';
    END IF;
END;
$func$;

CREATE FUNCTION kvg_privado.exigir_revision(p_actual integer, p_esperada integer)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $func$
BEGIN
    IF p_actual IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Recurso no disponible.';
    END IF;
    IF p_esperada IS NULL OR p_esperada <> p_actual THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'La revisión del recurso cambió.';
    END IF;
END;
$func$;

CREATE FUNCTION kvg_privado.exigir_editable(p_expediente uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM kvg.expediente WHERE expediente_id = p_expediente
                   AND estado_expediente_codigo IN ('NUEVO','EN_PROCESO','PENDIENTE')) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'El expediente no admite edición ordinaria.';
    END IF;
END;
$func$;

CREATE FUNCTION kvg_privado.auditar(p_accion text, p_tipo text, p_id uuid,
    p_resultado text DEFAULT 'EXITO', p_detalle jsonb DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE v_actor uuid; v_sesion uuid; v_id uuid;
BEGIN
    SELECT usuario_id INTO v_actor FROM kvg.usuario WHERE auth_usuario_id = auth.uid();
    SELECT sesion_id INTO v_sesion FROM kvg.sesion_aplicacion WHERE usuario_id = v_actor
        AND auth_sesion_ref = auth.jwt()->>'session_id';
    INSERT INTO kvg.evento_auditoria (tipo_actor,usuario_id,servicio_codigo,sesion_id,
        accion,recurso_tipo,recurso_id,resultado,correlacion_id,detalle_controlado)
    VALUES (CASE WHEN v_actor IS NOT NULL THEN 'USUARIO'
                 WHEN auth.role() = 'service_role' OR auth.uid() IS NULL AND session_user = 'postgres'
                 THEN 'SERVICIO' ELSE 'NO_AUTENTICADO' END,
        v_actor, CASE WHEN v_actor IS NULL AND (auth.role() = 'service_role' OR auth.uid() IS NULL AND session_user = 'postgres')
                     THEN 'OPERACION_KVG' ELSE NULL END,
        v_sesion,p_accion,p_tipo,p_id,p_resultado,gen_random_uuid(),p_detalle)
    RETURNING evento_id INTO v_id;
    RETURN v_id;
END;
$func$;

CREATE FUNCTION kvg_privado.restringir(p_accion text, p_tipo text, p_id text, p_actor uuid, p_detalle jsonb DEFAULT '{}')
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $func$
    INSERT INTO kvg.evento_restriccion (accion,recurso_tipo,recurso_id,registrado_por,detalle_controlado,correlacion_id)
    VALUES (p_accion,p_tipo,p_id,p_actor,p_detalle,gen_random_uuid());
$func$;

-- CU023 y CU024. La sesión de Auth debe ser real, vigente y con AAL2.
CREATE FUNCTION kvg_privado.iniciar_sesion()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE v_usuario uuid; v_sesion kvg.sesion_aplicacion; v_auth text; v_secreto text;
BEGIN
    PERFORM kvg_privado.exigir(auth.jwt()->>'aal' = 'aal2');
    SELECT usuario_id INTO v_usuario FROM kvg.usuario
        WHERE auth_usuario_id = auth.uid() AND estado_cuenta = 'ACTIVO';
    v_auth := auth.jwt()->>'session_id';
    PERFORM kvg_privado.exigir(v_usuario IS NOT NULL AND EXISTS
      (SELECT 1 FROM auth.sessions WHERE id::text = v_auth AND user_id = auth.uid()));
    PERFORM pg_advisory_xact_lock(hashtextextended('sesion:' || v_auth,0));
    SELECT * INTO v_sesion FROM kvg.sesion_aplicacion WHERE auth_sesion_ref = v_auth FOR UPDATE;
    IF FOUND THEN
        PERFORM kvg_privado.exigir(kvg_privado.usuario_actual() IS NOT NULL);
        UPDATE kvg.sesion_aplicacion SET ultima_actividad_en = clock_timestamp() WHERE sesion_id = v_sesion.sesion_id;
        RETURN jsonb_build_object('sesion_id',v_sesion.sesion_id,'expira_en',v_sesion.expira_en);
    END IF;
    v_secreto := encode(extensions.gen_random_bytes(32),'hex');
    INSERT INTO kvg.sesion_aplicacion (usuario_id,identificador_hash,auth_sesion_ref,expira_en,mfa_verificado_en)
    VALUES (v_usuario,encode(extensions.digest(v_secreto,'sha256'),'hex'),v_auth,
      clock_timestamp() + make_interval(hours => coalesce((SELECT valor::integer FROM kvg.parametro_sistema
      WHERE parametro_codigo = 'sesion.duracion_horas'),8)),clock_timestamp()) RETURNING * INTO v_sesion;
    PERFORM kvg_privado.auditar('SESION_INICIAR','SESION',v_sesion.sesion_id);
    RETURN jsonb_build_object('sesion_id',v_sesion.sesion_id,'expira_en',v_sesion.expira_en);
END;
$func$;

CREATE FUNCTION kvg_privado.cerrar_sesion()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE v_actor uuid; v_sesion uuid;
BEGIN
    v_actor := kvg_privado.usuario_actual();
    PERFORM kvg_privado.exigir(v_actor IS NOT NULL);
    UPDATE kvg.sesion_aplicacion SET revocada_en = clock_timestamp(),motivo_revocacion = 'CIERRE'
      WHERE usuario_id = v_actor AND auth_sesion_ref = auth.jwt()->>'session_id'
      RETURNING sesion_id INTO v_sesion;
    PERFORM kvg_privado.auditar('SESION_CERRAR','SESION',v_sesion);
    RETURN jsonb_build_object('sesion_id',v_sesion);
END;
$func$;


-- 9. Protección de originales, historiales y cambios concurrentes.
CREATE FUNCTION kvg_privado.prohibir_modificacion()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $func$
BEGIN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'El registro histórico no admite modificación ni eliminación.';
END;
$func$;

CREATE FUNCTION kvg_privado.controlar_revision()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $func$
DECLARE v_nuevo jsonb; v_anterior jsonb;
BEGIN
    v_nuevo := to_jsonb(NEW); v_anterior := to_jsonb(OLD);
    IF v_nuevo = v_anterior THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'version_documento' AND
       v_nuevo - ARRAY['estado_documento_codigo','revision'] <>
       v_anterior - ARRAY['estado_documento_codigo','revision'] THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Los metadatos del original son inmutables.';
    END IF;
    IF TG_TABLE_NAME = 'expediente' AND (v_nuevo->>'folio_interno') IS DISTINCT FROM (v_anterior->>'folio_interno') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'El folio interno es inmutable.';
    END IF;
    NEW.revision := OLD.revision + 1;
    IF v_nuevo ? 'actualizado_en' THEN
        NEW := jsonb_populate_record(NEW,jsonb_build_object('actualizado_en',clock_timestamp()));
    END IF;
    RETURN NEW;
END;
$func$;

CREATE FUNCTION kvg_privado.validar_identificacion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE v_tipo kvg.tipo_identificacion; v_valor text;
BEGIN
    SELECT * INTO v_tipo FROM kvg.tipo_identificacion
      WHERE tipo_identificacion_codigo = NEW.tipo_identificacion_codigo FOR UPDATE;
    IF NOT FOUND OR (TG_OP = 'INSERT' AND NOT v_tipo.activo) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Tipo de identificación no disponible.';
    END IF;
    IF TG_OP = 'UPDATE' AND to_jsonb(NEW) - 'retirado_en' <> to_jsonb(OLD) - 'retirado_en' THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'La identificación se corrige mediante un registro nuevo.';
    END IF;
    IF TG_OP = 'INSERT' THEN
        v_valor := CASE v_tipo.regla_normalizacion
            WHEN 'EXACTA_V1' THEN btrim(NEW.valor_original)
            WHEN 'MAYUSCULAS_V1' THEN upper(btrim(NEW.valor_original))
            WHEN 'ALFANUMERICA_V1' THEN regexp_replace(upper(NEW.valor_original),'[^A-Z0-9]','','g') END;
        NEW.valor_normalizado := v_valor;
        NEW.regla_revision := v_tipo.revision;
    END IF;
    IF NEW.retirado_en IS NULL AND v_tipo.unicidad_exigida AND EXISTS
      (SELECT 1 FROM kvg.identificacion_cliente i
       WHERE i.tipo_identificacion_codigo = NEW.tipo_identificacion_codigo
        AND i.valor_normalizado = NEW.valor_normalizado AND i.retirado_en IS NULL
        AND i.cliente_id <> NEW.cliente_id AND i.identificacion_id <> NEW.identificacion_id) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'La identificación ya corresponde a otro cliente.';
    END IF;
    RETURN NEW;
END;
$func$;

CREATE FUNCTION kvg_privado.validar_tipo_identificacion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
BEGIN
    IF (NEW.regla_normalizacion,NEW.unicidad_exigida) IS DISTINCT FROM
       (OLD.regla_normalizacion,OLD.unicidad_exigida) AND EXISTS
       (SELECT 1 FROM kvg.identificacion_cliente WHERE tipo_identificacion_codigo = OLD.tipo_identificacion_codigo) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'La regla utilizada debe conservarse; se requiere un tipo versionado nuevo.';
    END IF;
    RETURN NEW;
END;
$func$;

CREATE FUNCTION kvg_privado.validar_referencias()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE v_expediente uuid; v_version uuid; v_fecha timestamptz;
BEGIN
    IF TG_TABLE_NAME = 'avance_version' THEN
        SELECT expediente_id INTO v_expediente FROM kvg.avance_expediente WHERE avance_id = NEW.avance_id;
        IF NOT EXISTS (SELECT 1 FROM kvg.version_documento v JOIN kvg.documento d ON d.documento_id = v.documento_id
                        WHERE v.version_id = NEW.version_id AND d.expediente_id = v_expediente) THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'La referencia documental pertenece a otro expediente.';
        END IF;
    ELSIF TG_TABLE_NAME = 'avance_expediente' THEN
      IF NEW.corrige_avance_id IS NOT NULL THEN
        SELECT registrado_en INTO v_fecha FROM kvg.avance_expediente WHERE avance_id = NEW.corrige_avance_id;
        IF v_fecha IS NULL OR v_fecha >= NEW.registrado_en THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'La corrección requiere una entrada anterior.';
        END IF;
      END IF;
    ELSIF TG_TABLE_NAME = 'revision_documento' THEN
      IF NEW.corrige_revision_id IS NOT NULL THEN
        SELECT registrado_en INTO v_fecha FROM kvg.revision_documento WHERE revision_juridica_id = NEW.corrige_revision_id;
        IF v_fecha IS NULL OR v_fecha >= NEW.registrado_en THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'La corrección requiere una revisión anterior.';
        END IF;
      END IF;
    ELSIF TG_TABLE_NAME = 'version_documento' THEN
        IF NOT EXISTS (SELECT 1 FROM kvg.carga_archivo c WHERE c.carga_id = NEW.carga_id
                        AND c.documento_id = NEW.documento_id AND c.estado_tecnico = 'HABILITADO'
                        AND c.tamano_recibido_bytes = NEW.tamano_bytes) THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'La versión requiere una carga habilitada y coherente.';
        END IF;
    ELSIF TG_TABLE_NAME = 'historial_estado_documento' THEN
      IF NEW.estado_origen_codigo = 'EN_REVISION'
          AND NEW.estado_destino_codigo = 'VALIDADO' THEN
        IF NOT EXISTS (SELECT 1 FROM kvg.revision_documento r
           WHERE r.revision_juridica_id = NEW.revision_juridica_id AND r.version_id = NEW.version_id
            AND r.resultado = 'APTO_PARA_VALIDAR') THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Se requiere una revisión apta de la misma versión.';
        END IF;
      END IF;
    ELSIF TG_TABLE_NAME = 'evento_retiro_documento' THEN
      IF NEW.operacion = 'RECUPERACION' THEN
        IF NOT EXISTS (SELECT 1 FROM kvg.trabajo_operativo t WHERE t.trabajo_id = NEW.trabajo_verificacion_id
          AND t.tipo = 'VERIFICAR_RECUPERACION' AND t.objetivo_id = NEW.documento_id AND t.estado = 'COMPLETADO'
          AND t.resultado_codigo = 'INTEGRIDAD_VERIFICADA') THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'La recuperación requiere verificación técnica concluida.';
        END IF;
      END IF;
    END IF;
    RETURN NEW;
END;
$func$;

CREATE FUNCTION kvg_privado.validar_responsables()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
BEGIN
    IF EXISTS (SELECT 1 FROM kvg.expediente e
      WHERE e.estado_expediente_codigo IN ('EN_PROCESO','PENDIENTE') AND NOT EXISTS
       (SELECT 1 FROM kvg.asignacion_expediente a WHERE a.expediente_id = e.expediente_id
        AND a.funcion = 'PRINCIPAL' AND a.inicia_en <= clock_timestamp()
        AND (a.finaliza_en IS NULL OR a.finaliza_en > clock_timestamp())
        AND kvg_privado.rol_vigente(a.abogado_id,'ABOGADO'))) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Un expediente activo requiere un principal activo con rol jurídico.';
    END IF;
    IF EXISTS (SELECT 1 FROM kvg.usuario_rol ur JOIN kvg.rol r ON r.rol_id = ur.rol_id
               WHERE r.codigo = 'ADMINISTRADOR') AND NOT EXISTS
       (SELECT 1 FROM kvg.usuario u WHERE kvg_privado.capacidad(u.usuario_id,'usuario.administrar','GLOBAL_OPERATIVO')) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Debe conservarse al menos una administración operativa.';
    END IF;
    RETURN NULL;
END;
$func$;

CREATE FUNCTION kvg_privado.validar_resumen_historial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE v_fila jsonb; v_id uuid; v_estado text; v_actual text; v_exp uuid; v_version uuid;
BEGIN
    v_fila := to_jsonb(NEW);
    IF TG_TABLE_NAME IN ('expediente','historial_estado_expediente') THEN
        v_id := (v_fila->>'expediente_id')::uuid;
        SELECT estado_expediente_codigo INTO v_actual FROM kvg.expediente WHERE expediente_id = v_id;
        SELECT estado_destino_codigo INTO v_estado FROM kvg.historial_estado_expediente
          WHERE expediente_id = v_id ORDER BY revision_resultante DESC LIMIT 1;
        IF v_estado IS DISTINCT FROM v_actual THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Estado del expediente e historial inconsistentes.';
        END IF;
    ELSIF TG_TABLE_NAME IN ('version_documento','historial_estado_documento') THEN
        v_id := (v_fila->>'version_id')::uuid;
        SELECT estado_documento_codigo INTO v_actual FROM kvg.version_documento WHERE version_id = v_id;
        SELECT estado_destino_codigo INTO v_estado FROM kvg.historial_estado_documento
          WHERE version_id = v_id ORDER BY revision_resultante DESC LIMIT 1;
        IF v_estado IS DISTINCT FROM v_actual THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Estado de la versión e historial inconsistentes.';
        END IF;
    ELSE
        v_id := (v_fila->>'documento_id')::uuid;
        SELECT expediente_id,version_vigente_id INTO v_exp,v_version FROM kvg.documento WHERE documento_id = v_id;
        IF v_exp IS DISTINCT FROM (SELECT expediente_destino_id FROM kvg.historial_asociacion_documento
                    WHERE documento_id = v_id ORDER BY revision_resultante DESC LIMIT 1) THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Asociación del documento e historial inconsistentes.';
        END IF;
        IF v_version IS DISTINCT FROM (SELECT version_id FROM kvg.version_documento
                     WHERE documento_id = v_id ORDER BY numero_version DESC LIMIT 1) THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'La versión vigente debe ser la última versión publicada.';
        END IF;
        IF EXISTS (SELECT 1 FROM kvg.documento d WHERE d.documento_id = v_id AND
           ((d.retirado_en IS NOT NULL AND coalesce((SELECT operacion FROM kvg.evento_retiro_documento
              WHERE documento_id = v_id ORDER BY revision_resultante DESC LIMIT 1),'') <> 'RETIRO')
           OR (d.retirado_en IS NULL AND coalesce((SELECT operacion FROM kvg.evento_retiro_documento
              WHERE documento_id = v_id ORDER BY revision_resultante DESC LIMIT 1),'RECUPERACION') <> 'RECUPERACION'))) THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Disponibilidad del documento e historial inconsistentes.';
        END IF;
    END IF;
    RETURN NULL;
END;
$func$;

CREATE FUNCTION kvg_privado.validar_concesion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE v_id uuid;
BEGIN
    v_id := NEW.concesion_id;
    IF EXISTS (SELECT 1 FROM kvg.concesion_acceso c WHERE c.concesion_id = v_id
               AND NOT EXISTS (SELECT 1 FROM kvg.concesion_permiso p WHERE p.concesion_id = c.concesion_id)) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'La concesión requiere al menos un permiso específico.';
    END IF;
    RETURN NULL;
END;
$func$;

CREATE FUNCTION kvg_privado.validar_manifiesto()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE v_id uuid; v_estado text; v_punto timestamptz;
BEGIN
    v_id := NEW.respaldo_id;
    IF TG_TABLE_NAME = 'elemento_manifiesto' AND EXISTS
        (SELECT 1 FROM kvg.respaldo WHERE respaldo_id = v_id AND estado = 'VERIFICADO') THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'El manifiesto verificado permanece cerrado.';
    END IF;
    SELECT estado,punto_recuperacion_en INTO v_estado,v_punto FROM kvg.respaldo WHERE respaldo_id = v_id;
    IF TG_TABLE_NAME = 'elemento_manifiesto' THEN
      IF NEW.tipo = 'OBJETO' AND NOT EXISTS (SELECT 1 FROM kvg.version_documento v
        WHERE v.version_id = NEW.version_origen_id AND v.publicado_en <= v_punto
          AND v.sha256 = NEW.sha256_original AND v.tamano_bytes = NEW.tamano_original_bytes
          AND v.localizador_objeto = NEW.localizador_origen) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'El elemento no corresponde a un original del punto de recuperación.';
      END IF;
    END IF;
    IF v_estado = 'VERIFICADO' THEN
        IF EXISTS (SELECT 1 FROM unnest(ARRAY['DATOS','CONFIGURACION','IDENTIDAD','RESTRICCIONES']) t(tipo)
          WHERE NOT EXISTS (SELECT 1 FROM kvg.elemento_manifiesto m WHERE m.respaldo_id = v_id AND m.tipo = t.tipo))
          OR EXISTS (SELECT 1 FROM kvg.version_documento v WHERE v.publicado_en <= v_punto
             AND NOT EXISTS (SELECT 1 FROM kvg.elemento_manifiesto m WHERE m.respaldo_id = v_id
             AND m.tipo = 'OBJETO' AND m.version_origen_id = v.version_id
             AND m.sha256_original = v.sha256 AND m.tamano_original_bytes = v.tamano_bytes)) THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'El manifiesto no cubre los componentes y originales del punto de recuperación.';
        END IF;
    END IF;
    RETURN NEW;
END;
$func$;

CREATE FUNCTION kvg_privado.auditar_mutacion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE v_json jsonb; v_id uuid;
BEGIN
    v_json := to_jsonb(NEW);
    IF TG_ARGV[0] <> '' THEN v_id := (v_json->>TG_ARGV[0])::uuid; END IF;
    PERFORM kvg_privado.auditar(TG_TABLE_NAME || '.' || lower(TG_OP),upper(TG_TABLE_NAME),v_id,'EXITO',
        jsonb_build_object('tabla',TG_TABLE_NAME,'revision',v_json->'revision'));
    RETURN NULL;
END;
$func$;

CREATE FUNCTION kvg_privado.registrar_revocacion_concesion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
BEGIN
    IF OLD.revocado_en IS NULL AND NEW.revocado_en IS NOT NULL THEN
        PERFORM kvg_privado.restringir('REVOCAR_CONCESION','CONCESION',NEW.concesion_id::text,NEW.revocado_por,
           jsonb_build_object('expediente_id',NEW.expediente_id,'usuario_id',NEW.usuario_id));
    END IF;
    RETURN NULL;
END;
$func$;


-- 10. Operaciones de clientes y expedientes (CU001 a CU007, CU015, CU017, CU025 y CU031).
CREATE FUNCTION kvg_privado.validar_campos(p_datos jsonb,p_permitidos text[])
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $func$
BEGIN
    IF p_datos IS NULL OR jsonb_typeof(p_datos) <> 'object' OR octet_length(p_datos::text) > 65536 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'La entrada debe ser un objeto JSON acotado.';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_datos) k WHERE NOT k = ANY(p_permitidos)) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'La entrada contiene campos no admitidos.';
    END IF;
END;
$func$;

CREATE FUNCTION kvg_privado.medios_cliente(p_cliente uuid,p_datos jsonb,p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE v_item jsonb;
BEGIN
    IF p_datos ? 'identificaciones' THEN
        IF jsonb_typeof(p_datos->'identificaciones') <> 'array' OR jsonb_array_length(p_datos->'identificaciones') > 20 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Colección de identificaciones inválida.';
        END IF;
        UPDATE kvg.identificacion_cliente SET retirado_en = clock_timestamp()
          WHERE cliente_id = p_cliente AND retirado_en IS NULL;
        FOR v_item IN SELECT value FROM jsonb_array_elements(p_datos->'identificaciones') LOOP
            PERFORM kvg_privado.validar_campos(v_item,ARRAY['tipo','valor']);
            INSERT INTO kvg.identificacion_cliente (cliente_id,tipo_identificacion_codigo,valor_original,
                valor_normalizado,regla_revision,registrado_por)
            VALUES (p_cliente,v_item->>'tipo',v_item->>'valor',v_item->>'valor',1,p_actor);
        END LOOP;
    END IF;
    IF p_datos ? 'contactos' THEN
        IF jsonb_typeof(p_datos->'contactos') <> 'array' OR jsonb_array_length(p_datos->'contactos') > 20 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Colección de contactos inválida.';
        END IF;
        UPDATE kvg.contacto_cliente SET activo = false,preferente = false WHERE cliente_id = p_cliente AND activo;
        FOR v_item IN SELECT value FROM jsonb_array_elements(p_datos->'contactos') LOOP
            PERFORM kvg_privado.validar_campos(v_item,ARRAY['tipo','valor','etiqueta','preferente']);
            INSERT INTO kvg.contacto_cliente (cliente_id,tipo,valor,etiqueta,preferente,registrado_por)
            VALUES (p_cliente,v_item->>'tipo',CASE WHEN v_item->>'tipo' = 'CORREO'
                    THEN lower(btrim(v_item->>'valor')) ELSE btrim(v_item->>'valor') END,
                v_item->>'etiqueta',coalesce((v_item->>'preferente')::boolean,false),p_actor);
        END LOOP;
    END IF;
END;
$func$;

CREATE FUNCTION kvg_privado.clientes(p_operacion text,p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE v_actor uuid := kvg_privado.usuario_actual(); v_id uuid; v_cliente kvg.cliente; v_salida jsonb;
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
        PERFORM kvg_privado.exigir(kvg_privado.puede_cliente('cliente.actualizar',v_id));
        SELECT * INTO v_cliente FROM kvg.cliente WHERE cliente_id = v_id FOR UPDATE;
        PERFORM kvg_privado.exigir_revision(v_cliente.revision,(p_datos->>'revision')::integer);
        UPDATE kvg.cliente SET nombre_presentacion = coalesce(p_datos->>'nombre',nombre_presentacion),
            actualizado_en = clock_timestamp() WHERE cliente_id = v_id RETURNING * INTO v_cliente;
        PERFORM kvg_privado.medios_cliente(v_id,p_datos,v_actor);
        RETURN to_jsonb(v_cliente);
    ELSIF p_operacion = 'cliente.consultar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['cliente_id']);
        v_id := (p_datos->>'cliente_id')::uuid;
        PERFORM kvg_privado.exigir(kvg_privado.puede_cliente('cliente.consultar',v_id));
        SELECT to_jsonb(c) || jsonb_build_object(
          'contactos',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM kvg.contacto_cliente x WHERE x.cliente_id = c.cliente_id AND x.activo),'[]'),
          'identificaciones',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM kvg.identificacion_cliente x WHERE x.cliente_id = c.cliente_id AND x.retirado_en IS NULL),'[]'))
          INTO v_salida FROM kvg.cliente c WHERE c.cliente_id = v_id;
        PERFORM kvg_privado.auditar('CLIENTE_CONSULTAR','CLIENTE',v_id);
        RETURN v_salida;
    ELSIF p_operacion = 'cliente.buscar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['texto','limite','desplazamiento']);
        SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO v_salida FROM
          (SELECT c.* FROM kvg.cliente c WHERE kvg_privado.puede_cliente('cliente.consultar',c.cliente_id)
             AND (p_datos->>'texto' IS NULL OR c.nombre_presentacion ILIKE '%' || left(p_datos->>'texto',200) || '%')
           ORDER BY c.nombre_presentacion,c.cliente_id LIMIT least(greatest(coalesce((p_datos->>'limite')::integer,25),1),100)
           OFFSET greatest(coalesce((p_datos->>'desplazamiento')::integer,0),0)) q;
        RETURN v_salida;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Operación de cliente no admitida.';
END;
$func$;

CREATE FUNCTION kvg_privado.expedientes(p_operacion text,p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE v_actor uuid := kvg_privado.usuario_actual(); v_id uuid; v_cliente uuid; v_exp kvg.expediente;
    v_usuario uuid; v_old kvg.asignacion_expediente; v_asignacion uuid; v_permiso text; v_destino text;
    v_aprobador uuid; v_concesion uuid; v_salida jsonb; v_avance uuid; v_item jsonb; v_instante timestamptz;
BEGIN
    IF p_operacion = 'expediente.crear' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['cliente_id','descripcion','numero_externo','autoridad_externa']);
        v_cliente := (p_datos->>'cliente_id')::uuid;
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('expediente.crear')
                                 AND kvg_privado.puede_cliente('cliente.consultar',v_cliente));
        SELECT rp.aprobado_por INTO v_aprobador FROM kvg.rol_permiso rp
          JOIN kvg.permiso p ON p.permiso_id = rp.permiso_id JOIN kvg.usuario_rol ur ON ur.rol_id = rp.rol_id
          WHERE ur.usuario_id = v_actor AND p.codigo = 'expediente.crear' AND rp.activo
          AND rp.contexto = 'GLOBAL_OPERATIVO' AND ur.finaliza_en IS NULL LIMIT 1;
        PERFORM kvg_privado.exigir(kvg_privado.rol_vigente(v_aprobador,'ABOGADO'));
        INSERT INTO kvg.expediente (folio_interno,cliente_principal_id,descripcion,numero_externo,autoridad_externa,creado_por)
        VALUES ('KVG-' || to_char(clock_timestamp() AT TIME ZONE 'America/Merida','YYYY') || '-' ||
            lpad(nextval('kvg.folio_expediente_seq'::regclass)::text,10,'0'),v_cliente,p_datos->>'descripcion',
            p_datos->>'numero_externo',p_datos->>'autoridad_externa',v_actor) RETURNING * INTO v_exp;
        INSERT INTO kvg.historial_estado_expediente (expediente_id,estado_destino_codigo,motivo,registrado_por,revision_resultante)
          VALUES (v_exp.expediente_id,'NUEVO','Alta del expediente.',v_actor,1);
        INSERT INTO kvg.concesion_acceso (expediente_id,usuario_id,otorgado_por,aprobado_por,motivo,referencia_autorizacion)
          VALUES (v_exp.expediente_id,v_actor,v_actor,v_aprobador,'Organización inicial del expediente.',
            'Delegación de apertura registrada en la matriz de capacidades.') RETURNING concesion_id INTO v_concesion;
        INSERT INTO kvg.concesion_permiso (concesion_id,permiso_id)
          SELECT DISTINCT v_concesion,rp.permiso_id FROM kvg.usuario_rol ur JOIN kvg.rol_permiso rp ON rp.rol_id = ur.rol_id
          JOIN kvg.rol r ON r.rol_id = ur.rol_id
          WHERE ur.usuario_id = v_actor AND ur.finaliza_en IS NULL AND r.codigo = 'SECRETARIA'
             AND rp.contexto = 'EXPLICITO' AND rp.activo;
        RETURN to_jsonb(v_exp);
    ELSIF p_operacion IN ('expediente.consultar','expediente.metadatos') THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['expediente_id']);
        v_id := (p_datos->>'expediente_id')::uuid;
        IF p_operacion = 'expediente.metadatos' THEN
            PERFORM kvg_privado.exigir(kvg_privado.puede_global('expediente.metadatos'));
            SELECT jsonb_build_object('expediente_id',expediente_id,'folio_interno',folio_interno,
                    'estado',estado_expediente_codigo,'revision',revision) INTO v_salida
                FROM kvg.expediente WHERE expediente_id = v_id;
        ELSE
            PERFORM kvg_privado.exigir(kvg_privado.puede_expediente('expediente.consultar',v_id));
            SELECT to_jsonb(e) || jsonb_build_object(
              'asignaciones',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM kvg.asignacion_expediente a WHERE a.expediente_id = e.expediente_id),'[]'),
              'avances',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.registrado_en DESC) FROM kvg.avance_expediente a WHERE a.expediente_id = e.expediente_id),'[]'),
              'historial_estados',coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.revision_resultante) FROM kvg.historial_estado_expediente h WHERE h.expediente_id = e.expediente_id),'[]'))
             INTO v_salida FROM kvg.expediente e WHERE e.expediente_id = v_id;
            PERFORM kvg_privado.auditar('EXPEDIENTE_CONSULTAR','EXPEDIENTE',v_id);
        END IF;
        RETURN coalesce(v_salida,'{}');
    ELSIF p_operacion IN ('expediente.buscar','expediente.asignados') THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['texto','estado','limite','desplazamiento']);
        IF p_operacion = 'expediente.asignados' THEN
            PERFORM kvg_privado.exigir(kvg_privado.rol_vigente(v_actor,'ABOGADO'));
        END IF;
        SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO v_salida FROM
          (SELECT e.* FROM kvg.expediente e WHERE kvg_privado.puede_expediente('expediente.consultar',e.expediente_id)
            AND (p_operacion <> 'expediente.asignados' OR EXISTS (SELECT 1 FROM kvg.asignacion_expediente a
                WHERE a.expediente_id = e.expediente_id AND a.abogado_id = v_actor AND a.finaliza_en IS NULL))
            AND (p_datos->>'estado' IS NULL OR e.estado_expediente_codigo = p_datos->>'estado')
            AND (p_datos->>'texto' IS NULL OR e.folio_interno ILIKE '%' || left(p_datos->>'texto',100) || '%'
              OR to_tsvector('spanish'::regconfig,e.descripcion::text) @@ plainto_tsquery('spanish'::regconfig,left(p_datos->>'texto',200)))
           ORDER BY e.creado_en DESC,e.expediente_id LIMIT least(greatest(coalesce((p_datos->>'limite')::integer,25),1),100)
           OFFSET greatest(coalesce((p_datos->>'desplazamiento')::integer,0),0)) q;
        RETURN v_salida;
    END IF;

    v_id := (p_datos->>'expediente_id')::uuid;
    IF p_operacion IN ('expediente.asignar','expediente.reasignar','expediente.cambiar_estado') THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('kvg:seguridad',0));
    END IF;
    IF p_operacion = 'expediente.actualizar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['expediente_id','revision','cliente_id','descripcion','numero_externo','autoridad_externa']);
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
    ELSIF p_operacion IN ('expediente.asignar','expediente.reasignar') THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['expediente_id','revision','abogado_id','funcion','motivo']);
        PERFORM kvg_privado.exigir(CASE WHEN p_operacion = 'expediente.reasignar'
            THEN kvg_privado.puede_global('expediente.reasignar') ELSE kvg_privado.puede_expediente('expediente.asignar',v_id) END);
        PERFORM kvg_privado.exigir_editable(v_id);
        SELECT * INTO v_exp FROM kvg.expediente WHERE expediente_id = v_id FOR UPDATE;
        PERFORM kvg_privado.exigir_revision(v_exp.revision,(p_datos->>'revision')::integer);
        v_usuario := (p_datos->>'abogado_id')::uuid;
        PERFORM 1 FROM kvg.usuario WHERE usuario_id = v_usuario FOR UPDATE;
        PERFORM kvg_privado.exigir(kvg_privado.rol_vigente(v_usuario,'ABOGADO'));
        v_instante := clock_timestamp();
        IF p_operacion = 'expediente.reasignar' THEN
            PERFORM kvg_privado.exigir(v_usuario <> v_actor);
            SELECT * INTO v_old FROM kvg.asignacion_expediente WHERE expediente_id = v_id
                AND funcion = 'PRINCIPAL' AND finaliza_en IS NULL FOR UPDATE;
            IF v_old.asignacion_id IS NULL OR v_old.abogado_id = v_usuario THEN
                RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'La reasignación requiere un principal distinto.';
            END IF;
            UPDATE kvg.asignacion_expediente SET finaliza_en = v_instante,cerrado_por = v_actor,motivo_cierre = p_datos->>'motivo'
                WHERE asignacion_id = v_old.asignacion_id;
            PERFORM kvg_privado.restringir('CERRAR_ASIGNACION','ASIGNACION',v_old.asignacion_id::text,v_actor,
                 jsonb_build_object('expediente_id',v_id,'usuario_id',v_old.abogado_id));
            UPDATE kvg.concesion_acceso SET revocado_en = v_instante,revocado_por = v_actor,motivo_revocacion = p_datos->>'motivo'
                 WHERE expediente_id = v_id AND usuario_id = v_old.abogado_id AND revocado_en IS NULL;
        END IF;
        INSERT INTO kvg.asignacion_expediente (expediente_id,abogado_id,funcion,inicia_en,asignado_por,motivo_alta)
          VALUES (v_id,v_usuario,CASE WHEN p_operacion = 'expediente.reasignar' THEN 'PRINCIPAL' ELSE p_datos->>'funcion' END,
                  v_instante,v_actor,p_datos->>'motivo') RETURNING asignacion_id INTO v_asignacion;
        UPDATE kvg.expediente SET actualizado_en = clock_timestamp() WHERE expediente_id = v_id RETURNING * INTO v_exp;
        UPDATE kvg.usuario SET revision_autorizacion = revision_autorizacion + 1
          WHERE usuario_id IN (v_usuario,v_old.abogado_id);
        RETURN jsonb_build_object('asignacion_id',v_asignacion,'expediente_id',v_id,'revision',v_exp.revision);
    ELSIF p_operacion = 'expediente.cambiar_estado' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['expediente_id','revision','estado','motivo','referencia_autorizacion']);
        PERFORM kvg_privado.exigir(kvg_privado.puede_expediente('expediente.consultar',v_id));
        SELECT * INTO v_exp FROM kvg.expediente WHERE expediente_id = v_id FOR UPDATE;
        PERFORM kvg_privado.exigir_revision(v_exp.revision,(p_datos->>'revision')::integer);
        v_destino := p_datos->>'estado';
        v_permiso := CASE
          WHEN v_exp.estado_expediente_codigo = 'NUEVO' AND v_destino = 'EN_PROCESO' THEN 'expediente.iniciar'
          WHEN v_exp.estado_expediente_codigo = 'EN_PROCESO' AND v_destino = 'PENDIENTE' THEN 'expediente.suspender'
          WHEN v_exp.estado_expediente_codigo = 'PENDIENTE' AND v_destino = 'EN_PROCESO' THEN 'expediente.reanudar'
          WHEN v_exp.estado_expediente_codigo IN ('EN_PROCESO','PENDIENTE') AND v_destino = 'CONCLUIDO' THEN 'expediente.concluir'
          WHEN v_exp.estado_expediente_codigo = 'CONCLUIDO' AND v_destino = 'ARCHIVADO' THEN 'expediente.archivar'
          WHEN v_exp.estado_expediente_codigo IN ('CONCLUIDO','ARCHIVADO') AND v_destino = 'EN_PROCESO' THEN 'expediente.reabrir' END;
        PERFORM kvg_privado.exigir(v_permiso IS NOT NULL AND kvg_privado.puede_expediente(v_permiso,v_id));
        IF v_permiso IN ('expediente.concluir','expediente.reabrir') THEN
            PERFORM kvg_privado.exigir(kvg_privado.rol_vigente(v_actor,'ABOGADO') AND p_datos->>'referencia_autorizacion' IS NOT NULL);
        END IF;
        v_destino := p_datos->>'estado';
        UPDATE kvg.expediente SET estado_expediente_codigo = v_destino WHERE expediente_id = v_id RETURNING revision INTO v_exp.revision;
        INSERT INTO kvg.historial_estado_expediente (expediente_id,estado_origen_codigo,estado_destino_codigo,
          motivo,registrado_por,decidido_por,referencia_autorizacion,revision_resultante)
        VALUES (v_id,v_exp.estado_expediente_codigo,v_destino,p_datos->>'motivo',v_actor,
          CASE WHEN v_permiso IN ('expediente.concluir','expediente.reabrir') THEN v_actor END,
          p_datos->>'referencia_autorizacion',v_exp.revision);
        RETURN jsonb_build_object('expediente_id',v_id,'estado',v_destino,'revision',v_exp.revision);
    ELSIF p_operacion = 'expediente.avanzar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['expediente_id','descripcion','corrige_avance_id','fecha_hecho','procedencia','versiones']);
        PERFORM kvg_privado.exigir(kvg_privado.puede_expediente('expediente.avanzar',v_id));
        PERFORM kvg_privado.exigir_editable(v_id);
        INSERT INTO kvg.avance_expediente (expediente_id,descripcion,autor_id,corrige_avance_id,fecha_hecho,procedencia)
          VALUES (v_id,p_datos->>'descripcion',v_actor,(p_datos->>'corrige_avance_id')::uuid,
                  (p_datos->>'fecha_hecho')::date,p_datos->>'procedencia') RETURNING avance_id INTO v_avance;
        IF p_datos ? 'versiones' THEN
            IF jsonb_typeof(p_datos->'versiones') <> 'array' OR jsonb_array_length(p_datos->'versiones') > 50 THEN
                RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Colección de referencias inválida.';
            END IF;
            FOR v_item IN SELECT value FROM jsonb_array_elements(p_datos->'versiones') LOOP
                PERFORM kvg_privado.validar_campos(v_item,ARRAY['version_id','nota']);
                PERFORM kvg_privado.exigir(kvg_privado.puede_version('documento.consultar',(v_item->>'version_id')::uuid));
                INSERT INTO kvg.avance_version VALUES (v_avance,(v_item->>'version_id')::uuid,v_item->>'nota');
            END LOOP;
        END IF;
        RETURN jsonb_build_object('avance_id',v_avance);
    END IF;
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Operación de expediente no admitida.';
END;
$func$;


-- 11. Gestión documental, versiones y revisión (CU008 a CU014, CU016 y CU026 a CU029).
CREATE FUNCTION kvg_privado.documentos(p_operacion text,p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE v_actor uuid := kvg_privado.usuario_actual(); v_id uuid; v_exp uuid; v_doc kvg.documento;
    v_version kvg.version_documento; v_carga kvg.carga_archivo; v_trabajo uuid; v_categoria uuid;
    v_salida jsonb; v_permiso text; v_estado text; v_revision integer; v_juridica uuid; v_evento uuid;
BEGIN
    IF p_operacion = 'documento.cargar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['documento_id','revision','expediente_id','nombre','categoria_id',
            'nombre_original','clave_idempotencia','motivo']);
        PERFORM kvg_privado.exigir(p_datos->>'clave_idempotencia' IS NOT NULL);
        PERFORM pg_advisory_xact_lock(hashtextextended('carga:' || (p_datos->>'clave_idempotencia'),0));
        SELECT * INTO v_carga FROM kvg.carga_archivo WHERE clave_idempotencia = p_datos->>'clave_idempotencia';
        IF FOUND THEN
            PERFORM kvg_privado.exigir(v_carga.solicitado_por = v_actor AND
              kvg_privado.puede_documento('documento.cargar',v_carga.documento_id)
              AND v_carga.nombre_original = p_datos->>'nombre_original' AND v_carga.motivo_version = p_datos->>'motivo'
              AND (p_datos->>'documento_id' IS NULL OR v_carga.documento_id = (p_datos->>'documento_id')::uuid)
              AND (p_datos->>'expediente_id' IS NULL OR v_carga.expediente_destino_id = (p_datos->>'expediente_id')::uuid)
              AND (p_datos->>'documento_id' IS NOT NULL OR EXISTS (SELECT 1 FROM kvg.documento d
                 WHERE d.documento_id = v_carga.documento_id AND d.nombre = p_datos->>'nombre'
                  AND d.categoria_id = (p_datos->>'categoria_id')::uuid)));
            RETURN jsonb_build_object('carga_id',v_carga.carga_id,'documento_id',v_carga.documento_id,'estado',v_carga.estado_tecnico);
        END IF;
        v_id := (p_datos->>'documento_id')::uuid;
        IF v_id IS NULL THEN
            v_exp := (p_datos->>'expediente_id')::uuid;
            v_categoria := (p_datos->>'categoria_id')::uuid;
            PERFORM kvg_privado.exigir(kvg_privado.puede_expediente('documento.cargar',v_exp));
            PERFORM kvg_privado.exigir_editable(v_exp);
            PERFORM kvg_privado.exigir(EXISTS (SELECT 1 FROM kvg.categoria_documento WHERE categoria_id = v_categoria AND activo));
            INSERT INTO kvg.documento (expediente_id,nombre,categoria_id,creado_por)
              VALUES (v_exp,p_datos->>'nombre',v_categoria,v_actor) RETURNING * INTO v_doc;
            INSERT INTO kvg.historial_asociacion_documento
              (documento_id,expediente_destino_id,registrado_por,motivo,revision_resultante)
              VALUES (v_doc.documento_id,v_exp,v_actor,'Asociación inicial.',1);
        ELSE
            PERFORM kvg_privado.exigir(kvg_privado.puede_documento('documento.actualizar',v_id));
            SELECT * INTO v_doc FROM kvg.documento WHERE documento_id = v_id FOR UPDATE;
            PERFORM kvg_privado.exigir_editable(v_doc.expediente_id);
            PERFORM kvg_privado.exigir_revision(v_doc.revision,(p_datos->>'revision')::integer);
        END IF;
        INSERT INTO kvg.carga_archivo (documento_id,expediente_destino_id,solicitado_por,revision_documento_base,
          clave_idempotencia,nombre_original,motivo_version)
        VALUES (v_doc.documento_id,v_doc.expediente_id,v_actor,v_doc.revision,p_datos->>'clave_idempotencia',
          p_datos->>'nombre_original',p_datos->>'motivo') RETURNING * INTO v_carga;
        UPDATE kvg.carga_archivo SET localizador_cuarentena = 'cargas/' || v_carga.carga_id::text || '/original'
          WHERE carga_id = v_carga.carga_id;
        INSERT INTO kvg.trabajo_operativo (tipo,objetivo_tipo,objetivo_id,clave_idempotencia,solicitado_por,correlacion_id)
          VALUES ('VERIFICAR_CARGA','CARGA',v_carga.carga_id,'verificar:' || v_carga.carga_id::text,v_actor,gen_random_uuid())
          RETURNING trabajo_id INTO v_trabajo;
        RETURN jsonb_build_object('documento_id',v_doc.documento_id,'revision',v_doc.revision,
          'carga_id',v_carga.carga_id,'trabajo_id',v_trabajo,'estado','RECIBIENDO');
    ELSIF p_operacion = 'documento.buscar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['expediente_id','categoria_id','texto','estado','limite','desplazamiento']);
        SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO v_salida FROM
          (SELECT d.documento_id,d.expediente_id,d.nombre,d.categoria_id,d.version_vigente_id,d.revision,
               v.estado_documento_codigo,v.numero_version,d.creado_en FROM kvg.documento d
           LEFT JOIN kvg.version_documento v ON v.version_id = d.version_vigente_id
           WHERE kvg_privado.puede_documento('documento.consultar',d.documento_id)
             AND (p_datos->>'expediente_id' IS NULL OR d.expediente_id = (p_datos->>'expediente_id')::uuid)
             AND (p_datos->>'categoria_id' IS NULL OR d.categoria_id = (p_datos->>'categoria_id')::uuid)
             AND (p_datos->>'estado' IS NULL OR v.estado_documento_codigo = p_datos->>'estado')
             AND (p_datos->>'texto' IS NULL OR to_tsvector('spanish'::regconfig,d.nombre::text)
                  @@ plainto_tsquery('spanish'::regconfig,left(p_datos->>'texto',200)))
           ORDER BY d.creado_en DESC,d.documento_id LIMIT least(greatest(coalesce((p_datos->>'limite')::integer,25),1),100)
           OFFSET greatest(coalesce((p_datos->>'desplazamiento')::integer,0),0)) q;
        RETURN v_salida;
    ELSIF p_operacion = 'documento.descargar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['version_id']);
        v_id := (p_datos->>'version_id')::uuid;
        PERFORM kvg_privado.exigir(kvg_privado.puede_version('documento.descargar',v_id));
        SELECT * INTO v_version FROM kvg.version_documento WHERE version_id = v_id;
        v_evento := kvg_privado.auditar('AUTORIZACION_DESCARGA','VERSION',v_id);
        RETURN jsonb_build_object('version_id',v_id,'autorizacion_id',v_evento,'vigencia_segundos',60,
              'sha256',v_version.sha256,'tamano_bytes',v_version.tamano_bytes);
    END IF;
    v_id := (p_datos->>'documento_id')::uuid;
    IF p_operacion = 'documento.metadatos' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['documento_id']);
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('documento.metadatos'));
        SELECT jsonb_build_object('documento_id',documento_id,'expediente_id',expediente_id,
            'revision',revision,'retirado',retirado_en IS NOT NULL,'version_vigente_id',version_vigente_id)
          INTO v_salida FROM kvg.documento WHERE documento_id = v_id;
        RETURN coalesce(v_salida,'{}');
    ELSIF p_operacion IN ('documento.consultar','documento.versiones') THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['documento_id','limite','desplazamiento']);
        PERFORM kvg_privado.exigir(kvg_privado.puede_documento(p_operacion,v_id));
        IF p_operacion = 'documento.versiones' THEN
            SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO v_salida FROM
               (SELECT v.version_id,v.documento_id,v.numero_version,v.sha256,v.tamano_bytes,v.formato,
                 v.estado_documento_codigo,v.publicado_en,v.fecha_origen,v.procedencia,v.revision
                FROM kvg.version_documento v WHERE v.documento_id = v_id
                ORDER BY v.numero_version DESC LIMIT least(greatest(coalesce((p_datos->>'limite')::integer,25),1),100)
                OFFSET greatest(coalesce((p_datos->>'desplazamiento')::integer,0),0)) q;
        ELSE
            SELECT to_jsonb(d) || jsonb_build_object('version',
              (SELECT to_jsonb(v) - 'localizador_objeto' FROM kvg.version_documento v WHERE v.version_id = d.version_vigente_id),
              'revisiones',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM kvg.revision_documento r
                       WHERE r.version_id = d.version_vigente_id),'[]'))
              INTO v_salida FROM kvg.documento d WHERE d.documento_id = v_id;
        END IF;
        PERFORM kvg_privado.auditar(replace(upper(p_operacion),'.','_'),'DOCUMENTO',v_id);
        RETURN v_salida;
    ELSIF p_operacion = 'documento.recuperar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['documento_id','revision','motivo','clave_idempotencia']);
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('documento.recuperar'));
        SELECT * INTO v_doc FROM kvg.documento WHERE documento_id = v_id FOR UPDATE;
        PERFORM kvg_privado.exigir_revision(v_doc.revision,(p_datos->>'revision')::integer);
        PERFORM kvg_privado.exigir(v_doc.retirado_en IS NOT NULL AND NOT EXISTS
           (SELECT 1 FROM kvg.expediente e WHERE e.expediente_id = v_doc.expediente_id
             AND kvg_privado.medida_impide(e.cliente_principal_id,e.expediente_id,v_id,'RECUPERAR')));
        PERFORM kvg_privado.exigir(length(btrim(p_datos->>'motivo')) BETWEEN 1 AND 2000);
        INSERT INTO kvg.trabajo_operativo (tipo,objetivo_tipo,objetivo_id,clave_idempotencia,solicitado_por,correlacion_id,detalle_solicitud)
         VALUES ('VERIFICAR_RECUPERACION','DOCUMENTO',v_id,p_datos->>'clave_idempotencia',v_actor,gen_random_uuid(),
           jsonb_build_object('revision',v_doc.revision,'motivo',p_datos->>'motivo'))
         ON CONFLICT (clave_idempotencia) DO NOTHING RETURNING trabajo_id INTO v_trabajo;
        IF v_trabajo IS NULL THEN
            SELECT trabajo_id INTO v_trabajo FROM kvg.trabajo_operativo WHERE clave_idempotencia = p_datos->>'clave_idempotencia'
             AND tipo = 'VERIFICAR_RECUPERACION' AND objetivo_id = v_id AND solicitado_por = v_actor;
            PERFORM kvg_privado.exigir(v_trabajo IS NOT NULL);
        END IF;
        PERFORM kvg_privado.auditar('DOCUMENTO_SOLICITAR_RECUPERACION','DOCUMENTO',v_id,'RECIBIDO');
        RETURN jsonb_build_object('trabajo_id',v_trabajo);
    END IF;

    v_permiso := CASE p_operacion WHEN 'documento.clasificar' THEN 'documento.clasificar'
       WHEN 'documento.asociar' THEN 'documento.asociar' WHEN 'documento.actualizar' THEN 'documento.actualizar'
       WHEN 'documento.revisar' THEN 'documento.revisar' WHEN 'documento.retirar' THEN 'documento.retirar'
       WHEN 'documento.cambiar_estado' THEN 'documento.consultar' END;
    PERFORM kvg_privado.exigir(v_permiso IS NOT NULL AND kvg_privado.puede_documento(v_permiso,v_id));
    SELECT * INTO v_doc FROM kvg.documento WHERE documento_id = v_id FOR UPDATE;
    PERFORM kvg_privado.exigir_editable(v_doc.expediente_id);
    IF v_doc.version_vigente_id IS NOT NULL THEN
        SELECT * INTO v_version FROM kvg.version_documento WHERE version_id = v_doc.version_vigente_id FOR UPDATE;
    END IF;
    IF p_operacion IN ('documento.actualizar','documento.clasificar','documento.asociar') THEN
        PERFORM kvg_privado.exigir_revision(v_doc.revision,(p_datos->>'revision')::integer);
        IF p_operacion <> 'documento.clasificar' AND v_doc.version_vigente_id IS NOT NULL
           AND v_version.estado_documento_codigo NOT IN ('RECIBIDO','EN_REVISION') THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'La versión no admite esta edición ordinaria.';
        END IF;
        IF p_operacion = 'documento.asociar' THEN
            PERFORM kvg_privado.validar_campos(p_datos,ARRAY['documento_id','revision','expediente_destino_id','motivo']);
            v_exp := (p_datos->>'expediente_destino_id')::uuid;
            PERFORM kvg_privado.exigir(kvg_privado.puede_expediente('documento.asociar',v_exp) AND v_exp <> v_doc.expediente_id);
            PERFORM kvg_privado.exigir_editable(v_exp);
            UPDATE kvg.documento SET expediente_id = v_exp WHERE documento_id = v_id RETURNING revision INTO v_revision;
            INSERT INTO kvg.historial_asociacion_documento (documento_id,expediente_origen_id,expediente_destino_id,
                 version_id,registrado_por,motivo,revision_resultante)
             VALUES (v_id,v_doc.expediente_id,v_exp,v_doc.version_vigente_id,v_actor,p_datos->>'motivo',v_revision);
        ELSE
            PERFORM kvg_privado.validar_campos(p_datos,ARRAY['documento_id','revision','nombre','categoria_id']);
            v_categoria := coalesce((p_datos->>'categoria_id')::uuid,v_doc.categoria_id);
            PERFORM kvg_privado.exigir(EXISTS (SELECT 1 FROM kvg.categoria_documento WHERE categoria_id = v_categoria AND activo));
            UPDATE kvg.documento SET nombre = CASE WHEN p_operacion = 'documento.actualizar' THEN coalesce(p_datos->>'nombre',nombre)
                ELSE nombre END,categoria_id = v_categoria WHERE documento_id = v_id RETURNING revision INTO v_revision;
        END IF;
        RETURN jsonb_build_object('documento_id',v_id,'revision',v_revision);
    ELSIF p_operacion = 'documento.revisar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['documento_id','version_id','observaciones','resultado','corrige_revision_id']);
        PERFORM kvg_privado.exigir(kvg_privado.rol_vigente(v_actor,'ABOGADO') AND
            kvg_privado.puede_version('documento.revisar',(p_datos->>'version_id')::uuid));
        PERFORM kvg_privado.exigir(EXISTS (SELECT 1 FROM kvg.version_documento
          WHERE version_id = (p_datos->>'version_id')::uuid AND documento_id = v_id));
        INSERT INTO kvg.revision_documento (version_id,revisor_id,observaciones,resultado,corrige_revision_id)
          VALUES ((p_datos->>'version_id')::uuid,v_actor,p_datos->>'observaciones',p_datos->>'resultado',
                  (p_datos->>'corrige_revision_id')::uuid) RETURNING revision_juridica_id INTO v_juridica;
        RETURN jsonb_build_object('revision_juridica_id',v_juridica,'version_vigente_cambio',
                      (p_datos->>'version_id')::uuid IS DISTINCT FROM v_doc.version_vigente_id);
    ELSIF p_operacion = 'documento.cambiar_estado' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['documento_id','version_id','revision','estado','motivo','revision_juridica_id']);
        PERFORM kvg_privado.exigir((p_datos->>'version_id')::uuid = v_doc.version_vigente_id);
        PERFORM kvg_privado.exigir_revision(v_version.revision,(p_datos->>'revision')::integer);
        v_estado := p_datos->>'estado';
        v_permiso := CASE
          WHEN v_version.estado_documento_codigo = 'RECIBIDO' AND v_estado = 'EN_REVISION' THEN 'documento.iniciar_revision'
          WHEN v_version.estado_documento_codigo = 'EN_REVISION' AND v_estado = 'RECIBIDO' THEN 'documento.corregir'
          WHEN v_version.estado_documento_codigo = 'EN_REVISION' AND v_estado = 'VALIDADO' THEN 'documento.validar'
          WHEN v_version.estado_documento_codigo = 'VALIDADO' AND v_estado = 'ARCHIVADO' THEN 'documento.archivar'
          WHEN v_version.estado_documento_codigo = 'ARCHIVADO' AND v_estado = 'VALIDADO' THEN 'documento.reactivar' END;
        PERFORM kvg_privado.exigir(v_permiso IS NOT NULL AND kvg_privado.puede_documento(v_permiso,v_id));
        IF v_permiso IN ('documento.validar','documento.reactivar') THEN
            PERFORM kvg_privado.exigir(kvg_privado.rol_vigente(v_actor,'ABOGADO'));
        END IF;
        UPDATE kvg.version_documento SET estado_documento_codigo = v_estado
          WHERE version_id = v_version.version_id RETURNING revision INTO v_revision;
        INSERT INTO kvg.historial_estado_documento (version_id,estado_origen_codigo,estado_destino_codigo,
            revision_juridica_id,responsable_usuario_id,motivo,revision_resultante)
        VALUES (v_version.version_id,v_version.estado_documento_codigo,v_estado,(p_datos->>'revision_juridica_id')::uuid,
            v_actor,p_datos->>'motivo',v_revision);
        RETURN jsonb_build_object('version_id',v_version.version_id,'estado',v_estado,'revision',v_revision);
    ELSIF p_operacion = 'documento.retirar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['documento_id','revision','motivo']);
        PERFORM kvg_privado.exigir_revision(v_doc.revision,(p_datos->>'revision')::integer);
        UPDATE kvg.documento SET retirado_en = clock_timestamp() WHERE documento_id = v_id RETURNING revision INTO v_revision;
        INSERT INTO kvg.evento_retiro_documento (documento_id,operacion,registrado_por,motivo,revision_resultante)
           VALUES (v_id,'RETIRO',v_actor,p_datos->>'motivo',v_revision);
        PERFORM kvg_privado.restringir('RETIRAR_DOCUMENTO','DOCUMENTO',v_id::text,v_actor);
        RETURN jsonb_build_object('documento_id',v_id,'revision',v_revision);
    END IF;
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Operación documental no admitida.';
END;
$func$;


-- 12. Administración de cuentas, capacidades, conservación y parámetros (CU018 a CU021).
CREATE FUNCTION kvg_privado.administracion(p_operacion text,p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE v_actor uuid := kvg_privado.usuario_actual(); v_id uuid; v_usuario kvg.usuario; v_rol uuid;
    v_registro uuid; v_concesion kvg.concesion_acceso; v_item text; v_salida jsonb; v_parametro kvg.parametro_sistema;
    v_medida kvg.medida_conservacion; v_expediente uuid; v_cliente uuid; v_documento uuid; v_permiso uuid;
    v_capacidad kvg.rol_permiso; v_num integer; v_revision integer; v_categoria kvg.categoria_documento; v_tipo kvg.tipo_identificacion;
BEGIN
    IF p_operacion LIKE 'usuario.%' OR p_operacion LIKE 'seguridad.%' THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('kvg:seguridad',0));
    END IF;
    IF p_operacion = 'usuario.registrar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['nombre','correo']);
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('usuario.administrar'));
        INSERT INTO kvg.usuario (nombre,correo_operativo,creado_por)
          VALUES (p_datos->>'nombre',lower(btrim(p_datos->>'correo')),v_actor) RETURNING * INTO v_usuario;
        INSERT INTO kvg.trabajo_operativo (tipo,objetivo_tipo,objetivo_id,clave_idempotencia,solicitado_por,correlacion_id)
          VALUES ('CONCILIAR_IDENTIDAD','USUARIO',v_usuario.usuario_id,'identidad:' || v_usuario.usuario_id::text,v_actor,gen_random_uuid());
        RETURN to_jsonb(v_usuario) - 'auth_usuario_id';
    ELSIF p_operacion IN ('usuario.editar','usuario.desactivar') THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['usuario_id','revision','nombre','motivo']);
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('usuario.administrar'));
        v_id := (p_datos->>'usuario_id')::uuid;
        SELECT * INTO v_usuario FROM kvg.usuario WHERE usuario_id = v_id FOR UPDATE;
        PERFORM kvg_privado.exigir_revision(v_usuario.revision,(p_datos->>'revision')::integer);
        IF p_operacion = 'usuario.desactivar' THEN
            UPDATE kvg.usuario SET estado_cuenta = 'DESACTIVADO',desactivado_en = clock_timestamp(),
              motivo_desactivacion = p_datos->>'motivo',revision_autorizacion = revision_autorizacion + 1
              WHERE usuario_id = v_id RETURNING * INTO v_usuario;
            UPDATE kvg.sesion_aplicacion SET revocada_en = clock_timestamp(),motivo_revocacion = 'DESACTIVACION'
              WHERE usuario_id = v_id AND revocada_en IS NULL;
            PERFORM kvg_privado.restringir('DESACTIVAR_USUARIO','USUARIO',v_id::text,v_actor);
        ELSE
            UPDATE kvg.usuario SET nombre = p_datos->>'nombre' WHERE usuario_id = v_id RETURNING * INTO v_usuario;
        END IF;
        RETURN to_jsonb(v_usuario) - 'auth_usuario_id';
    ELSIF p_operacion = 'usuario.listar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['limite','desplazamiento']);
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('usuario.administrar'));
        SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO v_salida FROM
          (SELECT usuario_id,nombre,correo_operativo,estado_cuenta,revision FROM kvg.usuario ORDER BY nombre,usuario_id
           LIMIT least(greatest(coalesce((p_datos->>'limite')::integer,25),1),100)
           OFFSET greatest(coalesce((p_datos->>'desplazamiento')::integer,0),0)) q;
        RETURN v_salida;
    ELSIF p_operacion IN ('seguridad.otorgar_rol','seguridad.revocar_rol') THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['usuario_id','rol','motivo']);
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('usuario.permisos'));
        v_id := (p_datos->>'usuario_id')::uuid;
        PERFORM kvg_privado.exigir(v_id <> v_actor);
        PERFORM 1 FROM kvg.usuario WHERE usuario_id = v_id FOR UPDATE;
        SELECT rol_id INTO v_rol FROM kvg.rol WHERE codigo = p_datos->>'rol' AND activo;
        PERFORM kvg_privado.exigir(v_rol IS NOT NULL);
        IF p_operacion = 'seguridad.otorgar_rol' THEN
            INSERT INTO kvg.usuario_rol (usuario_id,rol_id,otorgado_por,motivo_alta)
              VALUES (v_id,v_rol,v_actor,p_datos->>'motivo') RETURNING usuario_rol_id INTO v_registro;
        ELSE
            UPDATE kvg.usuario_rol SET finaliza_en = clock_timestamp(),revocado_por = v_actor,motivo_cierre = p_datos->>'motivo'
              WHERE usuario_id = v_id AND rol_id = v_rol AND finaliza_en IS NULL RETURNING usuario_rol_id INTO v_registro;
            PERFORM kvg_privado.exigir(v_registro IS NOT NULL);
            PERFORM kvg_privado.restringir('REVOCAR_ROL','USUARIO_ROL',v_registro::text,v_actor,
              jsonb_build_object('usuario_id',v_id,'rol_id',v_rol));
        END IF;
        UPDATE kvg.usuario SET revision_autorizacion = revision_autorizacion + 1 WHERE usuario_id = v_id;
        RETURN jsonb_build_object('usuario_rol_id',v_registro);
    ELSIF p_operacion = 'seguridad.matriz' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['rol','permiso','contexto','activo','revision','referencia_autorizacion']);
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('usuario.permisos') AND
            kvg_privado.rol_vigente(v_actor,'ABOGADO') AND p_datos->>'referencia_autorizacion' IS NOT NULL);
        SELECT rol_id INTO v_rol FROM kvg.rol WHERE codigo = p_datos->>'rol';
        SELECT permiso_id INTO v_permiso FROM kvg.permiso WHERE codigo = p_datos->>'permiso';
        SELECT * INTO v_capacidad FROM kvg.rol_permiso WHERE rol_id = v_rol AND permiso_id = v_permiso
             AND contexto = p_datos->>'contexto' FOR UPDATE;
        PERFORM kvg_privado.exigir_revision(v_capacidad.revision,(p_datos->>'revision')::integer);
        UPDATE kvg.rol_permiso SET activo = (p_datos->>'activo')::boolean,aprobado_por = v_actor,aprobado_en = clock_timestamp()
          WHERE rol_id = v_rol AND permiso_id = v_permiso AND contexto = p_datos->>'contexto';
        IF v_capacidad.activo IS DISTINCT FROM (p_datos->>'activo')::boolean THEN
            PERFORM kvg_privado.restringir(CASE WHEN (p_datos->>'activo')::boolean THEN 'RESTABLECER_CAPACIDAD' ELSE 'REVOCAR_CAPACIDAD' END,'ROL_PERMISO',v_rol::text || ':' || v_permiso::text || ':' || (p_datos->>'contexto'),v_actor,
               jsonb_build_object('rol_id',v_rol,'permiso_id',v_permiso,'contexto',p_datos->>'contexto'));
        END IF;
        UPDATE kvg.usuario SET revision_autorizacion = revision_autorizacion + 1 WHERE usuario_id IN
            (SELECT usuario_id FROM kvg.usuario_rol WHERE rol_id = v_rol AND finaliza_en IS NULL);
        RETURN jsonb_build_object('rol_id',v_rol,'permiso_id',v_permiso);
    ELSIF p_operacion = 'seguridad.conceder' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['expediente_id','usuario_id','permisos','motivo','referencia_autorizacion','expira_en']);
        v_expediente := (p_datos->>'expediente_id')::uuid; v_id := (p_datos->>'usuario_id')::uuid;
        PERFORM kvg_privado.exigir(v_id <> v_actor AND kvg_privado.rol_vigente(v_actor,'ABOGADO')
           AND kvg_privado.puede_expediente('expediente.conceder',v_expediente)
           AND EXISTS (SELECT 1 FROM kvg.usuario WHERE usuario_id = v_id AND estado_cuenta = 'ACTIVO'));
        IF jsonb_typeof(p_datos->'permisos') <> 'array' OR jsonb_array_length(p_datos->'permisos') NOT BETWEEN 1 AND 50 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'La concesión requiere permisos específicos.';
        END IF;
        INSERT INTO kvg.concesion_acceso (expediente_id,usuario_id,otorgado_por,aprobado_por,motivo,referencia_autorizacion,expira_en)
          VALUES (v_expediente,v_id,v_actor,v_actor,p_datos->>'motivo',p_datos->>'referencia_autorizacion',
             (p_datos->>'expira_en')::timestamptz) RETURNING * INTO v_concesion;
        FOR v_item IN SELECT DISTINCT value FROM jsonb_array_elements_text(p_datos->'permisos') LOOP
            PERFORM kvg_privado.exigir(kvg_privado.capacidad(v_id,v_item,'EXPLICITO'));
            INSERT INTO kvg.concesion_permiso SELECT v_concesion.concesion_id,permiso_id FROM kvg.permiso WHERE codigo = v_item AND activo;
        END LOOP;
        UPDATE kvg.usuario SET revision_autorizacion = revision_autorizacion + 1 WHERE usuario_id = v_id;
        RETURN jsonb_build_object('concesion_id',v_concesion.concesion_id);
    ELSIF p_operacion = 'seguridad.revocar_concesion' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['concesion_id','motivo']);
        v_id := (p_datos->>'concesion_id')::uuid;
        SELECT * INTO v_concesion FROM kvg.concesion_acceso WHERE concesion_id = v_id FOR UPDATE;
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('usuario.permisos') OR
             kvg_privado.puede_expediente('expediente.conceder',v_concesion.expediente_id));
        UPDATE kvg.concesion_acceso SET revocado_en = clock_timestamp(),revocado_por = v_actor,motivo_revocacion = p_datos->>'motivo'
          WHERE concesion_id = v_id AND revocado_en IS NULL;
        UPDATE kvg.usuario SET revision_autorizacion = revision_autorizacion + 1 WHERE usuario_id = v_concesion.usuario_id;
        RETURN jsonb_build_object('concesion_id',v_id);
    ELSIF p_operacion IN ('medida.aplicar','medida.levantar') THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['medida_id','revision','cliente_id','expediente_id','documento_id','tipo','motivo','referencia_decision']);
        PERFORM kvg_privado.exigir(kvg_privado.rol_vigente(v_actor,'ABOGADO'));
        IF p_operacion = 'medida.levantar' THEN
            SELECT * INTO v_medida FROM kvg.medida_conservacion WHERE medida_id = (p_datos->>'medida_id')::uuid FOR UPDATE;
            PERFORM kvg_privado.exigir_revision(v_medida.revision,(p_datos->>'revision')::integer);
            v_cliente := v_medida.cliente_id; v_expediente := v_medida.expediente_id; v_documento := v_medida.documento_id;
        ELSE
            v_cliente := (p_datos->>'cliente_id')::uuid; v_expediente := (p_datos->>'expediente_id')::uuid; v_documento := (p_datos->>'documento_id')::uuid;
            PERFORM kvg_privado.exigir(num_nonnulls(v_cliente,v_expediente,v_documento) = 1);
        END IF;
        IF v_documento IS NOT NULL THEN SELECT expediente_id INTO v_expediente FROM kvg.documento WHERE documento_id = v_documento; END IF;
        PERFORM kvg_privado.exigir(
          (v_expediente IS NOT NULL AND kvg_privado.alcance(v_actor,'documento.conservar',v_expediente))
          OR (v_cliente IS NOT NULL AND EXISTS (SELECT 1 FROM kvg.expediente WHERE cliente_principal_id = v_cliente)
            AND NOT EXISTS (SELECT 1 FROM kvg.expediente WHERE cliente_principal_id = v_cliente
                             AND NOT kvg_privado.alcance(v_actor,'documento.conservar',expediente_id))));
        IF p_operacion = 'medida.aplicar' THEN
            INSERT INTO kvg.medida_conservacion (cliente_id,expediente_id,documento_id,tipo,motivo,autorizado_por,referencia_decision)
              VALUES ((p_datos->>'cliente_id')::uuid,(p_datos->>'expediente_id')::uuid,(p_datos->>'documento_id')::uuid,
                   p_datos->>'tipo',p_datos->>'motivo',v_actor,p_datos->>'referencia_decision') RETURNING * INTO v_medida;
            PERFORM kvg_privado.restringir('APLICAR_MEDIDA','MEDIDA',v_medida.medida_id::text,v_actor,
                  jsonb_build_object('tipo',v_medida.tipo,'expediente_id',v_expediente,'medida_id',v_medida.medida_id));
        ELSE
            UPDATE kvg.medida_conservacion SET finaliza_en = clock_timestamp(),levantado_por = v_actor
              WHERE medida_id = v_medida.medida_id AND finaliza_en IS NULL RETURNING * INTO v_medida;
            PERFORM kvg_privado.exigir(v_medida.medida_id IS NOT NULL);
            PERFORM kvg_privado.restringir('LEVANTAR_MEDIDA','MEDIDA',v_medida.medida_id::text,v_actor);
        END IF;
        RETURN jsonb_build_object('medida_id',v_medida.medida_id,'revision',v_medida.revision);
    ELSIF p_operacion = 'configuracion.parametro' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['codigo','revision','valor','motivo']);
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('configuracion.administrar'));
        SELECT * INTO v_parametro FROM kvg.parametro_sistema WHERE parametro_codigo = p_datos->>'codigo' FOR UPDATE;
        PERFORM kvg_privado.exigir_revision(v_parametro.revision,(p_datos->>'revision')::integer);
        PERFORM kvg_privado.exigir(v_parametro.editable);
        v_num := (p_datos->>'valor')::integer;
        IF (v_parametro.parametro_codigo = 'sesion.inactividad_minutos' AND v_num NOT BETWEEN 5 AND 30)
          OR (v_parametro.parametro_codigo = 'sesion.duracion_horas' AND v_num NOT BETWEEN 1 AND 8)
          OR v_parametro.parametro_codigo NOT IN ('sesion.inactividad_minutos','sesion.duracion_horas') THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Valor de parámetro fuera de los límites permitidos.';
        END IF;
        PERFORM kvg_privado.exigir(length(btrim(p_datos->>'motivo')) BETWEEN 1 AND 2000);
        PERFORM set_config('kvg.motivo_parametro',p_datos->>'motivo',true);
        UPDATE kvg.parametro_sistema SET valor = v_num::text,modificado_por = v_actor,modificado_en = clock_timestamp()
          WHERE parametro_codigo = v_parametro.parametro_codigo RETURNING revision INTO v_revision;
        RETURN jsonb_build_object('codigo',v_parametro.parametro_codigo,'revision',v_revision);
    ELSIF p_operacion = 'configuracion.categoria' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['categoria_id','codigo','nombre','descripcion','activo','revision']);
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('configuracion.administrar'));
        IF p_datos->>'categoria_id' IS NULL THEN
            INSERT INTO kvg.categoria_documento (codigo,nombre,descripcion) VALUES (p_datos->>'codigo',p_datos->>'nombre',p_datos->>'descripcion')
              RETURNING * INTO v_categoria;
        ELSE
            SELECT * INTO v_categoria FROM kvg.categoria_documento WHERE categoria_id = (p_datos->>'categoria_id')::uuid FOR UPDATE;
            PERFORM kvg_privado.exigir_revision(v_categoria.revision,(p_datos->>'revision')::integer);
            UPDATE kvg.categoria_documento SET nombre = coalesce(p_datos->>'nombre',nombre),
              descripcion = CASE WHEN p_datos ? 'descripcion' THEN p_datos->>'descripcion' ELSE descripcion END,
              activo = coalesce((p_datos->>'activo')::boolean,activo) WHERE categoria_id = v_categoria.categoria_id RETURNING * INTO v_categoria;
        END IF;
        RETURN to_jsonb(v_categoria);
    ELSIF p_operacion = 'configuracion.identificacion' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['codigo','nombre','regla','unicidad','activo','revision']);
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('configuracion.administrar'));
        SELECT * INTO v_tipo FROM kvg.tipo_identificacion WHERE tipo_identificacion_codigo = p_datos->>'codigo' FOR UPDATE;
        IF NOT FOUND THEN
            INSERT INTO kvg.tipo_identificacion (tipo_identificacion_codigo,nombre,regla_normalizacion,unicidad_exigida,activo,revision)
              VALUES (p_datos->>'codigo',p_datos->>'nombre',p_datos->>'regla',coalesce((p_datos->>'unicidad')::boolean,false),true,1) RETURNING * INTO v_tipo;
        ELSE
            PERFORM kvg_privado.exigir_revision(v_tipo.revision,(p_datos->>'revision')::integer);
            UPDATE kvg.tipo_identificacion SET nombre = coalesce(p_datos->>'nombre',nombre),activo = coalesce((p_datos->>'activo')::boolean,activo)
              WHERE tipo_identificacion_codigo = v_tipo.tipo_identificacion_codigo RETURNING * INTO v_tipo;
        END IF;
        RETURN to_jsonb(v_tipo);
    ELSIF p_operacion = 'configuracion.consultar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY[]::text[]);
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('configuracion.administrar'));
        RETURN jsonb_build_object('parametros',(SELECT jsonb_agg(to_jsonb(p)) FROM kvg.parametro_sistema p),
            'roles',(SELECT jsonb_agg(to_jsonb(r)) FROM kvg.rol r),
            'permisos',(SELECT jsonb_agg(to_jsonb(p)) FROM kvg.permiso p),
            'matriz',(SELECT jsonb_agg(to_jsonb(m)) FROM kvg.rol_permiso m));
    ELSIF p_operacion = 'catalogos.consultar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY[]::text[]);
        RETURN jsonb_build_object('categorias',(SELECT jsonb_agg(to_jsonb(c)) FROM kvg.categoria_documento c WHERE activo),
            'estados_expediente',(SELECT jsonb_agg(to_jsonb(e)) FROM kvg.estado_expediente e),
            'estados_documento',(SELECT jsonb_agg(to_jsonb(e)) FROM kvg.estado_documento e),
            'tipos_identificacion',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM kvg.tipo_identificacion t WHERE activo),'[]'));
    ELSIF p_operacion = 'auditoria.consultar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['desde','hasta','limite','desplazamiento']);
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('auditoria.consultar'));
        SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO v_salida FROM
           (SELECT a.* FROM kvg.evento_auditoria a WHERE
              (p_datos->>'desde' IS NULL OR a.ocurrido_en >= (p_datos->>'desde')::timestamptz)
              AND (p_datos->>'hasta' IS NULL OR a.ocurrido_en < (p_datos->>'hasta')::timestamptz)
            ORDER BY a.ocurrido_en DESC,a.evento_id LIMIT least(greatest(coalesce((p_datos->>'limite')::integer,25),1),100)
            OFFSET greatest(coalesce((p_datos->>'desplazamiento')::integer,0),0)) q;
        PERFORM kvg_privado.auditar('AUDITORIA_CONSULTAR','AUDITORIA',NULL);
        RETURN v_salida;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Operación administrativa no admitida.';
END;
$func$;


-- 13. Solicitud de respaldos y restauración (CU022 y CU030).
CREATE FUNCTION kvg_privado.restricciones_aplicadas()
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $func$
    WITH ultima AS (
      SELECT DISTINCT ON (recurso_tipo,recurso_id) * FROM kvg.evento_restriccion
      ORDER BY recurso_tipo,recurso_id,ocurrido_en DESC,restriccion_evento_id DESC)
    SELECT NOT EXISTS (SELECT 1 FROM ultima r WHERE
       (r.accion = 'DESACTIVAR_USUARIO' AND EXISTS (SELECT 1 FROM kvg.usuario u
          WHERE u.usuario_id::text = r.recurso_id AND u.estado_cuenta <> 'DESACTIVADO'))
       OR (r.accion = 'REVOCAR_ROL' AND EXISTS (SELECT 1 FROM kvg.usuario_rol u
          WHERE u.usuario_rol_id::text = r.recurso_id AND u.finaliza_en IS NULL))
       OR (r.accion = 'CERRAR_ASIGNACION' AND EXISTS (SELECT 1 FROM kvg.asignacion_expediente a
          WHERE a.asignacion_id::text = r.recurso_id AND a.finaliza_en IS NULL))
       OR (r.accion = 'REVOCAR_CONCESION' AND EXISTS (SELECT 1 FROM kvg.concesion_acceso c
          WHERE c.concesion_id::text = r.recurso_id AND c.revocado_en IS NULL))
       OR (r.accion = 'REVOCAR_CAPACIDAD' AND EXISTS (SELECT 1 FROM kvg.rol_permiso p
          WHERE p.rol_id::text = r.detalle_controlado->>'rol_id' AND p.permiso_id::text = r.detalle_controlado->>'permiso_id'
           AND p.contexto = r.detalle_controlado->>'contexto' AND p.activo))
       OR (r.accion = 'RESTABLECER_CAPACIDAD' AND NOT EXISTS (SELECT 1 FROM kvg.rol_permiso p
          WHERE p.rol_id::text = r.detalle_controlado->>'rol_id' AND p.permiso_id::text = r.detalle_controlado->>'permiso_id'
           AND p.contexto = r.detalle_controlado->>'contexto' AND p.activo))
       OR (r.accion = 'RETIRAR_DOCUMENTO' AND EXISTS (SELECT 1 FROM kvg.documento d
          WHERE d.documento_id::text = r.recurso_id AND d.retirado_en IS NULL))
       OR (r.accion = 'RECUPERAR_DOCUMENTO' AND EXISTS (SELECT 1 FROM kvg.documento d
          WHERE d.documento_id::text = r.recurso_id AND d.retirado_en IS NOT NULL))
       OR (r.accion = 'APLICAR_MEDIDA' AND NOT EXISTS (SELECT 1 FROM kvg.medida_conservacion m
          WHERE m.medida_id::text = r.recurso_id AND m.finaliza_en IS NULL))
       OR (r.accion = 'LEVANTAR_MEDIDA' AND EXISTS (SELECT 1 FROM kvg.medida_conservacion m
          WHERE m.medida_id::text = r.recurso_id AND m.finaliza_en IS NULL)));
$func$;

CREATE FUNCTION kvg_privado.respaldos(p_operacion text,p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE v_actor uuid := kvg_privado.usuario_actual(); v_id uuid; v_trabajo uuid; v_politica kvg.politica_respaldo;
    v_respaldo kvg.respaldo; v_restauracion kvg.restauracion; v_salida jsonb; v_revision integer; v_corte timestamptz;
BEGIN
    IF p_operacion = 'respaldo.configurar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['nombre','frecuencia_minutos','destino_ref','custodia_clave_ref']);
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('respaldo.configurar'));
        PERFORM pg_advisory_xact_lock(hashtextextended('politica:' || (p_datos->>'nombre'),0));
        SELECT coalesce(max(numero_revision),0) + 1 INTO v_revision FROM kvg.politica_respaldo WHERE nombre = p_datos->>'nombre';
        UPDATE kvg.politica_respaldo SET activa = false WHERE nombre = p_datos->>'nombre' AND activa;
        INSERT INTO kvg.politica_respaldo (nombre,numero_revision,frecuencia_minutos,rpo_objetivo_segundos,rto_objetivo_segundos,
            destino_ref,custodia_clave_ref,activa,aprobado_por)
          VALUES (p_datos->>'nombre',v_revision,(p_datos->>'frecuencia_minutos')::integer,3600,14400,
             p_datos->>'destino_ref',p_datos->>'custodia_clave_ref',true,v_actor) RETURNING * INTO v_politica;
        IF v_politica.frecuencia_minutos > 60 THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'La frecuencia debe ser compatible con el objetivo de recuperación de una hora.';
        END IF;
        RETURN to_jsonb(v_politica);
    ELSIF p_operacion = 'respaldo.solicitar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['politica_respaldo_id','clave_idempotencia']);
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('respaldo.solicitar'));
        SELECT * INTO v_politica FROM kvg.politica_respaldo WHERE politica_respaldo_id = (p_datos->>'politica_respaldo_id')::uuid AND activa;
        PERFORM kvg_privado.exigir(v_politica.politica_respaldo_id IS NOT NULL);
        v_id := gen_random_uuid();
        INSERT INTO kvg.trabajo_operativo (tipo,objetivo_tipo,objetivo_id,clave_idempotencia,solicitado_por,correlacion_id)
          VALUES ('RESPALDAR','RESPALDO',v_id,p_datos->>'clave_idempotencia',v_actor,gen_random_uuid()) RETURNING trabajo_id INTO v_trabajo;
        INSERT INTO kvg.respaldo (respaldo_id,politica_respaldo_id,trabajo_id) VALUES (v_id,v_politica.politica_respaldo_id,v_trabajo);
        RETURN jsonb_build_object('respaldo_id',v_id,'trabajo_id',v_trabajo);
    ELSIF p_operacion = 'respaldo.consultar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['respaldo_id','limite','desplazamiento']);
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('respaldo.consultar'));
        SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO v_salida FROM
          (SELECT respaldo_id,politica_respaldo_id,trabajo_id,punto_recuperacion_en,estado,verificado_en
           FROM kvg.respaldo WHERE p_datos->>'respaldo_id' IS NULL OR respaldo_id = (p_datos->>'respaldo_id')::uuid
           ORDER BY punto_recuperacion_en DESC,respaldo_id LIMIT least(greatest(coalesce((p_datos->>'limite')::integer,25),1),100)
           OFFSET greatest(coalesce((p_datos->>'desplazamiento')::integer,0),0)) q;
        RETURN v_salida;
    ELSIF p_operacion = 'respaldo.restaurar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['respaldo_id','modalidad','entorno_aislado_ref','incidente_en','clave_idempotencia']);
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('respaldo.restaurar'));
        SELECT * INTO v_respaldo FROM kvg.respaldo WHERE respaldo_id = (p_datos->>'respaldo_id')::uuid AND estado = 'VERIFICADO';
        PERFORM kvg_privado.exigir(v_respaldo.respaldo_id IS NOT NULL);
        v_id := gen_random_uuid();
        INSERT INTO kvg.trabajo_operativo (tipo,objetivo_tipo,objetivo_id,clave_idempotencia,solicitado_por,correlacion_id)
          VALUES ('RESTAURAR','RESTAURACION',v_id,p_datos->>'clave_idempotencia',v_actor,gen_random_uuid()) RETURNING trabajo_id INTO v_trabajo;
        INSERT INTO kvg.restauracion (restauracion_id,respaldo_id,trabajo_id,modalidad,entorno_aislado_ref,incidente_en)
          VALUES (v_id,v_respaldo.respaldo_id,v_trabajo,p_datos->>'modalidad',p_datos->>'entorno_aislado_ref',
                (p_datos->>'incidente_en')::timestamptz);
        IF p_datos->>'modalidad' = 'INCIDENTE' THEN
            UPDATE kvg.parametro_sistema SET valor = 'true',modificado_por = v_actor,modificado_en = clock_timestamp()
              WHERE parametro_codigo = 'sistema.bloqueado';
        END IF;
        RETURN jsonb_build_object('restauracion_id',v_id,'trabajo_id',v_trabajo);
    ELSIF p_operacion = 'respaldo.habilitar' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY['restauracion_id','referencia_autorizacion']);
        PERFORM pg_advisory_xact_lock(hashtextextended('kvg:seguridad',0));
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('respaldo.habilitar') AND p_datos->>'referencia_autorizacion' IS NOT NULL);
        SELECT * INTO v_restauracion FROM kvg.restauracion WHERE restauracion_id = (p_datos->>'restauracion_id')::uuid FOR UPDATE;
        SELECT coalesce(max(ocurrido_en),'epoch'::timestamptz) INTO v_corte FROM kvg.evento_restriccion;
        PERFORM kvg_privado.exigir(v_restauracion.estado = 'VERIFICADA' AND v_restauracion.modalidad = 'INCIDENTE'
            AND v_restauracion.restricciones_hasta >= v_corte AND v_restauracion.estado_previo_ref IS NOT NULL
            AND kvg_privado.restricciones_aplicadas());
        UPDATE kvg.restauracion SET estado = 'HABILITADA',autorizado_por = v_actor,autorizado_en = clock_timestamp(),
           servicio_habilitado_en = clock_timestamp() WHERE restauracion_id = v_restauracion.restauracion_id;
        UPDATE kvg.parametro_sistema SET valor = 'false',modificado_por = v_actor,modificado_en = clock_timestamp()
           WHERE parametro_codigo = 'sistema.bloqueado';
        RETURN jsonb_build_object('restauracion_id',v_restauracion.restauracion_id,'estado','HABILITADA');
    END IF;
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Operación de respaldo no admitida.';
END;
$func$;


-- 14. Trabajo técnico: arrendamientos, conciliación, originales y copias.
-- El trabajador usa service_role exclusivamente en el servidor. No recibe
-- credenciales humanas ni puede ejecutar las funciones privadas directamente.
CREATE FUNCTION kvg_privado.arrendamiento(p_trabajo uuid,p_token text)
RETURNS kvg.trabajo_operativo LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE v_trabajo kvg.trabajo_operativo;
BEGIN
    SELECT * INTO v_trabajo FROM kvg.trabajo_operativo WHERE trabajo_id = p_trabajo FOR UPDATE;
    PERFORM kvg_privado.exigir(v_trabajo.estado = 'EN_EJECUCION' AND v_trabajo.ejecutor_codigo = p_token
         AND v_trabajo.bloqueo_hasta > clock_timestamp());
    RETURN v_trabajo;
END;
$func$;

CREATE FUNCTION kvg_privado.planificar_respaldos()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE v_politica kvg.politica_respaldo; v_id uuid; v_trabajo uuid;
BEGIN
    FOR v_politica IN SELECT * FROM kvg.politica_respaldo WHERE activa FOR UPDATE SKIP LOCKED LOOP
        IF NOT EXISTS (SELECT 1 FROM kvg.respaldo r JOIN kvg.trabajo_operativo t ON t.trabajo_id = r.trabajo_id
            WHERE r.politica_respaldo_id = v_politica.politica_respaldo_id
              AND (t.estado IN ('EN_COLA','EN_EJECUCION') OR
                t.creado_en > clock_timestamp() - make_interval(mins => v_politica.frecuencia_minutos))) THEN
            v_id := gen_random_uuid();
            INSERT INTO kvg.trabajo_operativo (tipo,objetivo_tipo,objetivo_id,clave_idempotencia,correlacion_id)
              VALUES ('RESPALDAR','RESPALDO',v_id,'programado:' || v_id::text,gen_random_uuid()) RETURNING trabajo_id INTO v_trabajo;
            INSERT INTO kvg.respaldo (respaldo_id,politica_respaldo_id,trabajo_id)
              VALUES (v_id,v_politica.politica_respaldo_id,v_trabajo);
        END IF;
    END LOOP;
END;
$func$;

CREATE FUNCTION public.kvg_trabajar(p_operacion text,p_datos jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE v_trabajo kvg.trabajo_operativo; v_carga kvg.carga_archivo; v_doc kvg.documento;
  v_version kvg.version_documento; v_usuario kvg.usuario; v_auth uuid; v_respaldo kvg.respaldo;
  v_restauracion kvg.restauracion; v_item jsonb; v_id uuid; v_token text; v_revision integer;
  v_evento kvg.evento_auditoria; v_salida jsonb; v_numero integer; v_corte timestamptz;
BEGIN
    PERFORM kvg_privado.exigir(auth.role() = 'service_role');
    IF p_datos IS NULL OR jsonb_typeof(p_datos) <> 'object' OR octet_length(p_datos::text) > 8388608 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Entrada técnica inválida.';
    END IF;
    IF p_operacion = 'trabajo.estado' THEN
        SELECT * INTO v_trabajo FROM kvg.trabajo_operativo WHERE trabajo_id = (p_datos->>'trabajo_id')::uuid;
        PERFORM kvg_privado.exigir(v_trabajo.trabajo_id IS NOT NULL);
        RETURN jsonb_build_object('trabajo_id',v_trabajo.trabajo_id,'tipo',v_trabajo.tipo,'estado',v_trabajo.estado,
          'intentos',v_trabajo.intentos,'resultado_codigo',v_trabajo.resultado_codigo,'finalizado_en',v_trabajo.finalizado_en,
          'version_id',(SELECT version_id FROM kvg.version_documento WHERE carga_id = v_trabajo.objetivo_id));
    ELSIF p_operacion = 'trabajo.tomar' THEN
        PERFORM kvg_privado.planificar_respaldos();
        UPDATE kvg.trabajo_operativo SET estado = 'FALLIDO',finalizado_en = clock_timestamp(),resultado_codigo = 'INTENTOS_AGOTADOS'
          WHERE (estado = 'EN_COLA' OR estado = 'EN_EJECUCION' AND bloqueo_hasta <= clock_timestamp()) AND intentos >= max_intentos;
        SELECT t.* INTO v_trabajo FROM kvg.trabajo_operativo t
          WHERE t.proximo_intento_en <= clock_timestamp() AND t.intentos < t.max_intentos
            AND (t.estado = 'EN_COLA' OR t.estado = 'EN_EJECUCION' AND t.bloqueo_hasta <= clock_timestamp())
            AND (t.tipo NOT IN ('VERIFICAR_CARGA','CONCILIAR_CARGA') OR EXISTS
               (SELECT 1 FROM kvg.carga_archivo c WHERE c.carga_id = t.objetivo_id
                 AND c.estado_tecnico IN ('PENDIENTE_VERIFICACION','ERROR_VERIFICACION')))
          ORDER BY t.creado_en,t.trabajo_id FOR UPDATE SKIP LOCKED LIMIT 1;
        IF NOT FOUND THEN RETURN '{}'; END IF;
        v_token := encode(extensions.gen_random_bytes(32),'hex');
        UPDATE kvg.trabajo_operativo SET estado = 'EN_EJECUCION',intentos = intentos + 1,
          ejecutor_codigo = v_token,bloqueo_hasta = clock_timestamp() + interval '5 minutes'
          WHERE trabajo_id = v_trabajo.trabajo_id RETURNING * INTO v_trabajo;
        RETURN to_jsonb(v_trabajo) - 'detalle_solicitud';
    ELSIF p_operacion = 'carga.destino' THEN
        SELECT * INTO v_carga FROM kvg.carga_archivo WHERE carga_id = (p_datos->>'carga_id')::uuid;
        SELECT * INTO v_doc FROM kvg.documento WHERE documento_id = v_carga.documento_id;
        PERFORM kvg_privado.exigir(v_carga.estado_tecnico = 'RECIBIENDO' AND v_doc.retirado_en IS NULL
          AND kvg_privado.alcance(v_carga.solicitado_por,'documento.cargar',v_doc.expediente_id)
          AND NOT EXISTS (SELECT 1 FROM kvg.expediente e WHERE e.expediente_id = v_doc.expediente_id
            AND kvg_privado.medida_impide(e.cliente_principal_id,e.expediente_id,v_doc.documento_id,'EDITAR')));
        PERFORM kvg_privado.exigir_editable(v_doc.expediente_id);
        RETURN jsonb_build_object('bucket','kvg-cuarentena','localizador',v_carga.localizador_cuarentena,
          'limite_bytes',20000000,'nombre_original',v_carga.nombre_original);
    ELSIF p_operacion = 'carga.recibir' THEN
        SELECT * INTO v_carga FROM kvg.carga_archivo WHERE carga_id = (p_datos->>'carga_id')::uuid FOR UPDATE;
        SELECT * INTO v_doc FROM kvg.documento WHERE documento_id = v_carga.documento_id;
        PERFORM kvg_privado.exigir(v_carga.estado_tecnico = 'RECIBIENDO'
          AND kvg_privado.alcance(v_carga.solicitado_por,'documento.cargar',v_doc.expediente_id)
          AND v_doc.retirado_en IS NULL);
        PERFORM kvg_privado.exigir_editable(v_doc.expediente_id);
        PERFORM kvg_privado.exigir(EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'kvg-cuarentena'
                  AND name = v_carga.localizador_cuarentena));
        IF (p_datos->>'tamano_bytes')::bigint NOT BETWEEN 1 AND 20000000 THEN
            UPDATE kvg.carga_archivo SET estado_tecnico = 'RECHAZADO',resultado_tecnico_codigo = 'TAMANO_INVALIDO'
              WHERE carga_id = v_carga.carga_id;
            UPDATE kvg.trabajo_operativo SET estado = 'CANCELADO',finalizado_en = clock_timestamp(),resultado_codigo = 'TAMANO_INVALIDO'
              WHERE objetivo_id = v_carga.carga_id AND tipo = 'VERIFICAR_CARGA' AND estado = 'EN_COLA';
        ELSE
            UPDATE kvg.carga_archivo SET estado_tecnico = 'PENDIENTE_VERIFICACION',tamano_recibido_bytes = (p_datos->>'tamano_bytes')::bigint
              WHERE carga_id = v_carga.carga_id;
        END IF;
        RETURN jsonb_build_object('carga_id',v_carga.carga_id);
    ELSIF p_operacion = 'restricciones.exportar' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO v_salida FROM
          (SELECT * FROM kvg.evento_restriccion WHERE
           (ocurrido_en,restriccion_evento_id) >
           (coalesce((p_datos->>'desde')::timestamptz,'epoch'::timestamptz),
            coalesce((p_datos->>'ultimo_id')::uuid,'00000000-0000-0000-0000-000000000000'::uuid))
           ORDER BY ocurrido_en,restriccion_evento_id LIMIT 500) q;
        RETURN v_salida;
    ELSIF p_operacion IN ('entrega.autorizar','entrega.confirmar') THEN
        SELECT * INTO v_evento FROM kvg.evento_auditoria WHERE evento_id = (p_datos->>'autorizacion_id')::uuid
           AND accion = 'AUTORIZACION_DESCARGA' AND resultado = 'EXITO';
        PERFORM kvg_privado.exigir(v_evento.evento_id IS NOT NULL);
        SELECT * INTO v_version FROM kvg.version_documento WHERE version_id = v_evento.recurso_id;
        SELECT * INTO v_doc FROM kvg.documento WHERE documento_id = v_version.documento_id;
        IF p_operacion = 'entrega.autorizar' THEN
            PERFORM kvg_privado.exigir(v_evento.ocurrido_en > clock_timestamp() - interval '60 seconds'
             AND v_doc.retirado_en IS NULL AND kvg_privado.alcance(v_evento.usuario_id,'documento.descargar',v_doc.expediente_id)
             AND EXISTS (SELECT 1 FROM kvg.sesion_aplicacion s JOIN kvg.usuario u ON u.usuario_id = s.usuario_id
                 JOIN auth.sessions a ON a.id::text = s.auth_sesion_ref AND a.user_id = u.auth_usuario_id
               WHERE s.sesion_id = v_evento.sesion_id AND s.revocada_en IS NULL AND u.estado_cuenta = 'ACTIVO'
                AND s.expira_en > clock_timestamp() AND s.ultima_actividad_en > clock_timestamp() - make_interval(mins => coalesce((SELECT valor::integer FROM kvg.parametro_sistema WHERE parametro_codigo = 'sesion.inactividad_minutos'),30)))
             AND NOT EXISTS (SELECT 1 FROM kvg.expediente e WHERE e.expediente_id = v_doc.expediente_id
                AND kvg_privado.medida_impide(e.cliente_principal_id,e.expediente_id,v_doc.documento_id,'LEER')));
            RETURN jsonb_build_object('bucket','kvg-originales','localizador',v_version.localizador_objeto,
                'sha256',v_version.sha256,'tamano_bytes',v_version.tamano_bytes,'vigencia_maxima_segundos',60);
        END IF;
        PERFORM kvg_privado.exigir((p_datos->>'bytes_transferidos')::bigint = v_version.tamano_bytes
            AND length(btrim(p_datos->>'evidencia_ref')) BETWEEN 1 AND 512);
        PERFORM kvg_privado.auditar('TRANSFERENCIA_VERIFICADA','VERSION',v_version.version_id,'EXITO',
            jsonb_build_object('cantidad',v_version.tamano_bytes,'codigo','EVIDENCIA_TECNICA_VERIFICADA'));
        RETURN jsonb_build_object('version_id',v_version.version_id);
    END IF;

    v_trabajo := kvg_privado.arrendamiento((p_datos->>'trabajo_id')::uuid,p_datos->>'token');
    IF p_operacion = 'trabajo.datos' THEN
        v_salida := jsonb_build_object('trabajo',to_jsonb(v_trabajo) - 'ejecutor_codigo');
        IF v_trabajo.tipo IN ('VERIFICAR_CARGA','CONCILIAR_CARGA') THEN
            SELECT * INTO v_carga FROM kvg.carga_archivo WHERE carga_id = v_trabajo.objetivo_id;
            v_salida := v_salida || jsonb_build_object('carga',to_jsonb(v_carga),'bucket_origen','kvg-cuarentena',
              'bucket_destino','kvg-originales','localizador_destino','versiones/' || v_carga.carga_id::text || '/original');
        ELSIF v_trabajo.tipo = 'CONCILIAR_IDENTIDAD' THEN
            SELECT * INTO v_usuario FROM kvg.usuario WHERE usuario_id = v_trabajo.objetivo_id;
            v_salida := v_salida || jsonb_build_object('usuario',jsonb_build_object('usuario_id',v_usuario.usuario_id,
               'nombre',v_usuario.nombre,'correo_operativo',v_usuario.correo_operativo,'estado_cuenta',v_usuario.estado_cuenta));
        ELSIF v_trabajo.tipo = 'VERIFICAR_RECUPERACION' THEN
            v_salida := v_salida || jsonb_build_object('originales',coalesce((SELECT jsonb_agg(jsonb_build_object(
               'version_id',v.version_id,'bucket','kvg-originales','localizador',v.localizador_objeto,
               'sha256',v.sha256,'tamano_bytes',v.tamano_bytes)) FROM kvg.version_documento v
                WHERE v.documento_id = v_trabajo.objetivo_id),'[]'));
        ELSIF v_trabajo.tipo = 'RESPALDAR' THEN
            v_salida := v_salida || jsonb_build_object('respaldo',(SELECT to_jsonb(r) FROM kvg.respaldo r WHERE respaldo_id = v_trabajo.objetivo_id),
               'politica',(SELECT to_jsonb(p) FROM kvg.politica_respaldo p JOIN kvg.respaldo r USING(politica_respaldo_id)
                 WHERE r.respaldo_id = v_trabajo.objetivo_id));
        ELSIF v_trabajo.tipo = 'RESTAURAR' THEN
            v_salida := v_salida || jsonb_build_object('restauracion',(SELECT to_jsonb(r) FROM kvg.restauracion r
               WHERE restauracion_id = v_trabajo.objetivo_id),'respaldo',(SELECT to_jsonb(b) FROM kvg.respaldo b
                JOIN kvg.restauracion r USING(respaldo_id) WHERE r.restauracion_id = v_trabajo.objetivo_id),
               'manifiesto',(SELECT jsonb_agg(to_jsonb(m)) FROM kvg.elemento_manifiesto m JOIN kvg.restauracion r USING(respaldo_id)
                WHERE r.restauracion_id = v_trabajo.objetivo_id));
        END IF;
        RETURN v_salida;
    ELSIF p_operacion = 'respaldo.inventario' THEN
        PERFORM kvg_privado.exigir(v_trabajo.tipo = 'RESPALDAR');
        SELECT * INTO v_respaldo FROM kvg.respaldo WHERE respaldo_id = v_trabajo.objetivo_id;
        PERFORM kvg_privado.exigir(v_respaldo.estado = 'VERIFICANDO');
        SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO v_salida FROM
          (SELECT version_id,localizador_objeto,sha256,tamano_bytes,publicado_en FROM kvg.version_documento
            WHERE publicado_en <= v_respaldo.punto_recuperacion_en
             AND version_id > coalesce((p_datos->>'ultimo_id')::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
            ORDER BY version_id LIMIT 500) q;
        RETURN v_salida;
    ELSIF p_operacion = 'trabajo.renovar' THEN
        UPDATE kvg.trabajo_operativo SET bloqueo_hasta = clock_timestamp() + interval '5 minutes' WHERE trabajo_id = v_trabajo.trabajo_id;
        RETURN jsonb_build_object('trabajo_id',v_trabajo.trabajo_id);
    ELSIF p_operacion = 'trabajo.fallar' THEN
        UPDATE kvg.trabajo_operativo SET
          estado = CASE WHEN intentos >= max_intentos THEN 'FALLIDO' ELSE 'EN_COLA' END,
          finalizado_en = CASE WHEN intentos >= max_intentos THEN clock_timestamp() END,
          bloqueo_hasta = NULL,ejecutor_codigo = NULL,proximo_intento_en = clock_timestamp() + interval '1 minute',
          resultado_codigo = 'FALLO_TECNICO' WHERE trabajo_id = v_trabajo.trabajo_id;
        RETURN jsonb_build_object('trabajo_id',v_trabajo.trabajo_id);
    ELSIF p_operacion = 'identidad.conciliar' THEN
        PERFORM kvg_privado.exigir(v_trabajo.tipo = 'CONCILIAR_IDENTIDAD');
        PERFORM pg_advisory_xact_lock(hashtextextended('kvg:seguridad',0));
        SELECT * INTO v_usuario FROM kvg.usuario WHERE usuario_id = v_trabajo.objetivo_id FOR UPDATE;
        SELECT id INTO v_auth FROM auth.users WHERE id = (p_datos->>'auth_usuario_id')::uuid
          AND lower(email) = v_usuario.correo_operativo AND email_confirmed_at IS NOT NULL;
        PERFORM kvg_privado.exigir(v_usuario.estado_cuenta = 'INVITADO' AND v_auth IS NOT NULL);
        UPDATE kvg.usuario SET auth_usuario_id = v_auth,estado_cuenta = 'ACTIVO',revision_autorizacion = revision_autorizacion + 1
          WHERE usuario_id = v_usuario.usuario_id;
    ELSIF p_operacion IN ('carga.publicar','carga.rechazar') THEN
        PERFORM kvg_privado.exigir(v_trabajo.tipo IN ('VERIFICAR_CARGA','CONCILIAR_CARGA'));
        SELECT * INTO v_carga FROM kvg.carga_archivo WHERE carga_id = v_trabajo.objetivo_id FOR UPDATE;
        SELECT * INTO v_doc FROM kvg.documento WHERE documento_id = v_carga.documento_id FOR UPDATE;
        IF p_operacion = 'carga.rechazar' THEN
            UPDATE kvg.carga_archivo SET estado_tecnico = 'RECHAZADO',verificado_en = clock_timestamp(),
              resultado_tecnico_codigo = 'CONTENIDO_RECHAZADO',motor_version = p_datos->>'motor_version' WHERE carga_id = v_carga.carga_id;
        ELSE
            PERFORM kvg_privado.exigir((p_datos->>'antimalware_apto')::boolean IS TRUE AND v_doc.retirado_en IS NULL
              AND v_carga.expediente_destino_id = v_doc.expediente_id
              AND kvg_privado.alcance(v_carga.solicitado_por,'documento.cargar',v_doc.expediente_id)
              AND NOT EXISTS (SELECT 1 FROM kvg.expediente e WHERE e.expediente_id = v_doc.expediente_id
                   AND kvg_privado.medida_impide(e.cliente_principal_id,e.expediente_id,v_doc.documento_id,'EDITAR')));
            PERFORM kvg_privado.exigir_editable(v_doc.expediente_id);
            PERFORM kvg_privado.exigir_revision(v_doc.revision,v_carga.revision_documento_base);
            PERFORM kvg_privado.exigir((p_datos->>'tamano_bytes')::bigint = v_carga.tamano_recibido_bytes
              AND EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'kvg-originales'
                    AND name = 'versiones/' || v_carga.carga_id::text || '/original'));
            UPDATE kvg.carga_archivo SET estado_tecnico = 'HABILITADO',resultado_tecnico_codigo = 'SEGURO',
               motor_version = p_datos->>'motor_version',verificado_en = clock_timestamp() WHERE carga_id = v_carga.carga_id;
            SELECT coalesce(max(numero_version),0) + 1 INTO v_numero FROM kvg.version_documento WHERE documento_id = v_doc.documento_id;
            INSERT INTO kvg.version_documento (documento_id,numero_version,carga_id,localizador_objeto,sha256,
                tamano_bytes,formato,mime_verificado,fecha_origen,procedencia)
              VALUES (v_doc.documento_id,v_numero,v_carga.carga_id,'versiones/' || v_carga.carga_id::text || '/original',p_datos->>'sha256',
                (p_datos->>'tamano_bytes')::bigint,p_datos->>'formato',p_datos->>'mime_verificado',
                (p_datos->>'fecha_origen')::date,p_datos->>'procedencia') RETURNING * INTO v_version;
            INSERT INTO kvg.historial_estado_documento (version_id,estado_destino_codigo,responsable_usuario_id,motivo,revision_resultante)
              VALUES (v_version.version_id,'RECIBIDO',v_carga.solicitado_por,v_carga.motivo_version,1);
            UPDATE kvg.documento SET version_vigente_id = v_version.version_id WHERE documento_id = v_doc.documento_id;
        END IF;
    ELSIF p_operacion = 'documento.recuperar' THEN
        PERFORM kvg_privado.exigir(v_trabajo.tipo = 'VERIFICAR_RECUPERACION');
        PERFORM pg_advisory_xact_lock(hashtextextended('kvg:seguridad',0));
        SELECT * INTO v_doc FROM kvg.documento WHERE documento_id = v_trabajo.objetivo_id FOR UPDATE;
        PERFORM kvg_privado.exigir_revision(v_doc.revision,(v_trabajo.detalle_solicitud->>'revision')::integer);
        PERFORM kvg_privado.exigir(v_doc.retirado_en IS NOT NULL AND kvg_privado.capacidad(v_trabajo.solicitado_por,'documento.recuperar','GLOBAL_OPERATIVO')
          AND NOT EXISTS (SELECT 1 FROM kvg.expediente e WHERE e.expediente_id = v_doc.expediente_id
               AND kvg_privado.medida_impide(e.cliente_principal_id,e.expediente_id,v_doc.documento_id,'RECUPERAR')));
        IF jsonb_typeof(p_datos->'verificaciones') <> 'array' OR NOT EXISTS
           (SELECT 1 FROM kvg.version_documento WHERE documento_id = v_doc.documento_id) OR EXISTS
           (SELECT 1 FROM kvg.version_documento v WHERE v.documento_id = v_doc.documento_id AND NOT EXISTS
             (SELECT 1 FROM jsonb_array_elements(p_datos->'verificaciones') x WHERE
               (x->>'version_id')::uuid = v.version_id AND x->>'sha256' = v.sha256 AND (x->>'tamano_bytes')::bigint = v.tamano_bytes
               AND (x->>'disponible')::boolean IS TRUE AND (x->>'antimalware_apto')::boolean IS TRUE)) THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'La recuperación requiere todos los originales verificados.';
        END IF;
        UPDATE kvg.trabajo_operativo SET estado = 'COMPLETADO',finalizado_en = clock_timestamp(),resultado_codigo = 'INTEGRIDAD_VERIFICADA'
           WHERE trabajo_id = v_trabajo.trabajo_id;
        UPDATE kvg.documento SET retirado_en = NULL WHERE documento_id = v_doc.documento_id RETURNING revision INTO v_revision;
        INSERT INTO kvg.evento_retiro_documento (documento_id,operacion,registrado_por,motivo,autorizado_por,trabajo_verificacion_id,revision_resultante)
          VALUES (v_doc.documento_id,'RECUPERACION',v_trabajo.solicitado_por,v_trabajo.detalle_solicitud->>'motivo',
             v_trabajo.solicitado_por,v_trabajo.trabajo_id,v_revision);
        PERFORM kvg_privado.restringir('RECUPERAR_DOCUMENTO','DOCUMENTO',v_doc.documento_id::text,v_trabajo.solicitado_por);
        RETURN jsonb_build_object('documento_id',v_doc.documento_id,'revision',v_revision);
    ELSIF p_operacion = 'respaldo.iniciar' THEN
        PERFORM kvg_privado.exigir(v_trabajo.tipo = 'RESPALDAR');
        UPDATE kvg.respaldo SET estado = 'VERIFICANDO',punto_recuperacion_en = (p_datos->>'punto_recuperacion_en')::timestamptz
          WHERE respaldo_id = v_trabajo.objetivo_id AND estado = 'PENDIENTE' RETURNING * INTO v_respaldo;
        PERFORM kvg_privado.exigir(v_respaldo.respaldo_id IS NOT NULL AND v_respaldo.punto_recuperacion_en <= clock_timestamp());
        RETURN to_jsonb(v_respaldo);
    ELSIF p_operacion = 'respaldo.manifiesto' THEN
        PERFORM kvg_privado.exigir(v_trabajo.tipo = 'RESPALDAR');
        SELECT * INTO v_respaldo FROM kvg.respaldo WHERE respaldo_id = v_trabajo.objetivo_id AND estado = 'VERIFICANDO' FOR UPDATE;
        PERFORM kvg_privado.exigir(v_respaldo.respaldo_id IS NOT NULL AND jsonb_typeof(p_datos->'elementos') = 'array');
        FOR v_item IN SELECT value FROM jsonb_array_elements(p_datos->'elementos') LOOP
            INSERT INTO kvg.elemento_manifiesto (respaldo_id,numero_elemento,tipo,version_origen_id,localizador_origen,localizador_copia,
                sha256_copia,tamano_copia_bytes,sha256_original,tamano_original_bytes,copiado_en,verificado_en,custodia_clave_ref)
            VALUES (v_respaldo.respaldo_id,(v_item->>'numero_elemento')::bigint,v_item->>'tipo',(v_item->>'version_origen_id')::uuid,
                v_item->>'localizador_origen',v_item->>'localizador_copia',v_item->>'sha256_copia',(v_item->>'tamano_copia_bytes')::bigint,
                v_item->>'sha256_original',(v_item->>'tamano_original_bytes')::bigint,(v_item->>'copiado_en')::timestamptz,
                (v_item->>'verificado_en')::timestamptz,v_item->>'custodia_clave_ref');
        END LOOP;
        RETURN jsonb_build_object('respaldo_id',v_respaldo.respaldo_id);
    ELSIF p_operacion = 'respaldo.verificar' THEN
        PERFORM kvg_privado.exigir(v_trabajo.tipo = 'RESPALDAR' AND (p_datos->>'copia_independiente_cifrada')::boolean IS TRUE);
        UPDATE kvg.respaldo SET estado = 'VERIFICADO',manifiesto_localizador = p_datos->>'manifiesto_localizador',
            manifiesto_sha256 = p_datos->>'manifiesto_sha256',verificado_en = clock_timestamp(),evidencia_ref = p_datos->>'evidencia_ref'
          WHERE respaldo_id = v_trabajo.objetivo_id AND estado = 'VERIFICANDO' RETURNING * INTO v_respaldo;
        PERFORM kvg_privado.exigir(v_respaldo.respaldo_id IS NOT NULL);
    ELSIF p_operacion = 'restauracion.iniciar' THEN
        PERFORM kvg_privado.exigir(v_trabajo.tipo = 'RESTAURAR');
        UPDATE kvg.restauracion SET estado = 'EN_AISLAMIENTO',estado_previo_ref = p_datos->>'estado_previo_ref'
          WHERE restauracion_id = v_trabajo.objetivo_id AND estado = 'SOLICITADA' RETURNING * INTO v_restauracion;
        PERFORM kvg_privado.exigir(v_restauracion.restauracion_id IS NOT NULL);
        RETURN to_jsonb(v_restauracion);
    ELSIF p_operacion = 'restauracion.verificar' THEN
        PERFORM kvg_privado.exigir(v_trabajo.tipo = 'RESTAURAR');
        PERFORM pg_advisory_xact_lock(hashtextextended('kvg:seguridad',0));
        SELECT * INTO v_restauracion FROM kvg.restauracion WHERE restauracion_id = v_trabajo.objetivo_id FOR UPDATE;
        SELECT coalesce(max(ocurrido_en),'epoch'::timestamptz) INTO v_corte FROM kvg.evento_restriccion;
        PERFORM kvg_privado.exigir(v_restauracion.estado = 'EN_AISLAMIENTO' AND (p_datos->>'datos_verificados')::boolean IS TRUE
          AND (p_datos->>'objetos_verificados')::boolean IS TRUE AND (p_datos->>'identidad_verificada')::boolean IS TRUE
          AND (p_datos->>'replica_restricciones_verificada')::boolean IS TRUE
          AND (p_datos->>'restricciones_hasta')::timestamptz >= v_corte AND kvg_privado.restricciones_aplicadas());
        UPDATE kvg.restauracion SET estado = 'VERIFICADA',verificado_en = clock_timestamp(),
            restricciones_hasta = (p_datos->>'restricciones_hasta')::timestamptz,evidencia_ref = p_datos->>'evidencia_ref',
            rpo_medido_segundos = (p_datos->>'rpo_medido_segundos')::integer,rto_medido_segundos = (p_datos->>'rto_medido_segundos')::integer
          WHERE restauracion_id = v_restauracion.restauracion_id;
        IF v_restauracion.modalidad = 'INCIDENTE' THEN
            UPDATE kvg.sesion_aplicacion SET revocada_en = clock_timestamp(),motivo_revocacion = 'INCIDENTE' WHERE revocada_en IS NULL;
        END IF;
    ELSE
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Operación técnica no admitida.';
    END IF;
    UPDATE kvg.trabajo_operativo SET estado = 'COMPLETADO',finalizado_en = clock_timestamp(),resultado_codigo =
      CASE WHEN p_operacion = 'carga.rechazar' THEN 'CONTENIDO_RECHAZADO' ELSE 'OPERACION_VERIFICADA' END
      WHERE trabajo_id = v_trabajo.trabajo_id;
    RETURN jsonb_build_object('trabajo_id',v_trabajo.trabajo_id,'version_id',v_version.version_id,'estado','COMPLETADO');
END;
$func$;


-- 15. Inicialización administrativa con identidades verificadas de Auth.
CREATE FUNCTION public.kvg_inicializar(p_auth_administrador uuid,p_auth_juridico uuid,
 p_nombre_administrador text,p_nombre_juridico text,p_referencia_aprobacion text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
DECLARE v_admin uuid; v_legal uuid; v_correo_admin text; v_correo_legal text;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('kvg:inicializacion',0));
    IF EXISTS (SELECT 1 FROM kvg.usuario) THEN
        RAISE EXCEPTION 'La inicialización de cuentas ya fue realizada.';
    END IF;
    IF p_auth_administrador IS NULL OR p_auth_juridico IS NULL OR p_auth_administrador = p_auth_juridico
       OR length(btrim(p_referencia_aprobacion)) NOT BETWEEN 1 AND 512 THEN
        RAISE EXCEPTION 'La inicialización requiere dos responsables y una aprobación identificable.';
    END IF;
    SELECT lower(email) INTO v_correo_admin FROM auth.users WHERE id = p_auth_administrador AND email_confirmed_at IS NOT NULL;
    SELECT lower(email) INTO v_correo_legal FROM auth.users WHERE id = p_auth_juridico AND email_confirmed_at IS NOT NULL;
    IF v_correo_admin IS NULL OR v_correo_legal IS NULL THEN RAISE EXCEPTION 'Las identidades deben tener correo confirmado en Auth.'; END IF;
    INSERT INTO kvg.usuario (auth_usuario_id,nombre,correo_operativo,estado_cuenta)
     VALUES (p_auth_administrador,p_nombre_administrador,v_correo_admin,'ACTIVO') RETURNING usuario_id INTO v_admin;
    INSERT INTO kvg.usuario (auth_usuario_id,nombre,correo_operativo,estado_cuenta,creado_por)
     VALUES (p_auth_juridico,p_nombre_juridico,v_correo_legal,'ACTIVO',v_admin) RETURNING usuario_id INTO v_legal;
    INSERT INTO kvg.usuario_rol (usuario_id,rol_id,otorgado_por,motivo_alta)
     SELECT v_admin,rol_id,v_admin,'Designación inicial del responsable técnico.' FROM kvg.rol WHERE codigo = 'ADMINISTRADOR';
    INSERT INTO kvg.usuario_rol (usuario_id,rol_id,otorgado_por,motivo_alta)
     SELECT v_legal,rol_id,v_admin,p_referencia_aprobacion FROM kvg.rol WHERE codigo = 'ABOGADO';
    INSERT INTO kvg.rol_permiso (rol_id,permiso_id,contexto,activo,aprobado_por)
     SELECT r.rol_id,p.permiso_id,m.contexto,true,v_legal
     FROM (VALUES
      ('SECRETARIA','cliente.consultar','EXPLICITO'),
      ('SECRETARIA','expediente.consultar','EXPLICITO'),
      ('SECRETARIA','expediente.actualizar','EXPLICITO'),
      ('SECRETARIA','expediente.iniciar','EXPLICITO'),
      ('SECRETARIA','expediente.suspender','EXPLICITO'),
      ('SECRETARIA','expediente.reanudar','EXPLICITO'),
      ('SECRETARIA','expediente.archivar','EXPLICITO'),
      ('SECRETARIA','documento.cargar','EXPLICITO'),
      ('SECRETARIA','documento.consultar','EXPLICITO'),
      ('SECRETARIA','documento.clasificar','EXPLICITO'),
      ('SECRETARIA','documento.asociar','EXPLICITO'),
      ('SECRETARIA','documento.actualizar','EXPLICITO'),
      ('SECRETARIA','documento.descargar','EXPLICITO'),
      ('SECRETARIA','documento.versiones','EXPLICITO'),
      ('SECRETARIA','documento.iniciar_revision','EXPLICITO'),
      ('SECRETARIA','documento.corregir','EXPLICITO'),
      ('SECRETARIA','documento.archivar','EXPLICITO'),
      ('SECRETARIA','cliente.actualizar','EXPLICITO'),
      ('SECRETARIA','expediente.asignar','EXPLICITO'),
      ('SECRETARIA','documento.retirar','EXPLICITO'),
      ('ABOGADO','cliente.consultar','PRINCIPAL'),
      ('ABOGADO','expediente.consultar','PRINCIPAL'),
      ('ABOGADO','expediente.actualizar','PRINCIPAL'),
      ('ABOGADO','expediente.iniciar','PRINCIPAL'),
      ('ABOGADO','expediente.suspender','PRINCIPAL'),
      ('ABOGADO','expediente.reanudar','PRINCIPAL'),
      ('ABOGADO','expediente.archivar','PRINCIPAL'),
      ('ABOGADO','documento.cargar','PRINCIPAL'),
      ('ABOGADO','documento.consultar','PRINCIPAL'),
      ('ABOGADO','documento.clasificar','PRINCIPAL'),
      ('ABOGADO','documento.asociar','PRINCIPAL'),
      ('ABOGADO','documento.actualizar','PRINCIPAL'),
      ('ABOGADO','documento.descargar','PRINCIPAL'),
      ('ABOGADO','documento.versiones','PRINCIPAL'),
      ('ABOGADO','documento.iniciar_revision','PRINCIPAL'),
      ('ABOGADO','documento.corregir','PRINCIPAL'),
      ('ABOGADO','documento.archivar','PRINCIPAL'),
      ('ABOGADO','expediente.avanzar','PRINCIPAL'),
      ('ABOGADO','documento.revisar','PRINCIPAL'),
      ('ABOGADO','expediente.concluir','PRINCIPAL'),
      ('ABOGADO','expediente.reabrir','PRINCIPAL'),
      ('ABOGADO','expediente.conceder','PRINCIPAL'),
      ('ABOGADO','documento.validar','PRINCIPAL'),
      ('ABOGADO','documento.reactivar','PRINCIPAL'),
      ('ABOGADO','documento.conservar','PRINCIPAL'),
      ('ABOGADO','cliente.consultar','COLABORADOR'),
      ('ABOGADO','cliente.consultar','EXPLICITO'),
      ('ABOGADO','expediente.consultar','COLABORADOR'),
      ('ABOGADO','expediente.consultar','EXPLICITO'),
      ('ABOGADO','expediente.actualizar','COLABORADOR'),
      ('ABOGADO','expediente.actualizar','EXPLICITO'),
      ('ABOGADO','expediente.iniciar','COLABORADOR'),
      ('ABOGADO','expediente.iniciar','EXPLICITO'),
      ('ABOGADO','expediente.suspender','COLABORADOR'),
      ('ABOGADO','expediente.suspender','EXPLICITO'),
      ('ABOGADO','expediente.reanudar','COLABORADOR'),
      ('ABOGADO','expediente.reanudar','EXPLICITO'),
      ('ABOGADO','expediente.archivar','COLABORADOR'),
      ('ABOGADO','expediente.archivar','EXPLICITO'),
      ('ABOGADO','documento.cargar','COLABORADOR'),
      ('ABOGADO','documento.cargar','EXPLICITO'),
      ('ABOGADO','documento.consultar','COLABORADOR'),
      ('ABOGADO','documento.consultar','EXPLICITO'),
      ('ABOGADO','documento.clasificar','COLABORADOR'),
      ('ABOGADO','documento.clasificar','EXPLICITO'),
      ('ABOGADO','documento.asociar','COLABORADOR'),
      ('ABOGADO','documento.asociar','EXPLICITO'),
      ('ABOGADO','documento.actualizar','COLABORADOR'),
      ('ABOGADO','documento.actualizar','EXPLICITO'),
      ('ABOGADO','documento.descargar','COLABORADOR'),
      ('ABOGADO','documento.descargar','EXPLICITO'),
      ('ABOGADO','documento.versiones','COLABORADOR'),
      ('ABOGADO','documento.versiones','EXPLICITO'),
      ('ABOGADO','documento.iniciar_revision','COLABORADOR'),
      ('ABOGADO','documento.iniciar_revision','EXPLICITO'),
      ('ABOGADO','documento.corregir','COLABORADOR'),
      ('ABOGADO','documento.corregir','EXPLICITO'),
      ('ABOGADO','documento.archivar','COLABORADOR'),
      ('ABOGADO','documento.archivar','EXPLICITO'),
      ('ABOGADO','expediente.avanzar','COLABORADOR'),
      ('ABOGADO','expediente.avanzar','EXPLICITO'),
      ('ABOGADO','documento.revisar','COLABORADOR'),
      ('ABOGADO','documento.revisar','EXPLICITO'),
      ('SECRETARIA','cliente.registrar','GLOBAL_OPERATIVO'),
      ('SECRETARIA','expediente.crear','GLOBAL_OPERATIVO'),
      ('SECRETARIA','cliente.consultar','REGISTRO_PROPIO'),
      ('SECRETARIA','cliente.actualizar','REGISTRO_PROPIO'),
      ('ADMINISTRADOR','usuario.administrar','GLOBAL_OPERATIVO'),
      ('ADMINISTRADOR','usuario.permisos','GLOBAL_OPERATIVO'),
      ('ADMINISTRADOR','auditoria.consultar','GLOBAL_OPERATIVO'),
      ('ADMINISTRADOR','configuracion.administrar','GLOBAL_OPERATIVO'),
      ('ADMINISTRADOR','expediente.reasignar','GLOBAL_OPERATIVO'),
      ('ADMINISTRADOR','expediente.metadatos','GLOBAL_OPERATIVO'),
      ('ADMINISTRADOR','documento.metadatos','GLOBAL_OPERATIVO'),
      ('ADMINISTRADOR','documento.recuperar','GLOBAL_OPERATIVO'),
      ('ADMINISTRADOR','respaldo.consultar','GLOBAL_OPERATIVO'),
      ('ADMINISTRADOR','respaldo.solicitar','GLOBAL_OPERATIVO'),
      ('ADMINISTRADOR','respaldo.configurar','GLOBAL_OPERATIVO'),
      ('ADMINISTRADOR','respaldo.restaurar','GLOBAL_OPERATIVO'),
      ('ADMINISTRADOR','respaldo.habilitar','GLOBAL_OPERATIVO')
     ) m(rol,permiso,contexto)
     JOIN kvg.rol r ON r.codigo = m.rol JOIN kvg.permiso p ON p.codigo = m.permiso;
    INSERT INTO kvg.parametro_sistema (parametro_codigo,tipo_valor,valor,regla_validacion,editable,modificado_por)
    VALUES ('sesion.inactividad_minutos','ENTERO','30','Intervalo de 5 a 30 minutos.',true,v_admin),
      ('sesion.duracion_horas','ENTERO','8','Intervalo de 1 a 8 horas.',true,v_admin),
      ('sistema.bloqueado','BOOLEANO','false','Bloqueo operativo de restauración; modificación mediante función específica.',false,v_admin);
    PERFORM kvg_privado.auditar('INICIALIZAR_INSTALACION','SISTEMA',NULL);
    RETURN jsonb_build_object('administrador_usuario_id',v_admin,'responsable_juridico_usuario_id',v_legal);
END;
$func$;

-- 16. Punto de entrada del personal. La identidad del actor nunca procede del JSON.
CREATE FUNCTION public.kvg_operar(p_operacion text,p_datos jsonb DEFAULT '{}')
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

CREATE FUNCTION kvg_privado.historial_parametro_automatico()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $func$
BEGIN
    INSERT INTO kvg.historial_parametro (parametro_codigo,valor_anterior,valor_nuevo,registrado_por,motivo,revision_resultante)
      VALUES (NEW.parametro_codigo,CASE WHEN TG_OP = 'UPDATE' THEN OLD.valor END,NEW.valor,NEW.modificado_por,
       coalesce(nullif(current_setting('kvg.motivo_parametro',true),''),'Cambio autorizado de configuración.'),NEW.revision);
    RETURN NULL;
END;
$func$;

-- 17. Disparadores de integridad y auditoría.
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.cliente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_revision BEFORE UPDATE ON kvg.cliente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.controlar_revision();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.cliente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('cliente_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.tipo_identificacion
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_revision BEFORE UPDATE ON kvg.tipo_identificacion
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.controlar_revision();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.tipo_identificacion
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.identificacion_cliente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.identificacion_cliente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('identificacion_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.contacto_cliente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_revision BEFORE UPDATE ON kvg.contacto_cliente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.controlar_revision();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.contacto_cliente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('contacto_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.estado_expediente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_historial_inmutable BEFORE UPDATE ON kvg.estado_expediente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.estado_expediente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.expediente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_revision BEFORE UPDATE ON kvg.expediente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.controlar_revision();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.expediente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('expediente_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.asignacion_expediente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.asignacion_expediente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('asignacion_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.historial_estado_expediente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_historial_inmutable BEFORE UPDATE ON kvg.historial_estado_expediente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.historial_estado_expediente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('cambio_expediente_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.avance_expediente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_historial_inmutable BEFORE UPDATE ON kvg.avance_expediente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.avance_expediente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('avance_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.avance_version
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_historial_inmutable BEFORE UPDATE ON kvg.avance_version
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.avance_version
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.categoria_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_revision BEFORE UPDATE ON kvg.categoria_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.controlar_revision();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.categoria_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('categoria_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.estado_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_historial_inmutable BEFORE UPDATE ON kvg.estado_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.estado_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_revision BEFORE UPDATE ON kvg.documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.controlar_revision();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('documento_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.historial_asociacion_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_historial_inmutable BEFORE UPDATE ON kvg.historial_asociacion_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.historial_asociacion_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('asociacion_evento_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.carga_archivo
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.carga_archivo
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('carga_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.version_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_revision BEFORE UPDATE ON kvg.version_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.controlar_revision();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.version_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('version_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.revision_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_historial_inmutable BEFORE UPDATE ON kvg.revision_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.revision_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('revision_juridica_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.historial_estado_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_historial_inmutable BEFORE UPDATE ON kvg.historial_estado_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.historial_estado_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('cambio_documento_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.evento_retiro_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_historial_inmutable BEFORE UPDATE ON kvg.evento_retiro_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.evento_retiro_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('retiro_evento_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.medida_conservacion
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_revision BEFORE UPDATE ON kvg.medida_conservacion
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.controlar_revision();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.medida_conservacion
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('medida_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.usuario
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_revision BEFORE UPDATE ON kvg.usuario
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.controlar_revision();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.usuario
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('usuario_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.rol
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_revision BEFORE UPDATE ON kvg.rol
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.controlar_revision();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.rol
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('rol_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.permiso
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.permiso
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('permiso_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.usuario_rol
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.usuario_rol
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('usuario_rol_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.rol_permiso
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_revision BEFORE UPDATE ON kvg.rol_permiso
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.controlar_revision();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.rol_permiso
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.concesion_acceso
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.concesion_acceso
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('concesion_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.concesion_permiso
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_historial_inmutable BEFORE UPDATE ON kvg.concesion_permiso
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.concesion_permiso
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.sesion_aplicacion
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.sesion_aplicacion
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('sesion_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.evento_auditoria
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_historial_inmutable BEFORE UPDATE ON kvg.evento_auditoria
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.trabajo_operativo
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.trabajo_operativo
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('trabajo_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.politica_respaldo
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.politica_respaldo
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('politica_respaldo_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.respaldo
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.respaldo
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('respaldo_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.elemento_manifiesto
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_historial_inmutable BEFORE UPDATE ON kvg.elemento_manifiesto
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.elemento_manifiesto
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.restauracion
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.restauracion
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('restauracion_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.parametro_sistema
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_revision BEFORE UPDATE ON kvg.parametro_sistema
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.controlar_revision();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.parametro_sistema
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.historial_parametro
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_historial_inmutable BEFORE UPDATE ON kvg.historial_parametro
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.historial_parametro
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('parametro_evento_id');
CREATE TRIGGER tr_no_eliminar BEFORE DELETE ON kvg.evento_restriccion
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_historial_inmutable BEFORE UPDATE ON kvg.evento_restriccion
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();
CREATE TRIGGER tr_auditoria AFTER INSERT OR UPDATE ON kvg.evento_restriccion
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.auditar_mutacion('restriccion_evento_id');
CREATE CONSTRAINT TRIGGER tr_responsables AFTER INSERT OR UPDATE ON kvg.expediente
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_responsables();
CREATE CONSTRAINT TRIGGER tr_responsables AFTER INSERT OR UPDATE ON kvg.asignacion_expediente
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_responsables();
CREATE CONSTRAINT TRIGGER tr_responsables AFTER INSERT OR UPDATE ON kvg.usuario
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_responsables();
CREATE CONSTRAINT TRIGGER tr_responsables AFTER INSERT OR UPDATE ON kvg.usuario_rol
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_responsables();
CREATE CONSTRAINT TRIGGER tr_responsables AFTER INSERT OR UPDATE ON kvg.rol_permiso
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_responsables();
CREATE CONSTRAINT TRIGGER tr_resumen_historial AFTER INSERT OR UPDATE ON kvg.expediente
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_resumen_historial();
CREATE CONSTRAINT TRIGGER tr_resumen_historial AFTER INSERT OR UPDATE ON kvg.historial_estado_expediente
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_resumen_historial();
CREATE CONSTRAINT TRIGGER tr_resumen_historial AFTER INSERT OR UPDATE ON kvg.version_documento
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_resumen_historial();
CREATE CONSTRAINT TRIGGER tr_resumen_historial AFTER INSERT OR UPDATE ON kvg.historial_estado_documento
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_resumen_historial();
CREATE CONSTRAINT TRIGGER tr_resumen_historial AFTER INSERT OR UPDATE ON kvg.documento
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_resumen_historial();
CREATE CONSTRAINT TRIGGER tr_resumen_historial AFTER INSERT OR UPDATE ON kvg.historial_asociacion_documento
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_resumen_historial();
CREATE CONSTRAINT TRIGGER tr_resumen_historial AFTER INSERT OR UPDATE ON kvg.evento_retiro_documento
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_resumen_historial();
CREATE TRIGGER tr_referencias BEFORE INSERT ON kvg.avance_version
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_referencias();
CREATE TRIGGER tr_referencias BEFORE INSERT ON kvg.avance_expediente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_referencias();
CREATE TRIGGER tr_referencias BEFORE INSERT ON kvg.revision_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_referencias();
CREATE TRIGGER tr_referencias BEFORE INSERT ON kvg.version_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_referencias();
CREATE TRIGGER tr_referencias BEFORE INSERT ON kvg.historial_estado_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_referencias();
CREATE TRIGGER tr_referencias BEFORE INSERT ON kvg.evento_retiro_documento
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_referencias();
CREATE TRIGGER tr_identificacion BEFORE INSERT OR UPDATE ON kvg.identificacion_cliente
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_identificacion();
CREATE TRIGGER tr_regla_identificacion BEFORE UPDATE ON kvg.tipo_identificacion
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_tipo_identificacion();
CREATE TRIGGER tr_historial_parametro AFTER INSERT OR UPDATE ON kvg.parametro_sistema
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.historial_parametro_automatico();
CREATE TRIGGER tr_manifiesto BEFORE INSERT ON kvg.elemento_manifiesto
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_manifiesto();
CREATE TRIGGER tr_cierre_manifiesto AFTER UPDATE ON kvg.respaldo
 FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_manifiesto();
CREATE CONSTRAINT TRIGGER tr_concesion AFTER INSERT OR UPDATE ON kvg.concesion_acceso
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION kvg_privado.validar_concesion();

-- 18. Políticas RLS. Las escrituras se reservan a funciones verificadas.
ALTER TABLE kvg.cliente ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.cliente FOR SELECT TO authenticated USING (kvg_privado.puede_cliente('cliente.consultar',cliente_id));
ALTER TABLE kvg.tipo_identificacion ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.tipo_identificacion FOR SELECT TO authenticated USING (kvg_privado.usuario_actual() IS NOT NULL);
ALTER TABLE kvg.identificacion_cliente ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.identificacion_cliente FOR SELECT TO authenticated USING (kvg_privado.puede_cliente('cliente.consultar',cliente_id));
ALTER TABLE kvg.contacto_cliente ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.contacto_cliente FOR SELECT TO authenticated USING (kvg_privado.puede_cliente('cliente.consultar',cliente_id));
ALTER TABLE kvg.estado_expediente ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.estado_expediente FOR SELECT TO authenticated USING (kvg_privado.usuario_actual() IS NOT NULL);
ALTER TABLE kvg.expediente ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.expediente FOR SELECT TO authenticated USING (kvg_privado.puede_expediente('expediente.consultar',expediente_id));
ALTER TABLE kvg.asignacion_expediente ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.asignacion_expediente FOR SELECT TO authenticated USING (kvg_privado.puede_expediente('expediente.consultar',expediente_id));
ALTER TABLE kvg.historial_estado_expediente ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.historial_estado_expediente FOR SELECT TO authenticated USING (kvg_privado.puede_expediente('expediente.consultar',expediente_id));
ALTER TABLE kvg.avance_expediente ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.avance_expediente FOR SELECT TO authenticated USING (kvg_privado.puede_expediente('expediente.consultar',expediente_id));
ALTER TABLE kvg.avance_version ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.avance_version FOR SELECT TO authenticated USING (kvg_privado.puede_version('documento.consultar',version_id));
ALTER TABLE kvg.categoria_documento ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.categoria_documento FOR SELECT TO authenticated USING (kvg_privado.usuario_actual() IS NOT NULL);
ALTER TABLE kvg.estado_documento ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.estado_documento FOR SELECT TO authenticated USING (kvg_privado.usuario_actual() IS NOT NULL);
ALTER TABLE kvg.documento ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.documento FOR SELECT TO authenticated USING (kvg_privado.puede_documento('documento.consultar',documento_id));
ALTER TABLE kvg.historial_asociacion_documento ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.historial_asociacion_documento FOR SELECT TO authenticated USING (kvg_privado.puede_documento('documento.consultar',documento_id));
ALTER TABLE kvg.carga_archivo ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.carga_archivo FOR SELECT TO authenticated USING (false);
ALTER TABLE kvg.version_documento ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.version_documento FOR SELECT TO authenticated USING (kvg_privado.puede_version('documento.versiones',version_id));
ALTER TABLE kvg.revision_documento ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.revision_documento FOR SELECT TO authenticated USING (kvg_privado.puede_version('documento.consultar',version_id));
ALTER TABLE kvg.historial_estado_documento ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.historial_estado_documento FOR SELECT TO authenticated USING (kvg_privado.puede_version('documento.versiones',version_id));
ALTER TABLE kvg.evento_retiro_documento ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.evento_retiro_documento FOR SELECT TO authenticated USING (false);
ALTER TABLE kvg.medida_conservacion ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.medida_conservacion FOR SELECT TO authenticated USING (false);
ALTER TABLE kvg.usuario ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.usuario FOR SELECT TO authenticated USING (usuario_id = kvg_privado.usuario_actual() OR kvg_privado.puede_global('usuario.administrar'));
ALTER TABLE kvg.rol ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.rol FOR SELECT TO authenticated USING (false);
ALTER TABLE kvg.permiso ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.permiso FOR SELECT TO authenticated USING (false);
ALTER TABLE kvg.usuario_rol ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.usuario_rol FOR SELECT TO authenticated USING (false);
ALTER TABLE kvg.rol_permiso ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.rol_permiso FOR SELECT TO authenticated USING (false);
ALTER TABLE kvg.concesion_acceso ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.concesion_acceso FOR SELECT TO authenticated USING (false);
ALTER TABLE kvg.concesion_permiso ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.concesion_permiso FOR SELECT TO authenticated USING (false);
ALTER TABLE kvg.sesion_aplicacion ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.sesion_aplicacion FOR SELECT TO authenticated USING (false);
ALTER TABLE kvg.evento_auditoria ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.evento_auditoria FOR SELECT TO authenticated USING (kvg_privado.puede_global('auditoria.consultar'));
ALTER TABLE kvg.trabajo_operativo ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.trabajo_operativo FOR SELECT TO authenticated USING (false);
ALTER TABLE kvg.politica_respaldo ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.politica_respaldo FOR SELECT TO authenticated USING (kvg_privado.puede_global('respaldo.consultar'));
ALTER TABLE kvg.respaldo ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.respaldo FOR SELECT TO authenticated USING (kvg_privado.puede_global('respaldo.consultar'));
ALTER TABLE kvg.elemento_manifiesto ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.elemento_manifiesto FOR SELECT TO authenticated USING (false);
ALTER TABLE kvg.restauracion ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.restauracion FOR SELECT TO authenticated USING (kvg_privado.puede_global('respaldo.consultar'));
ALTER TABLE kvg.parametro_sistema ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.parametro_sistema FOR SELECT TO authenticated USING (kvg_privado.puede_global('configuracion.administrar'));
ALTER TABLE kvg.historial_parametro ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.historial_parametro FOR SELECT TO authenticated USING (false);
ALTER TABLE kvg.evento_restriccion ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_controlada ON kvg.evento_restriccion FOR SELECT TO authenticated USING (false);

-- 19. Almacenamiento privado. Las cargas y descargas se canalizan por el servidor.
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('kvg-cuarentena','kvg-cuarentena',false,20000000,
        ARRAY['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png']),
       ('kvg-originales','kvg-originales',false,20000000,
        ARRAY['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png']);
CREATE POLICY kvg_bloqueo_directo ON storage.objects AS RESTRICTIVE
 FOR ALL TO anon,authenticated
 USING (bucket_id NOT IN ('kvg-cuarentena','kvg-originales'))
 WITH CHECK (bucket_id NOT IN ('kvg-cuarentena','kvg-originales'));

-- 20. Privilegios. Denegación directa de tablas, secretos y funciones internas.
REVOKE ALL ON ALL TABLES IN SCHEMA kvg FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA kvg FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA kvg_privado FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.kvg_operar(text,jsonb) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.kvg_trabajar(text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.kvg_inicializar(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA public TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.kvg_operar(text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kvg_trabajar(text,jsonb) TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA kvg REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA kvg REVOKE ALL ON SEQUENCES FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA kvg_privado REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated,service_role;

COMMENT ON SCHEMA kvg IS 'Modelo físico de gestión documental KVG; acceso mediante funciones verificadas.';
COMMENT ON SCHEMA kvg_privado IS 'Funciones internas de integridad, autorización y operación.';
COMMENT ON COLUMN kvg.trabajo_operativo.detalle_solicitud IS
 'Metadatos restringidos de la solicitud asíncrona: revisión esperada y motivo de recuperación. No contiene credenciales ni archivos.';
COMMENT ON FUNCTION public.kvg_operar(text,jsonb) IS
 'Entrada del personal autenticado. Devuelve correcto, datos o código de rechazo; conserva eventos de fallos fuera de la subtransacción.';
COMMENT ON FUNCTION public.kvg_trabajar(text,jsonb) IS
 'Entrada técnica del trabajador del servidor. Verifica arrendamientos y resultados de procesos externos.';

CREATE TRIGGER tr_revocacion_concesion AFTER UPDATE ON kvg.concesion_acceso FOR EACH ROW EXECUTE FUNCTION kvg_privado.registrar_revocacion_concesion();

COMMIT;
