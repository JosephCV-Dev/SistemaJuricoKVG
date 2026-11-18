-- CU018/CU019: invitación operativa, gestión de personal y autorización por alcance.
BEGIN;
CREATE TABLE kvg_privado.decision_personal (
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid REFERENCES kvg.usuario(usuario_id),
  actor_id uuid NOT NULL REFERENCES kvg.usuario(usuario_id),
  operacion kvg.codigo NOT NULL,
  motivo kvg.texto_2000 NOT NULL,
  referencia kvg.texto_512,
  registrada_en timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE kvg_privado.decision_personal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON kvg_privado.decision_personal FROM PUBLIC,anon,authenticated,service_role,kvg_session_store;
CREATE TRIGGER tr_historial_inmutable BEFORE UPDATE OR DELETE ON kvg_privado.decision_personal
  FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();

ALTER TABLE kvg_privado.solicitud_creacion DROP CONSTRAINT solicitud_creacion_operacion_check;
ALTER TABLE kvg_privado.solicitud_creacion ADD CONSTRAINT solicitud_creacion_operacion_check
  CHECK (operacion IN ('cliente.registrar','expediente.crear','expediente.avanzar','documento.revisar','usuario.invitar'));

CREATE FUNCTION kvg_privado.perfil_personal(p_usuario kvg.usuario)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $f$
  SELECT jsonb_build_object('usuario_id',p_usuario.usuario_id,'nombre',p_usuario.nombre,
    'correo_operativo',p_usuario.correo_operativo,'estado_cuenta',p_usuario.estado_cuenta,'revision',p_usuario.revision);
$f$;

CREATE FUNCTION kvg_privado.accesos_personal(p_usuario uuid,p_caso uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $f$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',q.concesion_id,'folio',q.folio_interno,
    'nombre',q.nombre,'vence',q.expira_en,'permisos',q.permisos) ORDER BY q.inicia_en DESC,q.concesion_id),'[]')
  FROM (
    SELECT c.concesion_id,e.folio_interno,u.nombre,c.expira_en,c.inicia_en,
      (SELECT coalesce(jsonb_agg(p.codigo ORDER BY p.codigo),'[]') FROM kvg.concesion_permiso cp
        JOIN kvg.permiso p USING(permiso_id) WHERE cp.concesion_id=c.concesion_id
          AND kvg_privado.capacidad(c.usuario_id,p.codigo,'EXPLICITO')) AS permisos
    FROM kvg.concesion_acceso c JOIN kvg.expediente e USING(expediente_id) JOIN kvg.usuario u USING(usuario_id)
    WHERE (p_usuario IS NULL OR c.usuario_id=p_usuario) AND (p_caso IS NULL OR c.expediente_id=p_caso)
      AND c.revocado_en IS NULL AND c.inicia_en<=clock_timestamp()
      AND (c.expira_en IS NULL OR c.expira_en>clock_timestamp())
  ) q;
$f$;

