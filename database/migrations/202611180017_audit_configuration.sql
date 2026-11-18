-- CU020/CU021. Proyecciones de bitácora y cambios de configuración trazables.
BEGIN;
CREATE TABLE kvg_privado.cambio_catalogo (
  cambio_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalogo text NOT NULL CHECK (catalogo IN ('CATEGORIA','IDENTIFICACION')),
  referencia kvg.texto_128 NOT NULL,
  revision integer NOT NULL CHECK (revision>0),
  actor_id uuid NOT NULL REFERENCES kvg.usuario,
  motivo kvg.texto_2000 NOT NULL,
  registrado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(catalogo,referencia,revision)
);
ALTER TABLE kvg_privado.cambio_catalogo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON kvg_privado.cambio_catalogo FROM PUBLIC,anon,authenticated,service_role,kvg_session_store;
CREATE TRIGGER tr_historial_inmutable BEFORE UPDATE OR DELETE ON kvg_privado.cambio_catalogo
  FOR EACH ROW EXECUTE FUNCTION kvg_privado.prohibir_modificacion();

CREATE FUNCTION kvg_privado.consultar_bitacora(p_operacion text,p_datos jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE salida jsonb; id uuid; corte timestamptz; cursor_id uuid; desde timestamptz; hasta timestamptz;
  v_actor_filtro text:=btrim(coalesce(p_datos->>'actor','')); v_accion_filtro text:=btrim(coalesce(p_datos->>'accion',''));
  v_recurso_filtro text:=btrim(coalesce(p_datos->>'recurso','')); v_resultado text:=p_datos->>'resultado';
BEGIN
  PERFORM kvg_privado.exigir(kvg_privado.puede_global('auditoria.consultar'));
  IF p_operacion='auditoria.detalle' THEN
    PERFORM kvg_privado.validar_campos(p_datos,ARRAY['evento_id']);
    id:=(p_datos->>'evento_id')::uuid;
    SELECT jsonb_build_object('evento_id',a.evento_id,'ocurrido_en',a.ocurrido_en,
      'tipo_actor',a.tipo_actor,'usuario_id',a.usuario_id,'actor',coalesce(u.nombre,a.servicio_codigo),
      'accion',a.accion,'recurso_tipo',a.recurso_tipo,'recurso_id',a.recurso_id,
      'resultado',a.resultado,'correlacion_id',a.correlacion_id,
      'revision',CASE WHEN jsonb_typeof(a.detalle_controlado->'revision')='number' THEN a.detalle_controlado->'revision' END,
      'cantidad',CASE WHEN jsonb_typeof(a.detalle_controlado->'cantidad')='number' THEN a.detalle_controlado->'cantidad' END)
    INTO salida FROM kvg.evento_auditoria a LEFT JOIN kvg.usuario u USING(usuario_id) WHERE a.evento_id=id;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Evento no disponible.'; END IF;
    PERFORM kvg_privado.auditar('AUDITORIA_DETALLE_CONSULTADO','AUDITORIA',id);
    RETURN salida;
  END IF;
  PERFORM kvg_privado.validar_campos(p_datos,ARRAY['desde','hasta','limite','desplazamiento','actor','accion','recurso','resultado','antes_de','antes_id']);
  desde:=(p_datos->>'desde')::timestamptz;
  hasta:=(p_datos->>'hasta')::timestamptz;
  corte:=(p_datos->>'antes_de')::timestamptz;
  cursor_id:=(p_datos->>'antes_id')::uuid;
  IF desde>=hasta OR (corte IS NULL)<>(cursor_id IS NULL) OR length(v_actor_filtro)>200 OR length(v_accion_filtro)>64 OR length(v_recurso_filtro)>64
    OR (v_resultado IS NOT NULL AND v_resultado NOT IN ('EXITO','DENEGADO','FALLIDO','RECIBIDO')) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Filtros de bitácora inválidos.';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.ocurrido_en DESC,q.evento_id DESC),'[]') INTO salida FROM (
    SELECT a.evento_id,a.ocurrido_en,a.tipo_actor,a.usuario_id,coalesce(u.nombre,a.servicio_codigo) AS actor,
      a.accion,a.recurso_tipo,a.recurso_id,a.resultado,a.correlacion_id
    FROM kvg.evento_auditoria a LEFT JOIN kvg.usuario u USING(usuario_id)
    WHERE (desde IS NULL OR a.ocurrido_en>=desde) AND (hasta IS NULL OR a.ocurrido_en<hasta)
      AND (corte IS NULL OR (a.ocurrido_en,a.evento_id)<(corte,cursor_id))
      AND (v_actor_filtro='' OR strpos(lower(coalesce(u.nombre,a.servicio_codigo,a.tipo_actor)),lower(v_actor_filtro))>0 OR a.usuario_id::text=lower(v_actor_filtro))
      AND (v_accion_filtro='' OR strpos(lower(a.accion),lower(v_accion_filtro))>0)
      AND (v_recurso_filtro='' OR strpos(lower(a.recurso_tipo),lower(v_recurso_filtro))>0 OR a.recurso_id::text=lower(v_recurso_filtro))
      AND (v_resultado IS NULL OR a.resultado=v_resultado)
    ORDER BY a.ocurrido_en DESC,a.evento_id DESC
    LIMIT least(greatest(coalesce((p_datos->>'limite')::integer,20),1),51)
    OFFSET least(greatest(coalesce((p_datos->>'desplazamiento')::integer,0),0),10000)
  ) q;
  PERFORM kvg_privado.auditar('AUDITORIA_CONSULTAR','AUDITORIA',NULL);
  RETURN salida;
