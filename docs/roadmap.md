# Próximos avances funcionales

## Estado de partida

El proyecto es un monorepo de npm workspaces: `apps/web` para React/TypeScript/Vite, `apps/api` para NestJS y `packages/contracts` para tipos HTTP compartidos. La instalación Supabase existente está verificada y CU023/CU024 tienen un recorrido de acceso implementado y probado en desarrollo. El recorrido mínimo de cliente y expediente del paso 3A ya está implementado y verificado; el recorrido documental y ensayo acotado de recuperación 3B están implementados localmente; falta el despliegue temprano 3C y ampliar allí la recuperación para completar la evidencia de RUP 16.6.

**Paso 1 completado: conectividad y catálogo verificados.** El 28 de octubre de 2026 se comprobó directamente el catálogo por PostgreSQL, con TLS validado y una transacción de solo lectura. La comparación inicial confirmó las 37 tablas, 338 columnas y 43 funciones de la baseline, sus privilegios RPC, RLS y los dos buckets privados. HTTP y SQL corresponden al mismo proyecto. La evidencia de esa revisión está en [supabase-verification.md](supabase-verification.md).

**Paso 2 implementado y verificado en desarrollo.** Se aplicaron explícitamente las migraciones de persistencia técnica y contexto de sesión y se inicializaron dos identidades Auth ficticias distintas. Se probó el proveedor real con contraseña, MFA y sesión KVG, operaciones RPC permitidas y denegadas y rechazo tras revocación o expiración. Las pruebas HTTP locales cubren también CSRF/origen, cookies, renovación concurrente, cierre, cuenta inactiva y permiso/contexto mediante puertos simulados. El acceso se comprobó después en Chromium local con el paso 3A. Esto no completa la administración de usuarios/permisos ni el procesamiento de archivos o recuperación. El contrato y el alcance están en [identity.md](identity.md).

La trazabilidad y los requisitos están en [requirements.md](requirements.md). La estructura permite avanzar mediante casos de uso completos: entrada funcional, validación del servidor, reglas, persistencia, autorización, resultado verificable y pruebas relevantes. El usuario autorizó estilos mínimos para que los formularios sean legibles y ordenados: fondo neutro, secciones, espaciado y botones sencillos, sin animaciones. Cada interfaz conserva controles HTML semánticos y mensajes comprensibles. El 4 de noviembre de 2026 el usuario adelantó la adaptación del diseño HTML y logo KVG; véase [interface.md](interface.md). La usabilidad se verifica en cada entrega.

## Ajuste de alcance acordado el 10 de noviembre de 2026

Por decisión del usuario se continúa **localmente con el único proyecto Supabase
actual y datos ficticios**, sin nuevas cuentas, APIs externas ni contratación.
Se posponen la operación de antivirus y el despliegue separado 3C. No se presenta
este entorno como pruebas independientes o producción, ni se reinstala la base.

El usuario autorizó después una excepción para la beta local. Las cargas ficticias
recibidas y las nuevas admitidas pueden publicarse sin antimalware, con una marca
explícita y solo mientras esté activo el modo beta. Se conserva ClamAV para cuando
se indique reactivarlo. RUP RN10 y 16.6 siguen pendientes para la entrega completa.
[Modo beta y controles](document-beta.md).