CREATE FUNCTION kvg_privado.gestion_personal(p_operacion text,p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE actor uuid:=kvg_privado.usuario_actual(); salida jsonb; persona kvg.usuario;
  id uuid:=(p_datos->>'usuario_id')::uuid; caso uuid:=(p_datos->>'expediente_id')::uuid;
  correo text:=lower(btrim(p_datos->>'correo')); nombre text:=btrim(p_datos->>'nombre');
  motivo text:=btrim(p_datos->>'motivo'); filtro text:=lower(btrim(coalesce(p_datos->>'texto','')));
  solicitud uuid; huella text; previa kvg_privado.solicitud_creacion;
BEGIN
  IF p_operacion='seguridad.accesos_expediente' THEN
    PERFORM kvg_privado.validar_campos(p_datos,ARRAY['expediente_id','correo']);
    PERFORM kvg_privado.exigir(kvg_privado.rol_vigente(actor,'ABOGADO')
      AND kvg_privado.puede_expediente('expediente.consultar',caso)
      AND kvg_privado.puede_expediente('expediente.conceder',caso));
    SELECT * INTO persona FROM kvg.usuario u WHERE correo_operativo=correo AND usuario_id<>actor AND estado_cuenta='ACTIVO'
      AND EXISTS (SELECT 1 FROM kvg.permiso p WHERE kvg_privado.capacidad(u.usuario_id,p.codigo,'EXPLICITO'));
    SELECT jsonb_build_object('usuario',CASE WHEN persona.usuario_id IS NOT NULL THEN jsonb_build_object(
      'id',persona.usuario_id,'nombre',persona.nombre) END,'permisos',coalesce((
      SELECT jsonb_agg(p.codigo ORDER BY p.codigo) FROM kvg.permiso p
      WHERE kvg_privado.capacidad(persona.usuario_id,p.codigo,'EXPLICITO')),'[]'),
      'concesiones',kvg_privado.accesos_personal(NULL,caso)) INTO salida;
    RETURN salida;
  ELSIF p_operacion='seguridad.consultar_matriz' THEN
    PERFORM kvg_privado.validar_campos(p_datos,ARRAY['rol','limite','desplazamiento']);
    PERFORM kvg_privado.exigir(kvg_privado.puede_global('usuario.permisos'));
    SELECT jsonb_build_object('puede_editar',kvg_privado.rol_vigente(actor,'ABOGADO'),
      'capacidades',coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.permiso,q.contexto),'[]')) INTO salida
    FROM (SELECT r.codigo AS rol,p.codigo AS permiso,rp.contexto,rp.activo,rp.revision
      FROM kvg.rol_permiso rp JOIN kvg.rol r USING(rol_id) JOIN kvg.permiso p USING(permiso_id)
      WHERE r.codigo=p_datos->>'rol' AND r.activo AND p.activo
      ORDER BY p.codigo,rp.contexto LIMIT least(greatest(coalesce((p_datos->>'limite')::integer,25),1),51)
      OFFSET least(greatest(coalesce((p_datos->>'desplazamiento')::integer,0),0),10000)) q;
    RETURN salida;
  END IF;

  IF p_operacion IN ('usuario.listar','usuario.detalle') THEN
    PERFORM kvg_privado.exigir(kvg_privado.puede_global('usuario.administrar') OR kvg_privado.puede_global('usuario.permisos'));
    IF p_operacion='usuario.listar' THEN
      PERFORM kvg_privado.validar_campos(p_datos,ARRAY['texto','limite','desplazamiento']);
      IF length(filtro)>200 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Filtro inválido.'; END IF;
      SELECT coalesce(jsonb_agg(kvg_privado.perfil_personal(q.u) ORDER BY q.nombre,q.id),'[]') INTO salida
      FROM (SELECT u AS u,u.nombre,u.usuario_id AS id FROM kvg.usuario u
        WHERE filtro='' OR strpos(lower(u.nombre),filtro)>0 OR strpos(u.correo_operativo,filtro)>0
        ORDER BY u.nombre,u.usuario_id LIMIT least(greatest(coalesce((p_datos->>'limite')::integer,25),1),51)
        OFFSET least(greatest(coalesce((p_datos->>'desplazamiento')::integer,0),0),10000)) q;
      RETURN salida;
    END IF;
    PERFORM kvg_privado.validar_campos(p_datos,ARRAY['usuario_id']);
    SELECT * INTO persona FROM kvg.usuario WHERE usuario_id=id;
    PERFORM kvg_privado.exigir(persona.usuario_id IS NOT NULL);
    RETURN kvg_privado.perfil_personal(persona)||jsonb_build_object(
      'roles',coalesce((SELECT jsonb_agg(r.codigo ORDER BY r.codigo) FROM kvg.usuario_rol ur JOIN kvg.rol r USING(rol_id)
        WHERE ur.usuario_id=id AND r.activo AND ur.inicia_en<=clock_timestamp()
          AND (ur.finaliza_en IS NULL OR ur.finaliza_en>clock_timestamp())),'[]'),
      'concesiones',CASE WHEN kvg_privado.puede_global('usuario.permisos') THEN kvg_privado.accesos_personal(id,NULL) ELSE '[]'::jsonb END,
      'requiere_relevo',EXISTS (SELECT 1 FROM kvg.asignacion_expediente a JOIN kvg.expediente e USING(expediente_id)
        WHERE a.abogado_id=id AND a.funcion='PRINCIPAL' AND a.finaliza_en IS NULL
          AND e.estado_expediente_codigo IN ('NUEVO','EN_PROCESO','PENDIENTE')));
  END IF;

  PERFORM kvg_privado.exigir(kvg_privado.puede_global('usuario.administrar'));
  IF p_operacion='usuario.identidad_desactivada' THEN
    PERFORM kvg_privado.validar_campos(p_datos,ARRAY['usuario_id']);
    SELECT * INTO persona FROM kvg.usuario WHERE usuario_id=id AND estado_cuenta='DESACTIVADO';
    PERFORM kvg_privado.exigir(persona.usuario_id IS NOT NULL);
    RETURN jsonb_build_object('auth_id',persona.auth_usuario_id);
  END IF;
  IF p_operacion='usuario.destino_invitacion' THEN
    PERFORM kvg_privado.validar_campos(p_datos,ARRAY['usuario_id']);
    SELECT * INTO persona FROM kvg.usuario u WHERE u.usuario_id=id AND u.estado_cuenta='INVITADO'
      AND EXISTS (SELECT 1 FROM kvg.trabajo_operativo t WHERE t.objetivo_id=id AND t.tipo='CONCILIAR_IDENTIDAD'
        AND t.detalle_solicitud @> '{"invitacion_email":true}');
    PERFORM kvg_privado.exigir(persona.usuario_id IS NOT NULL);
    PERFORM kvg_privado.auditar('ENVIO_INVITACION_SOLICITADO','USUARIO',id,'RECIBIDO');
    RETURN jsonb_build_object('correo',persona.correo_operativo);
  END IF;

  PERFORM kvg_privado.validar_campos(p_datos,ARRAY['nombre','correo','motivo','solicitud_id']);
  solicitud:=(p_datos->>'solicitud_id')::uuid;
  IF solicitud IS NULL OR jsonb_typeof(p_datos->'nombre') IS DISTINCT FROM 'string'
    OR coalesce(length(nombre),0) NOT BETWEEN 1 AND 200 OR jsonb_typeof(p_datos->'motivo') IS DISTINCT FROM 'string'
    OR coalesce(length(motivo),0) NOT BETWEEN 1 AND 2000 OR motivo !~ '[^[:space:]]'
    OR jsonb_typeof(p_datos->'correo') IS DISTINCT FROM 'string' OR length(correo)>254
    OR correo !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Datos de invitación inválidos.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('kvg:seguridad',0));
  PERFORM kvg_privado.exigir(kvg_privado.puede_global('usuario.administrar'));
  huella:=encode(extensions.digest(jsonb_build_array(nombre,correo,motivo)::text,'sha256'),'hex');
  SELECT * INTO previa FROM kvg_privado.solicitud_creacion
    WHERE usuario_id=actor AND operacion=p_operacion AND solicitud_id=solicitud;
  IF FOUND THEN
    IF previa.contenido_sha256<>huella THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Solicitud reutilizada.'; END IF;
    SELECT * INTO persona FROM kvg.usuario WHERE usuario_id=previa.recurso_id;
    RETURN kvg_privado.perfil_personal(persona);
  END IF;
  IF EXISTS (SELECT 1 FROM kvg.usuario u WHERE correo_operativo=correo)
    OR EXISTS (SELECT 1 FROM auth.users a WHERE lower(a.email)=correo) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='El correo ya está registrado.';
  END IF;
  INSERT INTO kvg.usuario (nombre,correo_operativo,creado_por) VALUES (nombre,correo,actor) RETURNING * INTO persona;
  INSERT INTO kvg.trabajo_operativo (tipo,objetivo_tipo,objetivo_id,clave_idempotencia,solicitado_por,correlacion_id,detalle_solicitud)
    VALUES ('CONCILIAR_IDENTIDAD','USUARIO',persona.usuario_id,'identidad:'||persona.usuario_id,actor,gen_random_uuid(),
      jsonb_build_object('invitacion_email',true));
  INSERT INTO kvg_privado.solicitud_creacion (usuario_id,operacion,solicitud_id,contenido_sha256,recurso_id)
    VALUES (actor,p_operacion,solicitud,huella,persona.usuario_id);
  INSERT INTO kvg_privado.decision_personal (usuario_id,actor_id,operacion,motivo)
    VALUES (persona.usuario_id,actor,'INVITAR_USUARIO',motivo);
  PERFORM kvg_privado.auditar('INVITACION_RESERVADA','USUARIO',persona.usuario_id,'RECIBIDO');
  RETURN kvg_privado.perfil_personal(persona);
