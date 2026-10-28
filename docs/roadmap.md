# Próximos avances sin diseño visual

## Estado de partida

Esta entrega prepara un monorepo de npm workspaces: `apps/web` para React/TypeScript/Vite, `apps/api` para NestJS y `packages/contracts` para tipos HTTP compartidos. La funcionalidad inicial se limita a comprobar la salud de la aplicación. Los módulos de negocio, la conexión a Supabase y los controles de seguridad quedan pendientes.

La trazabilidad y los requisitos están en [requirements.md](requirements.md). La estructura permite avanzar mediante casos de uso completos: entrada funcional, validación del servidor, reglas, persistencia, autorización, resultado verificable y pruebas relevantes. El trabajo visual se realizará después; cada interfaz provisional usará controles HTML semánticos y mensajes comprensibles.

## Orden recomendado

### 1. Verificar la instalación de datos y la integración

Preparar un entorno Supabase de desarrollo con datos ficticios, comprobar Auth y Storage y revisar/aplicar el modelo físico suministrado mediante el flujo de migraciones. Verificar funciones, permisos, RLS y la superficie expuesta antes de usar datos del negocio. Registrar el procedimiento y sus resultados; no ejecutar la instalación inicial sobre un esquema existente para forzarla a pasar.

La integración ordinaria debe conservar la identidad autenticada del usuario. Las operaciones privilegiadas tienen adaptadores e identidades limitadas y separados del acceso ordinario. Una conexión de propietario o una clave con capacidad de omitir RLS no sirve como sustituto de la autorización por usuario.

Terminado cuando la instalación sea reproducible en desarrollo, las comprobaciones de esquema y permisos tengan evidencia y la API pueda ejercer una operación permitida y rechazar otra no autorizada. La salud del proceso por sí sola no demuestra conexión o disponibilidad de Supabase.

### 2. Acceso, sesiones, permisos y auditoría base

Implementar CU023/CU024 — SCRUM-149/SCRUM-150 y las bases necesarias de CU018/CU019. Integrar cuentas invitadas, MFA, sesión operativa del servidor, cookie protegida, renovación/revocación, CSRF y autorización por operación y alcance. Incorporar el registro de auditoría desde las primeras operaciones, aunque la pantalla de CU020 llegue después.

Definir el alta inicial de un administrador sin registro público ni claves privilegiadas en el frontend. La asignación de un rol no debe conceder lectura de expedientes automáticamente. Los valores de duración de sesión y la matriz definitiva se documentan con PT02/PT07.

Terminado cuando se comprueben inicio/cierre de sesión, cuenta inactiva, sesión vencida o revocada, peticiones de cambio sin protección CSRF, MFA y acceso cruzado entre identidades. Las denegaciones deben ocurrir en el servidor y las credenciales no deben aparecer en respuestas ni logs.

### 3. Clientes

Implementar CU001–CU003 — SCRUM-13/SCRUM-14/SCRUM-15: registro, consulta y actualización con formularios sencillos, búsqueda y paginación. Validar datos en servidor, normalizar identificaciones, distinguir coincidencia de nombre de duplicado real y comprobar alcance. Conservar autoría, revisión y auditoría; probar cambios concurrentes.

Terminado cuando un usuario autorizado pueda registrar, encontrar y corregir un cliente, y las entradas inválidas, los identificadores únicos duplicados, las consultas ajenas y las revisiones desactualizadas reciban el resultado esperado. No añadir eliminación de clientes: no está definida como caso de uso en esta versión.

### 4. Expedientes y seguimiento

Implementar CU004/CU005/CU031 — SCRUM-41/SCRUM-42/SCRUM-48 para alta, consulta y edición. Continuar con CU007/CU025/CU015 — SCRUM-44/SCRUM-47/SCRUM-45 para asignaciones y acceso, y CU006/CU017 — SCRUM-43/SCRUM-46 para estados y avances.

Terminado cuando se conserve el cliente principal y el folio estable, haya un único principal activo, las reasignaciones mantengan historial, los listados respeten alcance y los cambios cumplan la matriz de estados. Los avances agregan historial en lugar de sobrescribirlo. Conclusión y reapertura deben comprobar la facultad jurídica acordada.

### 5. Documentos y recorrido arquitectónico completo

Comenzar por CU008/CU012/CU013 — SCRUM-127/SCRUM-131/SCRUM-132: autorizar la carga para un expediente, transferir a cuarentena, registrar un trabajo persistente, verificar contenido/antimalware/hash y habilitar consulta o descarga exclusivamente al recurso autorizado. El trabajador se ejecuta como proceso del mismo proyecto, fuera de las peticiones interactivas.

Continuar con clasificación, asociación y búsqueda (CU009–CU011), metadatos y versiones (CU014/CU029), revisión y estados (CU016/CU026) y retiro/recuperación (CU027/CU028). Conservar el original y vincular la revisión jurídica a la versión precisa. PT03 y PT05 afectan formatos y conservación.