**4A y 4B implementados en el Supabase de desarrollo.** CU002/CU003 (SCRUM-14/15)
cubren búsqueda y edición de clientes. CU005/CU031 (SCRUM-42/48) añaden filtros
por cliente y abogado principal y edición de expediente por revisión con motivo.
Véase [contrato y pruebas](clients-and-cases.md#paso-4b-consulta-y-edición-de-expedientes).

**4C implementado.** CU007/CU025/CU015 incluyen asignación, relevo, selección
de abogados activos, historial y la lista de expedientes asignados o concedidos.
[Contrato y pruebas de 4C](clients-and-cases.md#paso-4c-asignaciones-y-acceso).

**4D implementado.** CU006/CU017 (SCRUM-43/46) añaden transiciones con revisión,
motivo y autorización jurídica, además de avances y correcciones que conservan
autoría e historial. [Contrato de seguimiento](clients-and-cases.md#paso-4d-estados-y-avances).

**5A implementado.** CU009–CU011 incorporan búsqueda por metadatos,
clasificación con historial y traslado con revisión, trazabilidad y alcance
sobre origen y destino. [Contrato y pruebas](documents.md#paso-5a-organización-y-búsqueda).

**5B implementado.** CU014/CU029 (SCRUM-133/137) separan la edición del
nombre de la publicación de una nueva versión. El historial identifica la
vigente y las revisiones jurídicas de cada original. Una reserva obsoleta
queda cancelada y la descarga de anteriores conserva su permiso específico.
[Contrato y pruebas](documents.md#paso-5b-de-metadatos-y-versiones).

**5C implementado.** CU016/CU026 (SCRUM-134/135) registran observaciones
jurídicas vinculadas a la versión examinada. Las transiciones autorizadas
afectan a la vigente y validarla requiere una revisión apta de esa misma versión.
[Contrato y pruebas](documents.md#paso-5c-de-revisión-jurídica-y-estados).

**5D implementado.** CU027/CU028 (SCRUM-136/198) incorporan retiro lógico
con motivo, denegación de consultas y descargas mientras dura el retiro y
recuperación administrativa con comprobación de todos los originales.
[Contrato y pruebas](documents.md#paso-5d-de-retiro-y-recuperación).

**6A implementado.** CU018/CU019 (SCRUM-138/139) añaden el directorio,
invitación individual, edición y desactivación, roles y matriz autorizada,
además de concesiones por expediente. La entrega de correos depende de la
plantilla y el servicio de correo del proyecto Supabase.
[Contrato y pruebas](identity.md#paso-6a-de-usuarios-y-permisos).

**6B implementado.** CU020/CU021 (SCRUM-168/169) añaden consulta y detalle de
bitácora y gestión de catálogos y parámetros permitidos con motivo,
confirmación e historial. [Contrato y pruebas](audit-and-configuration.md).

**6C local implementado.** CU022/CU030 (SCRUM-196/197) tienen copia cifrada,
historial y restauración por ID en Docker aislado. Continúa pendiente el cierre
operativo, con destino independiente, programación, alertas y reapertura
autorizada. [Procedimiento y evidencia](recovery-rehearsal.md).

**7 implementado.** Las pantallas disponibles usan el diseño KVG con navegación
plegable en móvil, controles de formulario consistentes, foco de teclado y
tablas desplazables. El siguiente bloque es **8**, configuración de producción,
revisión de seguridad y lanzamiento. [Verificación visual](interface.md#paso-7).

**8 verificado en desarrollo.** La comprobación incluye los roles de la demo,
una carga y descarga beta, el ensayo HTTPS local y la restauración aislada.
La validación en el destino de producción queda pendiente.
[Estado de alojamiento y evidencia](release-verification.md).

La demo mantiene su modo beta local. El antimalware operativo y el despliegue
separado siguen pendientes.

Los controles que permanecen activos y los límites están en
[security-current-scope.md](security-current-scope.md).

## Orden recomendado

### 1. Conectar y verificar la instalación existente

Usar el proyecto Supabase donde el usuario ya aplicó el modelo, identificando su entorno y trabajando con datos ficticios. Revisar conectividad, Auth, API de datos y los metadatos de PostgreSQL/Storage. No volver a ejecutar la baseline ni crear otro proyecto por defecto. La instalación inicial queda como procedimiento para reconstrucción explícita o un entorno nuevo que realmente la necesite.

La API puede arrancar localmente sin conexión configurada para comprobar salud. La configuración parcial o inválida se rechaza; los endpoints de acceso necesitan su configuración completa. La fábrica de clientes ordinarios conserva el JWT del usuario al invocar `public.kvg_operar`. La credencial de propietario o una clave privilegiada no sustituye esa identidad. No se añade CRUD directo de negocio ni un endpoint que acepte nombres RPC arbitrarios enviados por el navegador.

Para cerrar este paso se necesita:

- Identificar y configurar el proyecto existente como entorno de desarrollo, con credenciales fuera del repositorio y sin exponerlas en respuestas ni diagnósticos.
- Ejecutar el diagnóstico CLI de lectura y registrar la comprobación de conectividad y superficie de Auth/API de datos, con sus fallos o límites.
- Ejecutar el diagnóstico SQL de lectura en ese entorno y revisar esquemas, 37 tablas de negocio, firmas RPC, privilegios, RLS y buckets privados esperados, además del estado de inicialización necesario para la siguiente etapa. Registrar evidencia sin incluir información sensible.
- Documentar diferencias y correcciones necesarias mediante nuevas migraciones, sin reescribir la baseline ni aplicarlas al arrancar la API. Repetir únicamente las verificaciones afectadas por cualquier corrección.

La revisión de metadatos no demuestra una operación de negocio autorizada. El paso 2 añade evidencia real de identidad, MFA, sesión operativa y RPC permitida/denegada. El alcance sobre un cliente, expediente o archivo concreto se comprobará con el caso de uso correspondiente. La salud HTTP confirma únicamente el proceso local.

### 2. Acceso, sesiones, permisos y auditoría base

CU023/CU024 — SCRUM-149/SCRUM-150 están implementados y verificados en desarrollo. El recorrido incluye primer factor, inscripción/verificación TOTP con el proveedor, sesión operativa KVG, persistencia cifrada del servidor, cookie `HttpOnly` y `SameSite=Lax` (`Secure` en producción), rotación del identificador, comprobación de origen/CSRF, renovación y cierre. Las rutas privadas deniegan acceso por defecto y consultan capacidades vigentes; cada futuro caso de negocio sigue siendo responsable del alcance sobre su recurso. Se incorpora auditoría base, sin completar la pantalla de CU020.

Las migraciones `202610280001_server_sessions.sql` y `202610280002_identity_session_context.sql` se aplicaron explícitamente. La primera separa la persistencia web en `kvg_servidor`, con un rol técnico restringido; la segunda añade `sesion.consultar` a `public.kvg_operar`. El bootstrap utiliza dos identidades ficticias confirmadas para desarrollo, sin registro público ni secretos en el repositorio. Esto prepara bases de CU018/CU019, cuyos recorridos completos de administración siguen pendientes. Los límites de ocho horas y treinta minutos de inactividad y la matriz definitiva siguen sujetos a PT02/PT07.

La verificación real cubre Auth/MFA, sesión KVG, RPC permitida/denegada, revocación y expiración. Las pruebas HTTP con puertos simulados cubren cuenta inactiva, capacidades/contextos, denegación de rutas sin política, CSRF/origen, rotaciones de cookie, renovación concurrente y reutilización de una cookie cerrada. El paso 3A añade Chromium local y denegación real entre identidades sobre clientes y expedientes. La denegación de archivos se demostrará con su integración, sin atribuirla a pruebas simuladas.

### 3. Cliente y expediente mínimos, prototipo completo y despliegue temprano

**3A implementado y verificado en desarrollo.** Registro/consulta de cliente y
creación/consulta de expediente con sesión MFA, DTO, permisos por contexto, alcance,
auditoría y reintentos idempotentes. Se preparó una cuenta ficticia de Secretaría
mediante RPC ordinario y conciliación técnica, sin ampliar la matriz ni conceder
lectura jurídica al administrador. Se probaron duplicados normalizados, denegación
entre identidades, asignación por RPC y revocación con cookie vigente. Pasaron 37
comprobaciones reales de este recorrido y 14 en Chromium local, incluida vista
móvil. El contrato y límites están en [clients-and-cases.md](clients-and-cases.md).

**3B implementado localmente; 3C pendiente. El paso 3 completo sigue abierto.**
Se incorporaron carga privada, ClamAV real, validación estructural, SHA-256,
publicación por trabajo persistente y consulta/descarga con alcance real. El ensayo
cifrado reconstruye datos de negocio y originales en PostgreSQL aislado; no
restaura el proveedor Supabase Auth ni un segundo Storage real ni reabre servicio.
Véanse [documents.md](documents.md) y [recovery-rehearsal.md](recovery-rehearsal.md).
**3C preparado parcialmente y pospuesto por acuerdo del usuario.** Se conservan
las imágenes Node/Caddy, secretos montados y preflight del futuro entorno separado.
El ensayo local verificó HTTPS, proxy, cookie segura y persistencia SQL restringida.
No hay despliegue remoto ni restauración de un proveedor separado. Los comandos de
staging quedan como preparación futura; no se solicita otro Supabase para continuar.
El Compose deja trabajador/ClamAV en un perfil opcional y las cargas pausadas.
Véase [staging-deployment.md](staging-deployment.md). El ensayo local no cierra 3C.

Lo que sigue conserva los criterios de cierre del paso completo **para retomarlo más adelante**, sin bloquear el paso 4.

Después del acceso, implementar un recorrido mínimo de CU001/CU002 — SCRUM-13/SCRUM-14 y CU004/CU005 — SCRUM-41/SCRUM-42: registrar y consultar un cliente ficticio, crear su expediente y consultarlo con alcance autorizado. Incorporar la asignación o concesión explícita mínima que exija el contrato, sin abrir acceso global para simplificar la demostración.

Antes de ampliar exhaustivamente los módulos, demostrar el prototipo de **RUP 16.6**: identidad autenticada, expediente accesible, carga privada segura, consulta autorizada, denegación para otra identidad y recuperación verificable con datos ficticios. Esto adelanta el recorrido mínimo de CU008/CU012/CU013 y un ensayo acotado de copia y recuperación de datos, objetos y manifiesto. La verificación de contenido, antimalware y hash debe ser real; las herramientas simuladas no demuestran ese requisito.

Desplegar ese prototipo en un entorno de prueba separado, con HTTPS, web/API bajo el mismo origen, secretos de servidor y datos ficticios. Verificar allí el mismo recorrido, la privacidad de cuarentena y la restauración aislada del conjunto ficticio. Registrar cómo se hizo la copia, qué se recuperó y qué limitaciones permanecen. El ensayo no sustituye la gestión completa de respaldos de la etapa 6 ni acredita objetivos RPO/RTO de producción.

Terminado cuando el recorrido mínimo y las denegaciones tengan evidencia tanto local como en el despliegue de prueba, y la recuperación se haya verificado. El despliegue y el prototipo están pendientes; las verificaciones de acceso de los pasos 1 y 2 no los acreditan. Se busca reducir pronto los riesgos de integración y operación sin esperar a completar todos los formularios y funcionalidades.

### 4. Ampliar clientes, expedientes y seguimiento

Completar CU001–CU003 — SCRUM-13/SCRUM-14/SCRUM-15 con edición, búsqueda y paginación. Validar datos en servidor, normalizar identificaciones y distinguir coincidencia de nombre de duplicado real. Verificar revisiones desactualizadas y auditoría. No añadir eliminación de clientes: no está definida en esta versión.

Ampliar CU004/CU005/CU031 — SCRUM-41/SCRUM-42/SCRUM-48 para consulta y edición completas. Continuar con CU007/CU025/CU015 — SCRUM-44/SCRUM-47/SCRUM-45 para asignaciones y acceso, y CU006/CU017 — SCRUM-43/SCRUM-46 para estados y avances.

Terminado cuando se conserve el cliente principal y el folio estable, haya un único principal activo, las reasignaciones mantengan historial, los listados respeten alcance y los cambios cumplan la matriz de estados. Los avances agregan historial en lugar de sobrescribirlo. Conclusión y reapertura deben comprobar la facultad jurídica acordada.

### 5. Ampliar la gestión documental

Ampliar el recorrido de CU008/CU012/CU013 — SCRUM-127/SCRUM-131/SCRUM-132 ya probado en el prototipo: autorizar la carga para un expediente, transferir a cuarentena, registrar un trabajo persistente, verificar contenido/antimalware/hash y habilitar consulta o descarga exclusivamente al recurso autorizado. El trabajador se ejecuta como proceso del mismo proyecto, fuera de las peticiones interactivas.

Continuar con clasificación, asociación y búsqueda (CU009–CU011), metadatos y versiones (CU014/CU029), revisión y estados (CU016/CU026) y retiro/recuperación (CU027/CU028). Conservar el original y vincular la revisión jurídica a la versión precisa. PT03 y PT05 afectan formatos y conservación.

Terminado cuando un documento ficticio recorra carga privada, verificación, consulta autorizada y recuperación verificable; otra identidad debe recibir denegación. Comprobar además cuarentena inaccesible, fallo del analizador, archivo rechazado, reintentos sin duplicación, publicación concurrente y acceso a versiones anteriores conforme al permiso. Un stub que marca todo como seguro no completa esta etapa.

### 6. Administración, configuración y operación

Completar interfaces de usuarios/permisos (CU018/CU019), consulta de bitácora (CU020) y configuración (CU021). Los catálogos usados se desactivan sin romper referencias y los parámetros no permiten anular controles obligatorios.

Completar la gestión de respaldos y restauración (CU022/CU030 — SCRUM-196/SCRUM-197) a partir del ensayo acotado del prototipo: datos, objetos y manifiesto; almacenamiento cifrado independiente; programación, historial, reintentos y supervisión; verificación aislada; permisos y autenticación reforzada; restricciones actuales antes de reactivar servicio. Las bases de auditoría, trabajos y recuperación se habrán incorporado durante los pasos anteriores.

Terminado cuando la administración respete las facultades y metadatos mínimos y exista un ensayo documentado de restauración con verificación de datos y objetos. Medir RPO/RTO y compararlos con PT04. No declarar respaldo completo a partir de un volcado que omita archivos.

### 7. Diseño del frontend

La base visual se adelantó por petición del usuario el 4 de noviembre de 2026,
usando su maqueta y logo. Se completó la revisión de las pantallas disponibles
en desarrollo con énfasis en navegación móvil, teclado, formularios, tablas y
mensajes. Las pantallas de funciones operativas pendientes acompañarán a sus
casos de uso. [Cambios y verificación](interface.md#paso-7).

### 8. Configuración de producción, revisión de seguridad y lanzamiento

Render alojará la web, la API y el trabajador. Supabase alojará PostgreSQL,
Auth y Storage. Queda adaptar el paquete al despliegue en Render, separar
desarrollo, pruebas y producción, y verificar los recorridos en el destino.
[Verificación previa al lanzamiento](release-verification.md).

- Configurar secretos, su custodia y rotación; retirar credenciales de propietario del proceso ordinario y comprobar los privilegios mínimos del rol de sesiones y de los trabajadores.
- Revisar Supabase Auth, invitaciones, MFA, recuperación y límites de intentos. La limitación local por proceso debe adaptarse a varias instancias y coordinarse con los controles del proveedor.
- Configurar web y API bajo el origen HTTPS acordado, proxy confiable, cookies `Secure`/`HttpOnly`/`SameSite`, CSRF y expiración; verificarlos en navegador sobre ese alojamiento.
- Comprobar permisos de PostgreSQL, RLS, funciones y políticas de Storage con identidades autorizadas y denegadas. Aplicar migraciones de forma controlada y documentar el procedimiento de reversión o recuperación sin ejecutarlas al arrancar.
- Verificar respaldos de datos y objetos, claves de recuperación, manifiestos y restauración aislada; medir RPO/RTO conforme a PT04 y registrar las restricciones vigentes antes de habilitar servicio.
- Configurar monitoreo y alertas de fallos de acceso, sesiones, trabajos, almacenamiento y copias, con logs sin secretos ni contenido jurídico completo. Definir responsables, mantenimiento y respuesta a incidentes.

Terminado cuando la revisión y las pruebas del alojamiento final tengan evidencia, las decisiones pendientes aplicables estén resueltas y el responsable acuerde el lanzamiento. El despliegue temprano del prototipo ayuda a esta preparación, pero no sustituye esta revisión final.

## Cómo solicitar el siguiente avance

Pedir una funcionalidad acotada mediante su CU/Jira facilita revisar el resultado y preparar un commit con un propósito concreto. Conviene indicar comportamiento esperado, criterios de aceptación y que se conserva el diseño KVG existente. Si un prerrequisito todavía no existe, el avance debe incluirlo o dividirse en entregas ejecutables.

**Conexión inicial (completada; referencia):**

> Conecta y verifica el proyecto Supabase donde ya apliqué el modelo físico. No reinstales la baseline ni crees un proyecto nuevo. Ejecuta los diagnósticos de lectura de API y SQL, revisa funciones, permisos, RLS y buckets, y registra la evidencia y las diferencias. No modifiques datos ni crees identidades durante este diagnóstico. Mantén las credenciales fuera del repositorio y señala qué falta para cerrar el paso 1.

**Acceso (implementado y verificado en desarrollo; referencia):**

> Implementa CU023 y CU024, SCRUM-149 y SCRUM-150: inicio y cierre de sesión con Supabase Auth, MFA y sesión operativa del servidor mediante cookie HttpOnly. Incluye renovación/revocación, protección CSRF, autorización básica y auditoría. Verifica cuenta inactiva, sesión vencida y acceso sin autorización. Usa formularios funcionales con el estilo mínimo existente y documenta los valores propuestos de sesión.

**Recorrido mínimo 3A (implementado y verificado en desarrollo; referencia):**

> Implementa el paso 3: un recorrido mínimo de CU001/CU002 y CU004/CU005 para registrar y consultar un cliente ficticio, crear su expediente y consultarlo con identidad, permiso y alcance reales. Incluye los prerrequisitos mínimos de rol/asignación que exija el contrato, auditoría y pruebas permitidas/denegadas. Mantén controles funcionales con el estilo mínimo existente y registra lo que falta para el prototipo RUP 16.6.

**Ampliación del registro de clientes:**

> Implementa CU001, SCRUM-13: registrar cliente de principio a fin. Usa el modelo existente, valida campos en servidor, normaliza identificaciones, impide duplicados cuando la identificación exige unicidad y registra auditoría. Requiere permiso y alcance. Incluye un formulario funcional con estilos mínimos y pruebas de éxito, datos inválidos, duplicado y acceso denegado. Indica el nombre sugerido del commit.

**Expedientes:**

> Implementa CU004 y CU005, SCRUM-41 y SCRUM-42: crear y consultar expedientes de clientes existentes, con folio interno único generado por el sistema y estado NUEVO. Incluye listado paginado y detalle autorizados, auditoría y pruebas de acceso cruzado. Mantén el frontend funcional sin trabajar el diseño.

**Carga documental:**

> Implementa CU008, SCRUM-127: carga privada para un expediente autorizado, cuarentena y trabajo persistente de verificación de contenido, antimalware y SHA-256. El documento debe permanecer inaccesible hasta un resultado apto. Comprueba acceso denegado, rechazo, fallo del analizador y reintento sin duplicación. No sustituyas el análisis real por una aprobación automática; mantén la interfaz con el estilo mínimo existente.

**Consulta de bitácora y configuración (implementadas)**

> Implementa CU020/CU021. Permite consultar la bitácora con filtros y
> paginación, y administrar catálogos y parámetros permitidos con revisión y
> motivo. Verifica los límites y los permisos de cada operación y mantiene la
> interfaz KVG.

**Petición para cerrar el paso 6C cuando exista infraestructura operativa**

> Completa CU022/CU030 (SCRUM-196/197) a partir de la copia y restauración
> por ID de desarrollo. Integra destino independiente, programación y alertas.
> Conserva la verificación de datos, objetos y manifiesto, la autenticación
> reforzada y las restricciones actuales al restaurar. Documenta los resultados
> verificables de PT04.

**Petición para retomar el prototipo y despliegue cuando haya recursos:**

> Con acceso y cliente/expediente mínimos funcionando, completa el prototipo de RUP 16.6 con datos ficticios: identidad real, carga privada segura, consulta autorizada, denegación para otra identidad y copia/recuperación verificable de datos y objetos. Despliégalo en un entorno de prueba con HTTPS y registra la evidencia. Mantén la usabilidad funcional con el estilo mínimo existente y distingue este ensayo de la gestión completa de respaldos de la etapa 6.

**Lanzamiento final:**

> Prepara el paso 8: configura el alojamiento de producción acordado y revisa secretos, privilegios, Auth/MFA, límites para varias instancias, HTTPS/proxy/cookies/CSRF, PostgreSQL/RLS/Storage, migraciones, restauración y monitoreo. Verifica los recorridos en ese entorno y documenta la evidencia y los pendientes antes del lanzamiento.

## Criterio común de terminado

- El recorrido solicitado funciona con persistencia real en desarrollo y datos ficticios; los mensajes distinguen éxito, error y ausencia de datos.
- El servidor valida entradas y permisos vigentes; las consultas y mutaciones respetan el mismo alcance y los campos protegidos no se aceptan libremente del navegador.
- Los cambios relevantes conservan autoría, auditoría y coherencia transaccional/concurrencia según el caso.
- Pasan las comprobaciones del repositorio y las pruebas relevantes del comportamiento y sus denegaciones. Se describen las verificaciones que no pudieron ejecutarse.
- Se actualizan contratos y documentación afectados, se declara cualquier dependencia pendiente y se propone un nombre de commit acorde al cambio.
- Se verifica usabilidad en cada avance: etiquetas y mensajes claros, navegación y operación por teclado, y estados funcionales de carga, error y ausencia de datos. Se reutiliza el estilo mínimo autorizado; el diseño definitivo y las animaciones siguen pendientes.