END;
$f$;

-- El correo, la fecha de invitación y la sesión proceden de Auth; los metadatos del navegador no intervienen.
CREATE FUNCTION kvg_privado.perfil_invitado()
RETURNS uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $f$
  SELECT u.usuario_id FROM kvg.usuario u JOIN auth.users a ON lower(a.email)=u.correo_operativo
  JOIN kvg.trabajo_operativo t ON t.objetivo_id=u.usuario_id AND t.tipo='CONCILIAR_IDENTIDAD'
  WHERE a.id=auth.uid() AND a.invited_at>=t.creado_en AND a.email_confirmed_at>=a.invited_at
    AND u.estado_cuenta='INVITADO' AND u.auth_usuario_id IS NULL
    AND t.detalle_solicitud @> '{"invitacion_email":true}'
    AND t.estado IN ('EN_COLA','EN_EJECUCION','FALLIDO')
    AND auth.jwt()->>'aal' IN ('aal1','aal2')
    AND NOT coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
    AND EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id::text=auth.jwt()->>'session_id' AND s.user_id=a.id)
    AND NOT EXISTS (SELECT 1 FROM kvg.parametro_sistema WHERE parametro_codigo='sistema.bloqueado' AND valor='true')
  LIMIT 1;
$f$;

CREATE FUNCTION kvg_privado.activar_perfil_invitado()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE id uuid;
BEGIN
  PERFORM kvg_privado.exigir(auth.jwt()->>'aal'='aal2');
  PERFORM pg_advisory_xact_lock(hashtextextended('kvg:seguridad',0));
  id:=kvg_privado.perfil_invitado();
  IF id IS NULL THEN RETURN NULL; END IF;
  UPDATE kvg.usuario SET auth_usuario_id=auth.uid(),estado_cuenta='ACTIVO',
    revision_autorizacion=revision_autorizacion+1 WHERE usuario_id=id;
  UPDATE kvg.trabajo_operativo SET estado='COMPLETADO',finalizado_en=clock_timestamp(),resultado_codigo='INVITACION_ACTIVADA',
    ejecutor_codigo=NULL,bloqueo_hasta=NULL WHERE objetivo_id=id AND tipo='CONCILIAR_IDENTIDAD';
  PERFORM kvg_privado.auditar('INVITACION_ACTIVADA','USUARIO',id);
  RETURN id;