Terminado cuando un documento ficticio recorra carga privada, verificación, consulta autorizada y recuperación verificable; otra identidad debe recibir denegación. Comprobar además cuarentena inaccesible, fallo del analizador, archivo rechazado, reintentos sin duplicación, publicación concurrente y acceso a versiones anteriores conforme al permiso. Un stub que marca todo como seguro no completa esta etapa.

### 6. Administración, configuración y operación

Completar interfaces de usuarios/permisos (CU018/CU019), consulta de bitácora (CU020) y configuración (CU021). Los catálogos usados se desactivan sin romper referencias y los parámetros no permiten anular controles obligatorios.

Implementar respaldos y restauración (CU022/CU030 — SCRUM-196/SCRUM-197): datos, objetos y manifiesto; almacenamiento cifrado independiente; verificación aislada; permisos y autenticación reforzada; restricciones actuales antes de reactivar servicio. Las bases de auditoría, trabajos y recuperación se habrán incorporado durante los pasos anteriores.

Terminado cuando la administración respete las facultades y metadatos mínimos y exista un ensayo documentado de restauración con verificación de datos y objetos. Medir RPO/RTO y compararlos con PT04. No declarar respaldo completo a partir de un volcado que omita archivos.

### 7. Diseño del frontend

Con los recorridos funcionales y sus contratos estables, abordar colores, tipografía, distribución, componentes visuales, estados de interacción y animaciones que se acuerden. Mantener las reglas y verificaciones de los pasos anteriores.

## Cómo solicitar el siguiente avance

Pedir una funcionalidad acotada mediante su CU/Jira facilita revisar el resultado y preparar un commit con un propósito concreto. Conviene indicar comportamiento esperado, criterios de aceptación y que el diseño sigue pospuesto. Si un prerrequisito todavía no existe, el avance debe incluirlo o dividirse en entregas ejecutables.

**Primera petición recomendada:**

> Prepara y verifica la integración con Supabase en desarrollo usando datos ficticios. Revisa el modelo físico y el flujo de migraciones, comprueba Auth/Storage y permisos, y documenta lo ejecutado y cualquier pendiente. Mantén el acceso ordinario con identidad del usuario. No hagas diseño visual ni uses datos reales.

**Acceso:**

> Implementa CU023 y CU024, SCRUM-149 y SCRUM-150: inicio y cierre de sesión con Supabase Auth, MFA y sesión operativa del servidor mediante cookie HttpOnly. Incluye renovación/revocación, protección CSRF, autorización básica y auditoría. Verifica cuenta inactiva, sesión vencida y acceso sin autorización. Usa formularios funcionales sin diseño visual y documenta los valores propuestos de sesión.

**Primer caso de clientes:**

> Implementa CU001, SCRUM-13: registrar cliente de principio a fin. Usa el modelo existente, valida campos en servidor, normaliza identificaciones, impide duplicados cuando la identificación exige unicidad y registra auditoría. Requiere permiso y alcance. Incluye un formulario funcional sin estilos y pruebas de éxito, datos inválidos, duplicado y acceso denegado. Indica el nombre sugerido del commit.

**Expedientes:**

> Implementa CU004 y CU005, SCRUM-41 y SCRUM-42: crear y consultar expedientes de clientes existentes, con folio interno único generado por el sistema y estado NUEVO. Incluye listado paginado y detalle autorizados, auditoría y pruebas de acceso cruzado. Mantén el frontend funcional sin trabajar el diseño.

**Carga documental:**

> Implementa CU008, SCRUM-127: carga privada para un expediente autorizado, cuarentena y trabajo persistente de verificación de contenido, antimalware y SHA-256. El documento debe permanecer inaccesible hasta un resultado apto. Comprueba acceso denegado, rechazo, fallo del analizador y reintento sin duplicación. No sustituyas el análisis real por una aprobación automática; mantén la interfaz sin diseño visual.

## Criterio común de terminado

- El recorrido solicitado funciona con persistencia real en desarrollo y datos ficticios; los mensajes distinguen éxito, error y ausencia de datos.
- El servidor valida entradas y permisos vigentes; las consultas y mutaciones respetan el mismo alcance y los campos protegidos no se aceptan libremente del navegador.
- Los cambios relevantes conservan autoría, auditoría y coherencia transaccional/concurrencia según el caso.
- Pasan las comprobaciones del repositorio y las pruebas relevantes del comportamiento y sus denegaciones. Se describen las verificaciones que no pudieron ejecutarse.
- Se actualizan contratos y documentación afectados, se declara cualquier dependencia pendiente y se propone un nombre de commit acorde al cambio.
- Los controles HTML son utilizables y comprensibles; colores, animaciones y diseño visual siguen pendientes hasta que se soliciten.