END;
$f$;

CREATE FUNCTION kvg_privado.validar_cambio_catalogo(p_operacion text,p_datos jsonb)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $f$
DECLARE motivo text:=btrim(p_datos->>'motivo'); categoria boolean:=p_operacion='configuracion.categoria';
BEGIN
  PERFORM kvg_privado.exigir(kvg_privado.puede_global('configuracion.administrar'));
  IF jsonb_typeof(p_datos->'motivo') IS DISTINCT FROM 'string' OR length(motivo)>2000 OR motivo !~ '[^[:space:]]'
    OR (p_datos ? 'nombre' AND (jsonb_typeof(p_datos->'nombre') IS DISTINCT FROM 'string'
      OR coalesce(length(btrim(p_datos->>'nombre')),0) NOT BETWEEN 1 AND 200))
    OR (p_datos ? 'codigo' AND (jsonb_typeof(p_datos->'codigo') IS DISTINCT FROM 'string'
      OR (p_datos->>'codigo') !~ '^[A-Z][A-Z0-9_]{0,63}$'))
    OR (p_datos ? 'revision' AND jsonb_typeof(p_datos->'revision') IS DISTINCT FROM 'number')
    OR (p_datos ? 'activo' AND jsonb_typeof(p_datos->'activo') IS DISTINCT FROM 'boolean')
    OR (p_datos ? 'unicidad' AND jsonb_typeof(p_datos->'unicidad') IS DISTINCT FROM 'boolean')
    OR (p_datos ? 'descripcion' AND (jsonb_typeof(p_datos->'descripcion') NOT IN ('string','null')
      OR length(p_datos->>'descripcion')>2000))
    OR (categoria AND p_datos->>'categoria_id' IS NOT NULL AND p_datos ? 'codigo')
    OR (NOT categoria AND (p_datos ? 'revision') AND (p_datos ?| ARRAY['regla','unicidad'])) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Datos de catálogo inválidos.';
  END IF;
END;
$f$;

