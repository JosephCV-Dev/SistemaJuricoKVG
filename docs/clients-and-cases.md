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

El recorrido 3A excluye actualización de clientes, cambios de estado y captura de
avances, pantallas completas de usuarios/permisos y gestión documental. La edición se incorpora en 4A. Las
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

Pendientes del alcance general: despliegue HTTPS, otras combinaciones de
navegador/dispositivo y restauración integral. No hay datos reales ni evidencia de producción.

Commit sugerido:

```text
feat(records): implementar clientes y expedientes con alcance e idempotencia
```

## Paso 4A: consulta y edición de clientes

CU002/CU003 se trazan a SCRUM-14/SCRUM-15 y sus subtareas SCRUM-24–40.
La búsqueda combina nombre parcial e identificación exacta tras aplicar la regla
del tipo. Usa identificaciones vigentes, incluido el historial de tipos desactivados
si la identificación sigue vigente. El listado devuelve resúmenes autorizados y
mantiene los filtros al paginar. El nombre se trata como texto literal.

El detalle muestra contactos e identificaciones y ofrece **Editar cliente** cuando
hay permiso y alcance. La edición precarga los datos y la revisión. Se envían solo
los campos modificados. Omitir una colección la conserva y enviar una lista vacía
retira sus elementos vigentes. Al editar identificaciones se conservan las
entradas idénticas, incluidas las de tipos desactivados. La fecha de alta, autor,
tipo e identificador interno quedan protegidos.

| Ruta                                                          | Comportamiento                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/clients?text=&identification=&limit=20&offset=0` | Combina filtros, con límite 1–50, desplazamiento 0–10000 y orden por nombre e ID.                      |
| `GET /api/v1/clients/:id`                                     | Revalida consulta y devuelve `canEdit` derivado del alcance SQL.                                       |
| `GET /api/v1/clients/:id/edit-identification-types`           | Catálogo activo para quien puede consultar y editar el cliente.                                        |
| `PATCH /api/v1/clients/:id`                                   | Requiere CSRF, revisión entera positiva y uno o más campos entre nombre, identificaciones y contactos. |

SQL comprueba consulta y edición antes y después de tomar el bloqueo del cliente,
compara la revisión y realiza el cambio con auditoría en la misma transacción.
Una revisión obsoleta o una identificación única duplicada producen 409. La
interfaz conserva el borrador y permite descartarlo para consultar los datos
vigentes. La búsqueda, el catálogo y el guardado conservan el JWT ordinario.
La migración versionada `202611170007_client_search_and_update.sql` mantiene la
baseline, el despachador, las capacidades y los triggers de auditoría.

**Verificación del 17 de noviembre de 2026.** `npm run check` pasó 80 pruebas
(63 de API y 17 web). Un PostgreSQL 16 efímero, sin red, ejecutó la baseline,
las migraciones y [la prueba SQL de 4A](../database/tests/client-edit-local.sql).
Se comprobaron permisos del helper, filtros, denegación entre cuentas con la
misma capacidad, revisión obsoleta, duplicado con reversión, identificaciones
retiradas, conservación de tipos desactivados y auditoría. Con dos sesiones SQL
concurrentes, una confirmó la edición y la otra recibió un conflicto de revisión.
Chromium a 390 px
comprobó el flujo de consulta, paginación, edición, conflicto y recuperación con
respuestas HTTP simuladas.

Durante la primera revisión el pooler SQL agotó el tiempo de conexión. Al
implementar 4B se recuperó la conexión y se aplicó la migración de 4A en el
Supabase actual. Los comandos de desarrollo son:

```sh
npm run setup:clients:dev
npm run test:records:schema
npm run test:records:live
```

El primer comando compara el proyecto y el fixture local, registra el checksum
y aplica solo la migración de 4A. El último usa cuentas y datos ficticios para
comprobar también dos peticiones concurrentes y la revocación con una cookie
vigente. Para cargas ficticias, consulta el [modo beta documental](document-beta.md).

## Paso 4B: consulta y edición de expedientes

CU005/CU031 corresponden a SCRUM-42 y SCRUM-48. La búsqueda paginada combina texto
(folio, referencia externa o descripción), estado, nombre del cliente y nombre
del abogado principal vigente. El filtro y el nombre del cliente en la ficha
requieren permiso sobre ese cliente. Los filtros solo producen coincidencias de
expedientes con alcance autorizado. La ficha conserva el historial, los avances,
las asignaciones y los documentos.

| Ruta                                                                     | Comportamiento                                                                                                                               |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/cases?text=&status=&client=&responsible=&limit=20&offset=0` | Consulta combinada con límite 1–50 y desplazamiento 0–10000. El responsable corresponde a una asignación principal vigente.                  |
| `GET /api/v1/cases/:id`                                                  | Devuelve el detalle y la disponibilidad de edición calculada por SQL. El nombre del cliente se incluye únicamente con acceso.                |
| `PATCH /api/v1/cases/:id`                                                | Requiere CSRF, revisión y motivo. Admite descripción y referencia externa. Para retirar la referencia, enviar número y autoridad como nulos. |

