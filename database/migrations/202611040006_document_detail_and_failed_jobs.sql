-- Metadatos legibles solo después de autorizar/auditar documento.consultar.
-- Estado de agotamiento visible al autor, sin reactivar trabajos ni ampliar permisos.
BEGIN;
DO $patch$
DECLARE src text;
BEGIN
 SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='public.kvg_operar(text,jsonb)'::regprocedure;
 IF position('ELSIF p_operacion = ''documento.carga''' IN src)=0 THEN RAISE EXCEPTION 'Falta workflow documental'; END IF;
 src:=replace(src,'ELSIF p_operacion = ''documento.carga''',
 'ELSIF p_operacion = ''documento.consultar'' THEN
  v_salida := kvg_privado.documentos(p_operacion,p_datos);
  SELECT v_salida || jsonb_build_object(''nombre_autor'',u.nombre,''nombre_categoria'',c.nombre)
    INTO v_salida FROM kvg.documento d JOIN kvg.usuario u ON u.usuario_id=d.creado_por
    JOIN kvg.categoria_documento c ON c.categoria_id=d.categoria_id WHERE d.documento_id=(p_datos->>''documento_id'')::uuid;
 ELSIF p_operacion = ''documento.carga''');
 EXECUTE 'CREATE OR REPLACE FUNCTION public.kvg_operar(p_operacion text,p_datos jsonb DEFAULT ''{}'') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);
 SELECT prosrc INTO STRICT src FROM pg_proc WHERE oid='kvg_privado.consultar_carga(jsonb)'::regprocedure;
 IF position('''estado'',c.estado_tecnico' IN src)=0 THEN RAISE EXCEPTION 'Contrato de carga no reconocido'; END IF;
 src:=replace(src,'''estado'',c.estado_tecnico',
 '''estado'',CASE WHEN c.estado_tecnico IN (''PENDIENTE_VERIFICACION'',''ERROR_VERIFICACION'') AND EXISTS
  (SELECT 1 FROM kvg.trabajo_operativo t WHERE t.objetivo_id=c.carga_id AND t.tipo IN (''VERIFICAR_CARGA'',''CONCILIAR_CARGA'') AND t.estado=''FALLIDO'')
  THEN ''ERROR_VERIFICACION'' ELSE c.estado_tecnico END');
 EXECUTE 'CREATE OR REPLACE FUNCTION kvg_privado.consultar_carga(p_datos jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS '||quote_literal(src);
END;
$patch$;
COMMIT;
