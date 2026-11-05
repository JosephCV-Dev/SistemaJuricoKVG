# Paso 3A: cliente y expediente mínimos

Este incremento implementa el recorrido mínimo de **CU001/CU002 y CU004/CU005**,
trazado a **SCRUM-13/SCRUM-14 y SCRUM-41/SCRUM-42**. Se revisaron los flujos y
excepciones de Elaboración v2.0, RUP 16.6, D01–D07 del modelo lógico, la copia de
Jira y el contrato físico. La copia de Jira es una referencia; no se modificó Jira.

El paso 3 completo continúa abierto. Ya hay identidad real, expediente accesible,
consulta autorizada y denegación para otra identidad. Faltan la carga privada segura,
el análisis real, la descarga autorizada, la recuperación verificable y el despliegue
del prototipo en un entorno de prueba separado. No se acredita RPO/RTO de producción.

## Comportamiento y límites

El frontend comparte el estado de sesión con el acceso y muestra las acciones
correspondientes a las capacidades actuales del servidor. Ocultar controles no
autoriza operaciones: cada ruta comprueba sesión y permiso, y el RPC comprueba
nuevamente el recurso, sus restricciones y el alcance vigente. Un administrador
técnico no puede registrar clientes ni leer expedientes por su rol.

- Registrar persona física con nombre, identificaciones admitidas y contactos
  opcionales. Es el tipo permitido por la baseline; PT01 sigue pendiente.
- Revisar los datos antes de confirmar. Una coincidencia de nombre entre resultados
  visibles genera advertencia; no impide el registro ni consulta clientes ajenos.
- La identificación se normaliza y valida en PostgreSQL conforme a su catálogo;
  cuando exige unicidad, un duplicado produce conflicto y revierte el alta completa.
  La advertencia de nombre no sustituye esa comprobación transaccional.
- Buscar clientes por nombre y expedientes por folio/descripción y estado, con
  páginas de veinte filas. La API acepta límites de 1–50 y desplazamiento 0–10000.
  Se pide una fila adicional para determinar si hay otra página; no se devuelve un
  total global ni se cuentan recursos ajenos. Las búsquedas usan los filtros ya
  soportados por el SQL; identificación, cliente y responsable se ampliarán después.
- Crear expediente para el cliente principal seleccionado y accesible. Nombre,
  descripción, formatos y referencias externas se validan en el servidor. Número
  externo y autoridad se completan juntos. Folio interno, estado `NUEVO`, autor y
  fechas proceden del servidor; no se aceptan como entrada libre.
- Consultar detalle, contactos/identificaciones del cliente y estado, referencias,
  responsables, historial y avances del expediente. Los nombres de responsables
  proceden de una consulta restringida al expediente; no hay directorio global.
- Un expediente nuevo puede estar sin abogado asignado. La interfaz lo informa.
  La pantalla completa de asignaciones pertenece a CU007; no se finge una asignación.

No se implementan edición, eliminación de clientes, cambios de estado, captura de
avances, pantallas completas de usuarios/permisos ni gestión documental. Las
relaciones que el SQL ya devuelve se muestran; no se consideran implementados los
casos de uso que las modifican. La interfaz adopta la maqueta KVG autorizada; listas, formularios y detalles
están separados, con resumen/historial/avances en el expediente.

Los errores conservan el formulario y la confirmación para corregir o reintentar.
Un 401 limpia el estado de acceso; un 403 descarta los listados/detalles privados
mostrados. Las solicitudes se cancelan al desmontar el área de trabajo o cerrar sesión.
La navegación interna conserva la solicitud en curso; los formularios se desmontan
al salir de su sección, por lo que sus borradores no se conservan al volver. No
se almacenan tokens ni fichas en `localStorage` o `sessionStorage`; las respuestas
de `/api/v1` llevan `Cache-Control: no-store`.

## Permisos y preparación ficticia

La matriz inicial concede a `SECRETARIA` registro de clientes y apertura global
operativa, consulta de sus registros sin expediente (`REGISTRO_PROPIO`) y
capacidades por concesión (`EXPLICITO`). Al abrir el primer expediente, el SQL crea
una concesión para quien lo organiza. La consulta del cliente pasa a depender del
alcance del expediente: ser quien lo registró deja de bastar.