REVOKE ALL ON FUNCTION kvg_privado.consultar_bitacora(text,jsonb),kvg_privado.validar_cambio_catalogo(text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role,kvg_session_store;

DO $patch$
DECLARE src text;
BEGIN
  SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='kvg_privado.administracion(text,jsonb)'::regprocedure;
  IF strpos(src,$s$    ELSIF p_operacion = 'auditoria.consultar' THEN$s$)=0
    OR strpos(src,$s$    ELSIF p_operacion = 'configuracion.consultar' THEN$s$)=0
    OR strpos(src,$s$              VALUES (p_datos->>'codigo',p_datos->>'nombre',p_datos->>'regla'$s$)=0 THEN
    RAISE EXCEPTION 'Contrato de administración no reconocido.';
  END IF;
  src:=left(src,strpos(src,$s$    ELSIF p_operacion = 'auditoria.consultar' THEN$s$)-1)||$s$
    ELSIF p_operacion IN ('auditoria.consultar','auditoria.detalle') THEN
        RETURN kvg_privado.consultar_bitacora(p_operacion,p_datos);
    END IF;
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Operación administrativa no admitida.';
END;
$s$;
  src:=replace(src,$s$    ELSIF p_operacion = 'configuracion.consultar' THEN$s$,$s$
    ELSIF p_operacion = 'configuracion.catalogos' THEN
        PERFORM kvg_privado.validar_campos(p_datos,ARRAY[]::text[]);
        PERFORM kvg_privado.exigir(kvg_privado.puede_global('configuracion.administrar'));
        RETURN jsonb_build_object(
          'parametros',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.parametro_codigo) FROM kvg.parametro_sistema p),'[]'),
          'categorias',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.codigo) FROM kvg.categoria_documento c),'[]'),
          'identificaciones',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.tipo_identificacion_codigo) FROM kvg.tipo_identificacion t),'[]'));
    ELSIF p_operacion = 'configuracion.consultar' THEN$s$);
  src:=replace(src,$s$ARRAY['categoria_id','codigo','nombre','descripcion','activo','revision']$s$,
    $s$ARRAY['categoria_id','codigo','nombre','descripcion','activo','revision','motivo']$s$);
  src:=replace(src,$s$ARRAY['codigo','nombre','regla','unicidad','activo','revision']$s$,
    $s$ARRAY['codigo','nombre','regla','unicidad','activo','revision','motivo']$s$);
  src:=replace(src,$s$        IF p_datos->>'categoria_id' IS NULL THEN$s$,$s$
        PERFORM kvg_privado.validar_cambio_catalogo(p_operacion,p_datos);
        IF p_datos->>'categoria_id' IS NULL THEN
            PERFORM kvg_privado.exigir(NOT (p_datos ?| ARRAY['revision','activo']));$s$);
  src:=replace(src,$s$VALUES (p_datos->>'codigo',p_datos->>'nombre',p_datos->>'descripcion')$s$,
    $s$VALUES (p_datos->>'codigo',btrim(p_datos->>'nombre'),nullif(btrim(p_datos->>'descripcion'),''))$s$);
  src:=replace(src,$s$UPDATE kvg.categoria_documento SET nombre = coalesce(p_datos->>'nombre',nombre),$s$,
    $s$UPDATE kvg.categoria_documento SET nombre = coalesce(btrim(p_datos->>'nombre'),nombre),$s$);
  src:=replace(src,$s$descripcion = CASE WHEN p_datos ? 'descripcion' THEN p_datos->>'descripcion' ELSE descripcion END,$s$,
    $s$descripcion = CASE WHEN p_datos ? 'descripcion' THEN nullif(btrim(p_datos->>'descripcion'),'') ELSE descripcion END,$s$);
  src:=replace(src,$s$        RETURN to_jsonb(v_categoria);$s$,$s$
        INSERT INTO kvg_privado.cambio_catalogo(catalogo,referencia,revision,actor_id,motivo)
          VALUES ('CATEGORIA',v_categoria.categoria_id::text,v_categoria.revision,v_actor,btrim(p_datos->>'motivo'))
          ON CONFLICT(catalogo,referencia,revision) DO NOTHING;
        RETURN to_jsonb(v_categoria);$s$);
  src:=replace(src,$s$        SELECT * INTO v_tipo FROM kvg.tipo_identificacion WHERE tipo_identificacion_codigo = p_datos->>'codigo' FOR UPDATE;$s$,$s$
        PERFORM kvg_privado.validar_cambio_catalogo(p_operacion,p_datos);
        SELECT * INTO v_tipo FROM kvg.tipo_identificacion WHERE tipo_identificacion_codigo = p_datos->>'codigo' FOR UPDATE;
        IF FOUND AND NOT (p_datos ? 'revision') THEN
            RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='El tipo de identificación ya existe.';
        END IF;
        IF NOT FOUND AND (p_datos ?| ARRAY['revision','activo']) THEN
            RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Tipo de identificación no disponible.';
        END IF;$s$);
  -- FOUND se conserva: los IF anteriores no ejecutan sentencias si no hay error.
  src:=replace(src,$s$VALUES (p_datos->>'codigo',p_datos->>'nombre',p_datos->>'regla'$s$,
    $s$VALUES (p_datos->>'codigo',btrim(p_datos->>'nombre'),p_datos->>'regla'$s$);
  src:=replace(src,$s$UPDATE kvg.tipo_identificacion SET nombre = coalesce(p_datos->>'nombre',nombre),$s$,
    $s$UPDATE kvg.tipo_identificacion SET nombre = coalesce(btrim(p_datos->>'nombre'),nombre),$s$);
  src:=replace(src,$s$        RETURN to_jsonb(v_tipo);$s$,$s$
        INSERT INTO kvg_privado.cambio_catalogo(catalogo,referencia,revision,actor_id,motivo)
          VALUES ('IDENTIFICACION',v_tipo.tipo_identificacion_codigo,v_tipo.revision,v_actor,btrim(p_datos->>'motivo'))
          ON CONFLICT(catalogo,referencia,revision) DO NOTHING;
        RETURN to_jsonb(v_tipo);$s$);
  src:=replace(src,$s$        PERFORM set_config('kvg.motivo_parametro',p_datos->>'motivo',true);$s$,$s$
        IF jsonb_typeof(p_datos->'motivo') IS DISTINCT FROM 'string' OR (p_datos->>'motivo') !~ '[^[:space:]]' THEN
            RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Se requiere el motivo del cambio.';
        END IF;
        IF v_parametro.parametro_codigo='sesion.inactividad_minutos' AND v_num>v_parametro.valor::integer THEN
            UPDATE kvg.sesion_aplicacion SET revocada_en=clock_timestamp(),motivo_revocacion='CADUCIDAD'
            WHERE revocada_en IS NULL AND ultima_actividad_en<=clock_timestamp()-make_interval(mins=>v_parametro.valor::integer);
        END IF;
        PERFORM set_config('kvg.motivo_parametro',btrim(p_datos->>'motivo'),true);$s$);
  EXECUTE 'CREATE OR REPLACE FUNCTION kvg_privado.administracion(p_operacion text,p_datos jsonb) RETURNS jsonb '
    ||'LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);
END;
$patch$;
COMMIT;
