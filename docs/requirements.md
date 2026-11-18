# Análisis del proyecto y trazabilidad

## Propósito y alcance

El Sistema de Gestión Documental KVG es una aplicación web interna para centralizar clientes, expedientes, responsables y documentos del despacho. Debe permitir encontrar información, seguir los asuntos y conservar evidencia de operaciones, versiones y recuperación.

La primera versión contempla clientes, expedientes, asignaciones, documentos privados, versiones, revisión documental, avances, retiro y recuperación de documentos, usuarios, permisos, auditoría, configuración y respaldos con restauración.

La búsqueda comprende metadatos: nombre, categoría, expediente, cliente y fecha. Quedan fuera el portal de clientes, la firma electrónica, la integración con tribunales, la facturación, los pagos, el OCR y la búsqueda dentro del contenido completo de archivos.

La instalación Supabase existente está verificada sin reinstalar la baseline. La comparación inicial confirmó 37 tablas de negocio, 338 columnas, 43 funciones físicas, privilegios RPC, RLS y los dos buckets privados; HTTP y SQL corresponden al mismo proyecto. La evidencia de esa revisión está en [supabase-verification.md](supabase-verification.md). El incremento de identidad añade persistencia técnica de sesiones y contexto operativo mediante migraciones separadas, sin alterar ese archivo original.

CU023/CU024 están implementados y verificados en desarrollo: contraseña, MFA del proveedor, sesión KVG, cookie protegida, CSRF, renovación, cierre, permisos por defecto denegados y auditoría base. Se aplicaron explícitamente ambas migraciones de sesión y el bootstrap con dos identidades Auth ficticias distintas. Las pruebas reales comprobaron el proveedor y RPC permitida/denegada, revocación y expiración. Las pruebas HTTP con puertos simulados cubren también cuenta inactiva y comprobación de capacidades/contextos. El paso 3A añade verificación de acceso en Chromium local; la evidencia de identidad y sus límites están en [identity.md](identity.md).

El paso 3A implementa el recorrido mínimo CU001/CU002 y CU004/CU005, verificado con identidades reales y datos ficticios: captura y consulta, duplicados normalizados, reintentos sin duplicación, folio/estado de servidor, alcance y auditoría. El contrato, las pruebas locales/remotas y Chromium están en [clients-and-cases.md](clients-and-cases.md). El recorrido mínimo CU008/CU012/CU013 ya incorpora carga
privada, análisis real y descarga autorizada; existe un ensayo acotado de
recuperación local con los límites de [documents.md](documents.md) y
[recovery-rehearsal.md](recovery-rehearsal.md). Se continuará el prototipo RUP 16.6 y su despliegue temprano antes de ampliar todos los módulos. El usuario autorizó estilos mínimos para legibilidad y orden de los formularios; la base visual ahora sigue la maqueta y logo entregados por el usuario y la usabilidad funcional se comprueba en cada avance.

## Fuentes y diferencias resueltas

Se analizaron los cinco archivos proporcionados, conservando la distinción entre requisitos documentales, propuestas pendientes de validación y el trabajo autorizado en esta etapa.

