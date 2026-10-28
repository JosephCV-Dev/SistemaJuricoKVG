# Contrato de identidad y sesión operativa

Este incremento corresponde a CU023/CU024 — SCRUM-149/SCRUM-150 y prepara el
contexto de permisos necesario para los siguientes casos de uso. La migración
`202610280002_identity_session_context.sql` añade `sesion.consultar` al despachador
existente; no instala de nuevo la baseline ni inicializa personas o cuentas.

## Operaciones fijas

El backend utiliza el JWT real del usuario para llamar a
`public.kvg_operar(p_operacion, p_datos)`. Las tres operaciones de sesión reciben
exactamente `p_datos: {}`; no aceptan identidad, roles, permisos ni identificadores
de otra sesión enviados por el navegador.

| Operación          | Condición y resultado                                                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sesion.iniciar`   | Tras comprobar credenciales y MFA con Supabase Auth, crea o reconoce la sesión operativa KVG. Exige cuenta activa, AAL2 y sesión Auth real. Devuelve `sesion_id` y `expira_en`, como en la baseline. |
| `sesion.consultar` | Revalida identidad, MFA y sesión, renueva la actividad y devuelve el contexto mínimo descrito abajo. No inicia una sesión ausente ni recupera una revocada.                                          |
| `sesion.cerrar`    | Revoca la sesión operativa actual y registra `SESION_CERRAR`. El backend también debe cerrar la sesión del proveedor y destruir su sesión web, incluso si KVG ya rechaza una sesión vencida.         |

El envoltorio no cambia: `{ "correcto": true, "datos": ... }` o
`{ "correcto": false, "codigo": "42501", "mensaje": "Operación no autorizada." }`.
El adaptador comprueba ese resultado aunque la respuesta HTTP de Supabase sea 200.
Un token de primer factor no habilita las operaciones privadas.

## Respuesta de `sesion.consultar`

Los nombres siguientes constituyen el contrato del RPC. El backend puede mapearlos
a los tipos HTTP de la aplicación, conservando las capacidades únicamente en el
servidor.

```ts
type SessionContext = {
  usuario: {
    usuario_id: string;
    nombre: string;
  };
  roles: string[];
  capacidades: Array<{
    permiso: string;
    contexto: string;
    requiere_mfa: boolean;
    requiere_decision: boolean;
  }>;
  sesion: {
    sesion_id: string;
    expira_en: string;
    ultima_actividad_en: string;
    inactividad_minutos: number;
    inactividad_expira_en: string;
  };
};
```

`usuario_id` es el identificador operativo KVG. **No es el identificador de Supabase
Auth**: la relación se verifica dentro de PostgreSQL mediante
`usuario.auth_usuario_id = auth.uid()`. El backend no compara ambos identificadores
por igualdad ni permite que el navegador elija el perfil operativo.

Los instantes son valores `timestamptz` serializados por PostgreSQL. La expiración
absoluta no aumenta al consultar. `inactividad_expira_en` es el menor instante
entre `expira_en` y `ultima_actividad_en + inactividad_minutos`; la actividad se
actualiza solamente después de comprobar que la sesión anterior todavía es válida.
Los valores iniciales de la baseline son 8 horas máximas y 30 minutos de
inactividad, sujetos a PT02.

Los roles contienen códigos activos y con asignación temporal vigente. Las
capacidades contienen pares distintos de permiso y contexto vigentes, ordenados
por permiso/contexto. Se excluyen roles, permisos y capacidades desactivados,
asignaciones futuras y asignaciones terminadas. Una cuenta activa sin roles puede
obtener su propio contexto con listas vacías; no obtiene permisos de negocio.

No se devuelven correo, Auth ID, JWT, hash de sesión, claves técnicas, concesiones,
clientes, expedientes ni documentos. Las capacidades describen operaciones
posibles en un contexto; el RPC de cada caso de uso sigue comprobando asignación,
concesión, medidas y alcance del recurso. Una capacidad `PRINCIPAL` no acredita que
el usuario sea principal del expediente solicitado.

## Comprobación por petición

La API consulta este contexto en cada petición privada con el token del usuario,
antes de comprobar las capacidades concretas del endpoint. No guarda roles como
autoridad permanente en la cookie ni se basa en metadatos editables de Auth. La
consulta conserva el control `sistema.bloqueado` de la baseline.

`kvg_privado.usuario_actual()` conserva las comprobaciones de cuenta activa, JWT
no anónimo con `aal2`, relación con la sesión Auth existente, sesión KVG no
revocada, expiración absoluta, MFA registrado e inactividad. El nuevo helper vuelve
a usar esa comprobación y consulta las asignaciones actuales. La revocación de
roles o permisos se refleja en el siguiente contexto; el RPC de negocio vuelve a
evaluar sus propios controles antes de operar.

El despachador sigue actualizando `ultima_actividad_en`, cuyo trigger conserva la
auditoría de actividad de sesión. Los rechazos mantienen el código y la auditoría
`OPERACION_RECHAZADA` originales. Consultar contexto tiene efectos de actividad y
auditoría: no debe utilizarse como un latido automático que mantenga activa una
sesión cuando no hay interacción del usuario.

El helper `kvg_privado.consultar_sesion()` no es ejecutable directamente por
`PUBLIC`, `anon`, `authenticated` ni `service_role`. Solo se utiliza desde el
despachador `SECURITY DEFINER`, con `search_path` vacío. `kvg_operar` continúa
reservado a `authenticated`; la credencial técnica no sustituye al usuario.

La sesión web persistente del backend pertenece a `kvg_servidor`, con un rol
técnico restringido definido por su propia migración. No se añade a `kvg`, no
aparece en este contexto y no modifica el contrato de acceso a las tablas de
negocio.

## Aplicar la migración

Revisar y aplicar el archivo como propietario, de forma explícita en el entorno de
desarrollo ya instalado. Sus prerrequisitos comprueban que existan el despachador y
los helpers de sesión de la baseline. No se ejecuta desde la API ni al arrancar.
La migración usa una transacción y conserva las ramas, restricciones diferidas y
errores del despachador; incorpora una sola rama nueva y un helper privado.

La aplicación debe tratar una migración todavía ausente o una respuesta con forma
inesperada como un fallo de integración, sin sustituirla por permisos simulados ni
escrituras con credenciales privilegiadas.

## Diagnóstico agregado del bootstrap

Antes de planear una inicialización, el propietario puede ejecutar la siguiente
consulta de solo lectura en desarrollo. Informa únicamente conteos: no muestra
nombres, correos, UUID ni sesiones. No crea ni confirma identidades.

```sql
BEGIN READ ONLY;