El formulario ofrece cuatro motivos predefinidos. La bitácora registra actor,
motivo, campos cambiados y nueva revisión. SQL valida consulta y edición,
recomprueba el alcance al tomar el bloqueo y exige un expediente en estado
editable. Una revisión obsoleta produce 409. La interfaz mantiene el borrador y
permite recargar los datos vigentes. El folio, el cliente principal, el estado
y las asignaciones no son campos de edición general.

Se aplicaron `202611170007_client_search_and_update.sql` y
`202611170009_case_search_and_update.sql` al Supabase de desarrollo, sin modificar
la baseline. Para repetir la preparación o la prueba ampliada:

```sh
npm run setup:clients:dev
npm run setup:cases:dev
npm run test:records:schema
npm run test:records:live
```

`npm run check` pasó 84 pruebas (67 de API y 17 web). La reconstrucción aislada
cargó la baseline y todas las migraciones. También pasó la comprobación de
privilegios en el Supabase actual.

PostgreSQL 16 aislado confirmó filtros, denegación entre dos cuentas con la
misma capacidad, campos protegidos, retiro de referencia y registro del motivo.
Dos sesiones SQL que intentaron guardar la misma revisión produjeron una
confirmación y un conflicto. Chromium a 390 px con Auth y MFA reales comprobó
el filtro, la ficha, la conservación del borrador ante un 409, la recarga,
el guardado y la pestaña Documentos. El guion global de integración
`test:records:live` tuvo respuestas intermitentes 500 en la obtención de CSRF y
quedó pendiente de completar de extremo a extremo.

## Paso 4C: asignaciones y acceso

CU007/CU015/CU025 se trazan a SCRUM-44/45/47. Secretaría accede a **Asignar abogado**
desde la ficha de un expediente editable dentro de su alcance. Puede incorporar
un principal o colaborador vigente, con motivo. El historial conserva los
periodos cerrados.

En **Mis expedientes**, el abogado ve su participación vigente como principal,
colaborador o por concesión explícita. Puede filtrar por participación, estado,
rangos de alta en UTC y texto. SQL deriva su identidad de la sesión y conserva
las restricciones de consulta de cada expediente.

El administrador busca por folio en **Reasignar expedientes**. Su respuesta
contiene folio, estado y equipo vigente para el relevo. El formulario exige
motivo, referencia de autorización y una decisión sobre continuidad del
saliente. SQL cierra la asignación y las concesiones del saliente, promueve al
colaborador elegido si corresponde y registra una nueva colaboración para el
saliente solo si se solicitó expresamente y conserva su rol activo. Se preservan
las autorizaciones de terceros. Se auditan la referencia y la nueva revisión.

| Ruta                                      | Control                                                                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/cases/assigned`              | Abogado con permiso de consulta. Filtros `text`, `status`, `participation`, `from`, `to`, `limit` y `offset`.          |
| `GET /api/v1/cases/:id/assignment-team`   | Consulta y asignación en ese expediente. Candidatos paginados por nombre.                                              |
| `POST /api/v1/cases/:id/assignments`      | Revisiones vigentes, CSRF, motivo, abogado activo y función.                                                           |
| `GET /api/v1/cases/reassignable?text=...` | Metadatos mínimos de expedientes editables que coinciden con folio y tienen un principal.                              |
| `GET /api/v1/cases/:id/reassignment-team` | Metadatos del equipo y candidatos para el permiso administrativo de reasignación.                                      |
| `POST /api/v1/cases/:id/reassignments`    | CSRF y permiso global específico. Revisión, abogado distinto, motivo, referencia y decisión explícita de colaboración. |

La migración `202611170010_case_assignments.sql` se aplicó al Supabase ficticio
actual con `npm run setup:assignments:dev`. La comprobación de privilegios pasó.
La baseline y la matriz de permisos conservan sus definiciones. `npm run check`
pasó 85 pruebas (68 de API y 17 web).
La prueba [SQL aislada](../database/tests/case-assignments-local.sql) cubre principal
único, colaborador, concesión explícita, promoción, dos relevos, pérdida de
alcance con la misma sesión y continuidad autorizada. El registro de referencia
se comprueba en bitácora. Se ejecuta sobre PostgreSQL efímero con el fixture,
baseline y migraciones y revierte sus datos.

Dos sesiones de PostgreSQL intentaron asignar un principal a la vez. Una
confirmó, la otra recibió un conflicto de revisión y quedó un solo principal.
En Chromium a 390 px con MFA real, Secretaría asignó un expediente ficticio,
el abogado lo consultó en **Mis expedientes** y el administrador accedió al
equipo de reasignación. La ficha jurídica respondió 403 para este último.

El Supabase de desarrollo tiene un solo abogado activo. El relevo entre dos
abogados, incluida la promoción del colaborador y la revocación del saliente,
se probó en PostgreSQL aislado con identidades ficticias.