`ABOGADO` consulta por asignación principal/colaboración o concesión explícita.
La aprobación de apertura procede de la matriz y exige un responsable jurídico
vigente. No se amplió la matriz ni se asignaron permisos jurídicos al administrador.

```sh
npm run setup:records:dev
```

El comando solo admite desarrollo y el mismo proyecto SQL/API del fixture local.
Ya se ejecutó en el entorno actual y se comprobó su repetición sin duplicar el
aprovisionamiento. Tiene efectos explícitos:

1. Aplica las migraciones pendientes con registro de checksum, fuera del arranque.
2. Usa contraseña y MFA del administrador ficticio para `usuario.registrar` y
   `seguridad.otorgar_rol`, siempre con su JWT ordinario.
3. Prepara una cuenta Auth ficticia de Secretaría, confirmada sin enviar correos.
   La clave técnica se usa únicamente para Auth Admin y `kvg_trabajar`: toma el
   trabajo de conciliación y vincula la identidad con el perfil invitado mediante
   `identidad.conciliar`. Se detiene ante trabajos ajenos o políticas activas que
   pudieran interferir; no es un trabajador general ni una pantalla de CU018.
4. Añade por RPC un tipo de identificación **PRUEBA_KVG**, ficticio, con normalización
   alfanumérica y unicidad. No inventa reglas de CURP/RFC/INE ni resuelve PT01/PT02.
5. Prepara TOTP para esa cuenta y guarda sus datos solamente en
   `apps/api/.local/identity-development-accounts.json`, ignorado y con permisos 0600.

Hay tres cuentas ficticias: administrador, abogado y Secretaría. Las credenciales
no se publican en esta guía. Para probar la UI, ejecutar `npm run dev`, iniciar
sesión con Secretaría e importar su `totpSecret` al autenticador. El administrador
mantiene su función técnica y el abogado necesita alcance sobre cada expediente.
Los scripts usan conexión de propietario para migraciones y SELECT de verificación,
sin CRUD directo de negocio. No necesitan repetir `kvg_inicializar`.

## Migraciones

La baseline conserva SHA-256
`51ae14882b93f9c43e24b669f740d018636e29767d1c9525da001f27bedda707`.

| Migración                                   | Motivo y verificación                                                                                                                                                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `202610280003_record_creation_requests.sql` | Evitar dobles altas por reintentos o concurrencia. Añade una tabla privada de solicitudes y una rama fija optativa de `kvg_operar`. Se comprobaron privilegios y dos creaciones concurrentes con el mismo UUID para cliente y expediente. |
| `202610280004_case_responsible_names.sql`   | Mostrar nombres de los abogados asignados en CU005 sin acceso a un directorio general. La consulta original comprueba alcance y audita antes de incorporar exclusivamente los responsables de ese expediente.                             |

La API requiere `requestId` UUID v4 al crear. El adaptador lo traduce a
`solicitud_id`; el RPC original sigue siendo compatible cuando ese campo no se
proporciona. La garantía de reintento de esta API exige conservar el UUID y el
contenido confirmado. Editar el borrador genera otra solicitud.

PostgreSQL bloquea por actor/operación/UUID y confirma la solicitud en la misma
transacción que el recurso. La tabla conserva hash del contenido e identificador
del recurso, sin respuestas ni fichas personales. Otro contenido con el mismo UUID
produce 409. Un reintento consulta el recurso actual y revalida permisos/alcance;
no reproduce una respuesta antigua tras una revocación. No hay reintentos HTTP
automáticos ni una promesa de recuperar una confirmación después de recargar la
página: en ese caso se debe buscar el registro antes de iniciar otra alta.

Las altas tienen auditoría SQL mediante los triggers existentes; las consultas de
detalle y rechazos RPC usan la auditoría original. Las denegaciones de capacidad
en el guard producen eventos estructurados de backend con actor, permiso y
correlación, sin cuerpo, nombres, contraseñas o tokens. Los rechazos anteriores al
RPC no se presentan como eventos de la bitácora SQL. Su retención centralizada y
supervisión pertenecen a la preparación de producción; CU020 sigue pendiente.

## Contrato HTTP

Todas las rutas privadas revalidan identidad y sesión. Las altas requieren origen
exacto y `X-CSRF-Token`, obtenido de `/api/v1/auth/csrf`. El navegador conserva
solamente la cookie opaca; nunca proporciona el JWT como campo o cabecera propia.