WITH perfiles AS (
    SELECT u.usuario_id,
           u.estado_cuenta = 'ACTIVO' AS activo,
           a.id IS NOT NULL AND a.email_confirmed_at IS NOT NULL AS auth_confirmada
    FROM kvg.usuario u
    LEFT JOIN auth.users a ON a.id = u.auth_usuario_id
), responsables AS (
    SELECT DISTINCT p.usuario_id, r.codigo
    FROM perfiles p
    JOIN kvg.usuario_rol ur ON ur.usuario_id = p.usuario_id
    JOIN kvg.rol r ON r.rol_id = ur.rol_id
    WHERE p.activo AND p.auth_confirmada AND r.activo
      AND r.codigo IN ('ADMINISTRADOR','ABOGADO')
      AND ur.inicia_en <= clock_timestamp()
      AND (ur.finaliza_en IS NULL OR ur.finaliza_en > clock_timestamp())
)
SELECT
    (SELECT count(*) FROM perfiles) AS perfiles_operativos,
    (SELECT count(*) FROM perfiles WHERE activo AND auth_confirmada)
        AS perfiles_activos_con_auth_confirmada,
    (SELECT count(*) FROM responsables WHERE codigo = 'ADMINISTRADOR')
        AS administradores_vigentes_confirmados,
    (SELECT count(*) FROM responsables WHERE codigo = 'ABOGADO')
        AS abogados_vigentes_confirmados,
    (SELECT count(DISTINCT usuario_id) FROM responsables)
        AS responsables_distintos,
    (SELECT count(*) FROM kvg.rol_permiso WHERE activo)
        AS capacidades_de_rol_activas,
    (SELECT count(*) FROM kvg.parametro_sistema
        WHERE parametro_codigo IN (
            'sesion.inactividad_minutos','sesion.duracion_horas','sistema.bloqueado'
        )) AS parametros_iniciales_presentes;

ROLLBACK;
```

Si `perfiles_operativos = 0`, la inicialización de perfiles no se ha realizado. No
se debe ejecutar `kvg_inicializar` sin identificar previamente a los dos responsables
y su aprobación. Si ya existen perfiles, la función inicial los rechaza: una
inicialización parcial o una configuración diferente requiere revisión, no borrar
los perfiles y repetir el archivo.

El bootstrap original exige dos identidades Auth distintas con correo confirmado,
un responsable técnico y otro jurídico, junto con una referencia identificable de
aprobación. Crea sus perfiles y roles, la matriz inicial y los parámetros de sesión.
No crea una secretaria inicial ni da acceso jurídico al administrador. Tampoco
verifica por sí solo que las personas hayan inscrito y probado MFA: eso se comprueba
con el inicio de sesión real. No se inventan correos ni se comparten contraseñas
para resolver esa dependencia.

Los conteos permiten detectar pendientes evidentes; no demuestran que una persona
concreta conserve todas las facultades necesarias ni que una sesión real funcione.
La validación funcional necesita identidades ficticias de desarrollo autorizadas.

## Pruebas y límites

La migración y su contrato deben verificarse junto con las pruebas de HTTP y sesión
del backend. `tests/identity-session.sql` comprueba metadatos, privilegios y el
rechazo de una petición sin identidad, dentro de una transacción que revierte la
auditoría generada. Se ejecuta como propietario en desarrollo tras la migración;
no crea fixtures Auth ni acredita el recorrido autenticado. Los escenarios de
integración con Supabase son:

- Contexto correcto después de MFA e inicio KVG, sin información jurídica.
- Rechazo de AAL1, sesión Auth inexistente, cuenta desactivada y sesión operativa
  vencida o revocada.
- Rechazo tras inactividad sin reactivar la sesión ni aumentar su expiración.
- Retirada de un rol o capacidad reflejada en la siguiente petición, y ausencia de
  acceso cruzado por presentar el UUID de otro usuario o expediente.
- Cierre de KVG y proveedor, eliminación de la sesión web y rechazo al reutilizar
  la cookie anterior.
- Capacidad con contexto vigente sin concesión/asignación al recurso: el RPC del
  caso de uso debe denegar el acceso.

Las pruebas sin un usuario Auth real no acreditan MFA, renovación, alcance ni cierre
con el proveedor. La existencia de la migración tampoco acredita que se haya
aplicado. No se ha ejecutado ninguna mutación remota durante la preparación de
estos archivos.