| Fuente                                         | Uso en esta preparación                                                                                                                                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RUP Fase de Construcción.pdf`                 | Contiene la revisión de Elaboración **v2.0, de 3 de octubre de 2026**: 31 casos de uso, RN01–RN23 y arquitectura de monolito modular con React, NestJS y Supabase. Es la referencia de requisitos más reciente entre los documentos RUP entregados.    |
| `Proyecto RUP_Fase de Elaboración.pdf`         | Antecedente con 22 casos de uso y propuesta PHP/MySQL/Apache/XAMPP. La revisión v2.0 identifica expresamente esta versión anterior y cambia la propuesta tecnológica. Se conservan los identificadores CU001–CU022.                                    |
| `Modelo_Logico_Conceptual_Diccionario_KVG.pdf` | Modelo **v1.1, de 4 de octubre de 2026**, derivado del RUP v2.0: 37 relaciones y 337 atributos lógicos, con trazabilidad a los 31 CU. Sigue siendo una propuesta para validación.                                                                      |
| `Modelo_Fisico_KVG_PostgreSQL.sql`             | Implementación física suministrada para PostgreSQL 15 o superior con Supabase Auth y Storage. La instalación existente está verificada y el original se conserva intacto como baseline; las ampliaciones de sesión se registran en nuevas migraciones. |
| `Jira-SCRUM-completo.md`                       | Copia de lectura con 7 épicas, 31 elementos de tipo Feature y 183 subtareas. Permite vincular el código con el trabajo registrado. No es una sincronización del estado actual ni se modificó Jira.                                                     |

La elección para el repositorio sigue la revisión v2.0 y los modelos posteriores: **React + TypeScript + Vite; Node + NestJS; PostgreSQL con Supabase Auth y Storage privado**. XAMPP, PHP y MySQL pertenecen al antecedente y no se mezclan con esta base.

La copia de Jira asigna al Sprint 1 las funcionalidades y subtareas de clientes. Eso no elimina la dependencia técnica de identidad, sesiones, alcance y auditoría. El orden propuesto en [roadmap.md](roadmap.md) incorpora esos prerrequisitos y adelanta el recorrido arquitectónico completo de RUP 16.6. Las subtareas de formularios se abordarán con controles funcionales y HTML semántico. Claridad de mensajes, navegación, teclado y validaciones se comprueban durante cada avance; se reutiliza la base visual KVG autorizada y se completarán las pantallas futuras conforme avance cada CU.

El paso 1 comprobó conectividad y metadatos mediante diagnósticos de lectura. El paso 2 incorporó identidades ficticias, MFA, persistencia y pruebas reales de sesión/RPC. El paso 3A ya demuestra alcance sobre un cliente y expediente concretos y denegación/revocación entre identidades; el alcance sobre archivos se verificará al integrar documentos. El orden y los criterios de cierre, incluida una etapa final de configuración de producción y revisión de seguridad, están en [roadmap.md](roadmap.md).

Los documentos siguen pendientes de validación del despacho en los puntos PT01–PT08. Esta preparación no convierte las propuestas en decisiones aprobadas ni acredita la aceptación formal de Elaboración.

## Actores y alcance de acceso

| Actor         | Responsabilidad                                                                        | Límite                                                                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secretaria    | Registrar clientes y expedientes, organizar documentos y gestionar asignaciones.       | Cada operación requiere permiso y alcance. Las decisiones jurídicas de conclusión, reapertura o validación exigen facultad específica.                                |
| Abogado       | Consultar expedientes autorizados, incorporar y revisar documentos, registrar avances. | La condición de abogado no concede lectura global: requiere asignación o acceso explícito al expediente. Principal y colaboradores pueden tener facultades distintas. |
| Administrador | Gestionar identidades, permisos, configuración, auditoría y recuperación.              | La administración técnica no concede acceso jurídico automático. Sus operaciones deben usar los metadatos mínimos necesarios.                                         |
| Cliente       | Proporcionar información al despacho.                                                  | Es una entidad del negocio, sin acceso directo a esta versión del sistema.                                                                                            |

Una persona puede reunir varios roles mediante asignaciones explícitas y auditadas. La autorización combina cuenta y sesión vigentes, permiso de operación y alcance del recurso; ocultar un botón en el navegador no constituye autorización.

## Catálogo completo de casos de uso

Los nombres de carpetas están en inglés y los identificadores de negocio conservan los del RUP y Jira. La tabla indica responsabilidad funcional; CU023/CU024 y el recorrido mínimo de CU001/CU002/CU004/CU005 tienen el estado descrito arriba. Este último no completa todos los filtros, relaciones y ampliaciones. Los demás casos no se consideran implementados por existir sus módulos o el SQL.

| CU    | Función                             | Jira Feature | Módulo principal           |
| ----- | ----------------------------------- | ------------ | -------------------------- |
| CU001 | Registrar cliente                   | SCRUM-13     | `clients`                  |
| CU002 | Consultar cliente                   | SCRUM-14     | `clients`                  |
| CU003 | Actualizar cliente                  | SCRUM-15     | `clients`                  |
| CU004 | Crear expediente                    | SCRUM-41     | `cases`                    |
| CU005 | Consultar expediente                | SCRUM-42     | `cases`                    |
| CU006 | Actualizar estado del expediente    | SCRUM-43     | `cases`                    |
| CU007 | Asignar expediente a abogado        | SCRUM-44     | `cases`                    |
| CU008 | Subir documento                     | SCRUM-127    | `documents`                |
| CU009 | Clasificar documento                | SCRUM-128    | `documents`                |
| CU010 | Relacionar documento con expediente | SCRUM-129    | `documents`                |
| CU011 | Buscar documento                    | SCRUM-130    | `documents`                |
| CU012 | Consultar documento                 | SCRUM-131    | `documents`                |
| CU013 | Descargar documento                 | SCRUM-132    | `documents`                |
| CU014 | Actualizar documento                | SCRUM-133    | `documents`                |
| CU015 | Consultar expedientes asignados     | SCRUM-45     | `cases`                    |
| CU016 | Revisar documentos del expediente   | SCRUM-134    | `documents`                |
| CU017 | Actualizar avance del expediente    | SCRUM-46     | `cases`                    |
| CU018 | Administrar usuarios                | SCRUM-138    | `identity`                 |
| CU019 | Administrar roles y permisos        | SCRUM-139    | `identity`                 |
| CU020 | Consultar bitácora                  | SCRUM-168    | `audit`                    |
| CU021 | Configurar sistema                  | SCRUM-169    | `configuration`            |
| CU022 | Gestionar respaldos                 | SCRUM-196    | `operations`               |
| CU023 | Iniciar sesión                      | SCRUM-149    | `identity`                 |
| CU024 | Cerrar sesión                       | SCRUM-150    | `identity`                 |
| CU025 | Reasignar expediente                | SCRUM-47     | `cases`                    |
| CU026 | Cambiar estado del documento        | SCRUM-135    | `documents`                |
| CU027 | Retirar documento                   | SCRUM-136    | `documents`                |
| CU028 | Recuperar registro                  | SCRUM-198    | `operations` / `documents` |
| CU029 | Consultar versiones del documento   | SCRUM-137    | `documents`                |
| CU030 | Restaurar respaldo                  | SCRUM-197    | `operations`               |
| CU031 | Actualizar datos del expediente     | SCRUM-48     | `cases`                    |

CU018 agrupa alta, actualización y desactivación de usuarios. CU014 distingue edición de metadatos y publicación de una nueva versión. CU028 se concreta en documentos, el recurso que tiene retiro previsto en esta línea base. `audit` interviene transversalmente: consultar la bitácora no sustituye el registro automático de las operaciones.

CU020 consulta y filtra eventos conservando su correlación y diferenciando la
autorización de descarga de la evidencia de transferencia. CU021 limita los cambios
a parámetros de sesión y catálogos habilitados, exige un motivo y conserva las
referencias al desactivar entradas. [Contrato y pruebas de CU020/CU021](audit-and-configuration.md).

CU022 y CU030 tienen un recorrido de desarrollo de copia cifrada y restauración
por ID, con historial local y comprobación de datos y originales. La operación
con destino independiente y reapertura autorizada sigue pendiente.
[Procedimiento y verificación](recovery-rehearsal.md).

## Reglas que condicionan la implementación

| Reglas RUP | Comportamiento requerido                                                                                                                                                                                                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RN01–RN03  | Identidad verificada, cuenta activa y sesión operativa vigente. Denegación por defecto; permisos por operación y recurso aplicados también a listados, conteos y archivos. El administrador no obtiene lectura jurídica automática.                                                                                           |
| RN04–RN06  | Cada expediente conserva un cliente principal registrado y un folio interno único y estable, separado del identificador externo. Puede comenzar sin abogado, pero necesita un principal activo antes de entrar en proceso. Los colaboradores y las reasignaciones conservan historial y revisan accesos.                      |
| RN07       | Los expedientes usan `NUEVO`, `EN_PROCESO`, `PENDIENTE`, `CONCLUIDO` y `ARCHIVADO`. Las transiciones siguen una matriz; conclusión y reapertura requieren motivo y autorización específica.                                                                                                                                   |
| RN08–RN10  | Todo documento disponible pertenece a un expediente. Las cargas quedan en cuarentena privada hasta superar tamaño, contenido real, antimalware y SHA-256 calculado de forma confiable. La propuesta de formatos es PDF, DOCX, JPG y PNG de hasta 20 MB, pendiente de PT03. Un fallo de análisis mantiene el bloqueo.          |
| RN11–RN12  | Cada versión nueva conserva un objeto distinto y los originales anteriores. El estado documental corresponde a la versión vigente: `RECIBIDO`, `EN_REVISION`, `VALIDADO`, `ARCHIVADO`. La verificación técnica y la revisión jurídica son procesos separados; esta última se vincula a una versión exacta.                    |
| RN13–RN14  | Cambiar la asociación documental exige acceso al origen y destino, motivo y trazabilidad. Las identificaciones declaradas únicas se normalizan y verifican; coincidir en nombre sólo genera advertencia y no basta para rechazar un cliente como duplicado.                                                                   |
| RN15–RN16  | Retirar un documento es una operación lógica recuperable. No hay borrado físico automático ni cascadas destructivas. Recuperar exige relaciones y archivos verificables y aplica permisos actuales; la recuperación incompleta no habilita disponibilidad.                                                                    |
| RN17–RN18  | Autor e instante de servidor en UTC, con presentación propuesta en `America/Merida`. Auditoría de acciones críticas y resultados protegida frente a edición; sin credenciales, tokens ni contenido jurídico completo. Las importaciones conservan procedencia y no inventan fechas históricas.                                |
| RN19–RN20  | El respaldo abarca datos, objetos y manifiestos; requiere copia cifrada independiente y prueba de recuperación. Los datos relacionados se modifican mediante transacciones y revisiones para concurrencia. PostgreSQL y Storage no forman una sola transacción: hacen falta estados, reintentos, compensación y conciliación. |
| RN21–RN23  | Recabar únicamente información necesaria y respetar conservación/restricciones jurídicas. Desactivar catálogos usados sin romper referencias. Restaurar con permiso específico, autenticación reforzada, autorización operativa y verificación aislada antes de sustituir producción.                                         |

Otros requisitos transversales del RUP: cuentas individuales por invitación, sin registro público; MFA; sesión operativa verificada en el servidor; cookie con `HttpOnly`, `Secure` y `SameSite` explícito; protección CSRF para cambios; limitación de intentos y errores de autenticación genéricos. El flujo implementado exige AAL2, consulta permisos actuales, utiliza cookie `HttpOnly`/`SameSite=Lax` con `Secure` en producción y valida origen/CSRF. Incluye limitación de intentos local por proceso; su adaptación a varias instancias, configuración del proveedor y verificación HTTPS del alojamiento quedan para la revisión de producción.

## Decisiones pendientes del despacho

Estos puntos se registran para no fijar políticas de negocio por accidente. No impiden preparar el repositorio; deben resolverse al abordar el comportamiento afectado.

| ID   | Tema pendiente                | Propuesta de los documentos                                                                                                                                                  |
| ---- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PT01 | Tipos de cliente y asuntos    | Un cliente principal por expediente. Validar personas morales y varios clientes por asunto.                                                                                  |
| PT02 | Acceso, asignaciones y sesión | Principal, colaboradores y accesos explícitos, sin consulta global por defecto. Validar matriz y límites propuestos de 30 minutos de inactividad y 8 horas de sesión máxima. |
| PT03 | Formatos y volumen            | PDF, DOCX, JPG y PNG hasta 20 MB. Inventariar archivos reales y revisar necesidad de XLSX.                                                                                   |
| PT04 | Recuperación                  | RPO de una hora y RTO de cuatro horas como objetivos sujetos a costo y ensayo, sin garantía actual.                                                                          |
| PT05 | Conservación                  | Definir plazos de documentos, versiones, auditoría y respaldos; restricciones jurídicas prevalecen.                                                                          |
| PT06 | Conectividad y nube           | Validar Internet, región, tratamiento de datos y acceso remoto autorizado.                                                                                                   |
| PT07 | Facultades jurídicas          | Designar quién puede concluir/reabrir expedientes y validar documentos.                                                                                                      |
| PT08 | Operación y presupuesto       | Definir planes, titularidad de cuentas, soporte y responsables posteriores a la entrega.                                                                                     |

Cada decisión futura debe registrar el responsable que la autorizó, fecha, valor acordado y requisitos afectados. Los ambientes de desarrollo usarán datos ficticios y credenciales propias.

## Ajuste de planificación solicitado por el usuario

El 10 de noviembre de 2026 se posponen antivirus operativo y despliegue en un
segundo Supabase, sin contratar servicios nuevos. Se mantiene desarrollo local
con datos ficticios y se continúa con CU002/CU003 (SCRUM-14/SCRUM-15).
CU008/SCRUM-127 conserva su implementación, pero las cargas nuevas se pausan;
CU012/CU013 siguen disponibles para versiones anteriormente verificadas y dentro
del alcance autorizado. RN10 no se acredita mediante hash o extensión solamente,
y el prototipo RUP 16.6 completo sigue abierto. Esta decisión modifica el orden
de entrega, no declara cumplidos los criterios pendientes ni reescribe el RUP/Jira.
Véanse [roadmap.md](roadmap.md) y [security-current-scope.md](security-current-scope.md).

Los incrementos 4A y 4B amplían CU002/CU003 y CU005/CU031. Las migraciones se
aplicaron al Supabase de desarrollo. CU031 registra revisión, motivo y campos
modificados sin copiar datos jurídicos a la bitácora. Los cambios de cliente
principal, estado y responsable conservan sus flujos específicos. [Contrato y evidencia](clients-and-cases.md#paso-4b-consulta-y-edición-de-expedientes).

La demo puede usar documentos ficticios en modo beta sin antimalware por
instrucción posterior del usuario. Cada versión se marca en la ficha. La
excepción temporal conserva pendientes RN10, RUP 16.6 y el despliegue
separado. [Contrato beta](document-beta.md).

CU007, CU015 y CU025 se implementaron en 4C. La gestión administrativa usa
metadatos mínimos y la lista jurídica calcula participación con la identidad de
la sesión. [Contrato de asignaciones](clients-and-cases.md#paso-4c-asignaciones-y-acceso).

CU006 y CU017 se implementaron en 4D. PostgreSQL calcula las transiciones por
revisión, alcance y responsable activo. Los avances y sus correcciones registran
autor y fecha del servidor y pueden referir versiones autorizadas del mismo
expediente. [Contrato de seguimiento](clients-and-cases.md#paso-4d-estados-y-avances).

CU009–CU011 (SCRUM-128/129/130) están implementados en 5A. SQL filtra antes
de paginar, conserva el original al reclasificar o trasladar y aplica el
alcance del destino al acceso posterior. El motivo de traslado y la
clasificación anterior y nueva quedan registrados. [Contrato documental](documents.md#paso-5a-organización-y-búsqueda).

CU014 y CU029 (SCRUM-133/137) están implementados en 5B. Editar el nombre
registra revisión y motivo. Publicar una nueva versión conserva originales,
autoría y hash, exige revisión vigente y comienza en `RECIBIDO`. El historial
respeta alcance y permiso de consulta de versiones. La descarga usa su propio
permiso. [Contrato y evidencia](documents.md#paso-5b-de-metadatos-y-versiones).

CU016 y CU026 (SCRUM-134/135) se cubren en 5C. Las observaciones jurídicas
quedan en la versión examinada, tienen acceso restringido y se corrigen con
otra entrada. Las transiciones de la vigente llevan motivo y revisión. Validar
requiere evidencia apta de esa versión y permiso específico actual.
[Contrato y evidencia](documents.md#paso-5c-de-revisión-jurídica-y-estados).

CU027 y CU028 (SCRUM-136/198) se cubren en 5D. El retiro es lógico y bloquea
el acceso al documento y a sus versiones. La recuperación exige autorización
operativa vigente, conservación y evidencia de todos los originales; el
acceso posterior se calcula por los permisos actuales del expediente.
[Contrato y evidencia](documents.md#paso-5d-de-retiro-y-recuperación).

CU018 y CU019 (SCRUM-138/139) se cubren en 6A. La cuenta por invitación
necesita confirmar correo y completar MFA. Roles y permisos exigen motivo,
revisión y la autorización correspondiente. La baja conserva la autoría y
revoca sesiones; la revocación de accesos explícitos afecta solicitudes
posteriores con la misma sesión.
[Contrato y evidencia](identity.md#paso-6a-de-usuarios-y-permisos).