| Ruta                                                | Permiso / resultado                                                                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/auth/capabilities`                     | Información de la propia sesión; permisos/contextos para orientar la UI.                                                          |
| `GET /api/v1/clients/identification-types`          | `cliente.registrar / GLOBAL_OPERATIVO`; catálogo activo reducido a código, nombre y unicidad.                                     |
| `POST /api/v1/clients`                              | `cliente.registrar / GLOBAL_OPERATIVO`; `{requestId,name,identifications,contacts}` → resumen del cliente.                        |
| `GET /api/v1/clients?text=&limit=20&offset=0`       | `cliente.consultar` en alguno de sus contextos; página filtrada por el RPC.                                                       |
| `GET /api/v1/clients/:id`                           | Mismo permiso y alcance del recurso; identificaciones/contactos activos.                                                          |
| `POST /api/v1/cases`                                | `expediente.crear / GLOBAL_OPERATIVO`; `{requestId,clientId,description,externalNumber?,externalAuthority?}` → expediente creado. |
| `GET /api/v1/cases?text=&status=&limit=20&offset=0` | `expediente.consultar` por `PRINCIPAL`, `COLABORADOR` o `EXPLICITO`; página autorizada. Omitir `status` para todos.               |
| `GET /api/v1/cases/:id`                             | Mismo permiso y alcance; detalle y relaciones admitidas.                                                                          |

Campos desconocidos, identidades/folios/estados inventados, UUID inválidos, nulos
indebidos y colecciones excesivas se rechazan. Los contratos públicos están en
`packages/contracts/src/records.ts`. Los adaptadores validan la salida `unknown`
del RPC y seleccionan campos: no devuelven filas completas de PostgreSQL.

## Evidencia de desarrollo

```sh
npm run check
npm run test:records:schema
npm run test:records:live
```

Las pruebas locales ejercitan DTO, sesión/MFA simulados, CSRF, capacidades/contextos,
contrato de salida, límites/paginación y errores sin revelar datos. Las pruebas web
usan HTTP simulado; se distinguen de las siguientes comprobaciones reales.

La comprobación completa final pasó: formato, tipos, compilación, **40 pruebas de
API y 13 del cliente HTTP web**. El contrato SQL previo de identidad también pasó
tras las migraciones nuevas. Se comprobó que las credenciales locales siguen
ignoradas y no aparecen en fuentes versionables ni en el bundle web.

La prueba real pasó **37 comprobaciones** contra Supabase: tres identidades con MFA,
registro/consulta, normalización y duplicados, nombre igual permitido, reintento
concurrente, datos inválidos sin escrituras parciales, folio/estado de servidor,
concesión inicial, listados ajenos vacíos, denegación por recurso, asignación real
mediante RPC, consulta posterior del principal, revocación con cookie vigente,
reintento que vuelve a comprobar alcance y auditoría con el actor correcto.

El SQL de metadatos verifica RLS y ausencia de acceso directo al almacenamiento de
idempotencia, `SECURITY DEFINER`/`search_path` y privilegios RPC preservados. No
simula una identidad SQL ni sustituye la prueba real.

También pasó un recorrido de **14 comprobaciones en Chromium local**: login/MFA,
revisión y confirmación de cliente/expediente, persistencia al recargar, navegación
por teclado, vista de 390 px sin desbordamiento, ausencia de almacenamiento local
de tokens, logout y denegación al administrador. Se revisó la captura móvil.
Playwright se instaló como herramienta temporal fuera del repositorio, sin añadir
dependencias al producto. Para repetirlo con API y Vite locales en marcha:

```sh
PLAYWRIGHT_MODULE_PATH=/ruta/a/playwright/index.mjs node apps/api/scripts/test-records-browser.mjs
```

Los informes sin secretos quedan en `apps/api/.local/records-live-verification.json`
y `records-browser-verification.json`; la captura ficticia móvil también es local.
Los scripts cierran sus sesiones y no envían correos. Conservan los registros
ficticios y su auditoría; no borran expedientes ni el historial para limpiar pruebas.

Pendientes: despliegue HTTPS, otras combinaciones de navegador/dispositivo, filtros
ampliados, asignaciones desde UI, concurrencia de edición, recorrido documental y
restauración. No hay datos reales ni evidencia de producción.

Commit sugerido:

```text
feat(records): implementar clientes y expedientes con alcance e idempotencia
```