END;
$f$;

CREATE FUNCTION kvg_privado.preparar_decision_personal(p_operacion text,p_datos jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE id uuid:=(p_datos->>'usuario_id')::uuid; actor uuid:=kvg_privado.usuario_actual();
  persona kvg.usuario; motivo text:=btrim(p_datos->>'motivo'); referencia text:=btrim(p_datos->>'referencia_autorizacion');
  cambio_rol boolean:=p_operacion IN ('seguridad.otorgar_rol','seguridad.revocar_rol');
  matriz boolean:=p_operacion='seguridad.matriz';
BEGIN
  PERFORM kvg_privado.exigir(kvg_privado.puede_global(CASE WHEN cambio_rol OR matriz THEN 'usuario.permisos' ELSE 'usuario.administrar' END));
  IF jsonb_typeof(p_datos->'motivo') IS DISTINCT FROM 'string' OR coalesce(length(motivo),0) NOT BETWEEN 1 AND 2000
    OR motivo !~ '[^[:space:]]' OR jsonb_typeof(p_datos->'revision') IS DISTINCT FROM 'number'
    OR ((cambio_rol OR matriz) AND (jsonb_typeof(p_datos->'referencia_autorizacion') IS DISTINCT FROM 'string'
        OR coalesce(length(referencia),0) NOT BETWEEN 1 AND 512 OR referencia !~ '[^[:space:]]')) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Motivo, revisión o autorización inválidos.';
  END IF;
  IF matriz THEN
    PERFORM kvg_privado.exigir(kvg_privado.rol_vigente(actor,'ABOGADO'));
    IF jsonb_typeof(p_datos->'activo') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Estado de capacidad inválido.';
    END IF;
  ELSE
    SELECT * INTO persona FROM kvg.usuario WHERE usuario_id=id FOR UPDATE;
    PERFORM kvg_privado.exigir(persona.usuario_id IS NOT NULL AND persona.estado_cuenta<>'DESACTIVADO');
    PERFORM kvg_privado.exigir_revision(persona.revision,(p_datos->>'revision')::integer);
    IF p_operacion='usuario.editar' AND (jsonb_typeof(p_datos->'nombre') IS DISTINCT FROM 'string'
      OR coalesce(length(btrim(p_datos->>'nombre')),0) NOT BETWEEN 1 AND 200) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Nombre inválido.';
    END IF;
    IF (p_operacion='usuario.desactivar' OR (p_operacion='seguridad.revocar_rol' AND p_datos->>'rol'='ABOGADO'))
      AND EXISTS (SELECT 1 FROM kvg.asignacion_expediente a JOIN kvg.expediente e USING(expediente_id)
        WHERE a.abogado_id=id AND a.funcion='PRINCIPAL' AND a.finaliza_en IS NULL
        AND e.estado_expediente_codigo IN ('NUEVO','EN_PROCESO','PENDIENTE')) THEN
      RAISE EXCEPTION USING ERRCODE='KVG01',MESSAGE='Reasigna primero los expedientes a su cargo.';
    END IF;
    IF cambio_rol THEN
      PERFORM kvg_privado.exigir(id<>actor);
      IF p_operacion='seguridad.otorgar_rol' AND EXISTS (SELECT 1 FROM kvg.usuario_rol ur JOIN kvg.rol r USING(rol_id)
        WHERE ur.usuario_id=id AND r.codigo=p_datos->>'rol' AND ur.finaliza_en IS NULL) THEN
        RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='El usuario ya tiene ese rol.';
      END IF;
    END IF;
  END IF;
  INSERT INTO kvg_privado.decision_personal (usuario_id,actor_id,operacion,motivo,referencia)
    VALUES (id,actor,upper(replace(p_operacion,'.','_')),motivo,referencia);
END;
$f$;

REVOKE ALL ON FUNCTION kvg_privado.perfil_personal(kvg.usuario),kvg_privado.accesos_personal(uuid,uuid),
  kvg_privado.gestion_personal(text,jsonb),kvg_privado.perfil_invitado(),kvg_privado.activar_perfil_invitado(),
  kvg_privado.preparar_decision_personal(text,jsonb) FROM PUBLIC,anon,authenticated,service_role,kvg_session_store;

DO $patch$
DECLARE src text;
BEGIN
 SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='kvg_privado.administracion(text,jsonb)'::regprocedure;
 IF strpos(src,$s$    IF p_operacion = 'usuario.registrar' THEN$s$)=0
   OR strpos(src,$s$ARRAY['usuario_id','rol','motivo']$s$)=0 THEN RAISE EXCEPTION 'Contrato de personal no reconocido.'; END IF;
 src:=replace(src,$s$    IF p_operacion = 'usuario.registrar' THEN$s$,$s$
    IF p_operacion IN ('usuario.invitar','usuario.listar','usuario.detalle','usuario.destino_invitacion','usuario.identidad_desactivada',
        'seguridad.consultar_matriz','seguridad.accesos_expediente') THEN
        RETURN kvg_privado.gestion_personal(p_operacion,p_datos);
    END IF;
    IF p_operacion IN ('usuario.editar','usuario.desactivar','seguridad.otorgar_rol','seguridad.revocar_rol','seguridad.matriz') THEN
        PERFORM kvg_privado.preparar_decision_personal(p_operacion,p_datos);
    END IF;
    IF p_operacion = 'usuario.registrar' THEN$s$);
 src:=replace(src,$s$ARRAY['usuario_id','rol','motivo']$s$,$s$ARRAY['usuario_id','rol','motivo','revision','referencia_autorizacion']$s$);
 src:=replace(src,$s$ARRAY['rol','permiso','contexto','activo','revision','referencia_autorizacion']$s$,
   $s$ARRAY['rol','permiso','contexto','activo','revision','referencia_autorizacion','motivo']$s$);
 src:=replace(src,$s$        SELECT * INTO v_concesion FROM kvg.concesion_acceso WHERE concesion_id = v_id FOR UPDATE;
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('usuario.permisos') OR$s$,$s$
        SELECT * INTO v_concesion FROM kvg.concesion_acceso WHERE concesion_id = v_id FOR UPDATE;
        PERFORM kvg_privado.exigir(v_concesion.concesion_id IS NOT NULL AND v_concesion.revocado_en IS NULL
          AND (v_concesion.expira_en IS NULL OR v_concesion.expira_en>clock_timestamp()));
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('usuario.permisos') OR$s$);
 src:=replace(src,$s$            UPDATE kvg.usuario SET nombre = p_datos->>'nombre'$s$,$s$            UPDATE kvg.usuario SET nombre = btrim(p_datos->>'nombre')$s$);
 src:=replace(src,$s$        RETURN to_jsonb(v_usuario) - 'auth_usuario_id';
    ELSIF p_operacion = 'usuario.listar' THEN$s$,$s$
        RETURN kvg_privado.perfil_personal(v_usuario)
          || CASE WHEN p_operacion='usuario.desactivar' THEN jsonb_build_object('auth_id',v_usuario.auth_usuario_id) ELSE '{}'::jsonb END;
    ELSIF p_operacion = 'usuario.listar' THEN$s$);
 EXECUTE 'CREATE OR REPLACE FUNCTION kvg_privado.administracion(p_operacion text,p_datos jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);
 SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='kvg_privado.validar_responsables()'::regprocedure;
 IF strpos(src,$s$WHERE kvg_privado.capacidad(u.usuario_id,'usuario.administrar','GLOBAL_OPERATIVO')) THEN$s$)=0 THEN
   RAISE EXCEPTION 'Protección de administración no reconocida.';
 END IF;
 src:=replace(src,$s$WHERE kvg_privado.capacidad(u.usuario_id,'usuario.administrar','GLOBAL_OPERATIVO')) THEN$s$,$s$
      WHERE kvg_privado.capacidad(u.usuario_id,'usuario.administrar','GLOBAL_OPERATIVO')
        AND kvg_privado.capacidad(u.usuario_id,'usuario.permisos','GLOBAL_OPERATIVO')) THEN$s$);
 src:=replace(src,$s$ERRCODE = '23514', MESSAGE = 'Debe conservarse al menos una administración operativa.'$s$,
   $s$ERRCODE = 'KVG02', MESSAGE = 'Debe conservarse al menos una administración operativa.'$s$);
 EXECUTE 'CREATE OR REPLACE FUNCTION kvg_privado.validar_responsables() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);
 SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='kvg_privado.iniciar_sesion()'::regprocedure;
 IF strpos(src,$s$    v_auth := auth.jwt()->>'session_id';$s$)=0 THEN RAISE EXCEPTION 'Inicio de sesión no reconocido.'; END IF;
 src:=replace(src,$s$    v_auth := auth.jwt()->>'session_id';$s$,$s$
    IF v_usuario IS NULL THEN v_usuario:=kvg_privado.activar_perfil_invitado(); END IF;
    v_auth := auth.jwt()->>'session_id';$s$);
 EXECUTE 'CREATE OR REPLACE FUNCTION kvg_privado.iniciar_sesion() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);
 SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='public.kvg_operar(text,jsonb)'::regprocedure;
 IF strpos(src,$s$        IF p_operacion = 'sesion.iniciar' THEN$s$)=0 THEN RAISE EXCEPTION 'Entrada de sesión no reconocida.'; END IF;
 src:=replace(src,$s$        IF p_operacion = 'sesion.iniciar' THEN$s$,$s$
        IF p_operacion='identidad.validar_invitacion' THEN
            PERFORM kvg_privado.validar_campos(p_datos,ARRAY[]::text[]);
            PERFORM kvg_privado.exigir(kvg_privado.perfil_invitado() IS NOT NULL);
            v_salida:='{}'::jsonb;
        ELSIF p_operacion = 'sesion.iniciar' THEN$s$);
 EXECUTE 'CREATE OR REPLACE FUNCTION public.kvg_operar(p_operacion text,p_datos jsonb DEFAULT ''{}'') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);
END;
$patch$;
COMMIT;
