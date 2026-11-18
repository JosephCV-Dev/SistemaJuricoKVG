# Pruebas de integración de datos

Esta carpeta conserva los escenarios de validación del modelo. `identity-session.sql`
ya es ejecutable mediante `npm run test:identity:schema`: comprueba el contrato de
identidad y el rechazo sin identidad en una transacción revertida. El recorrido con
Auth/MFA y sesiones reales se ejecuta con `npm run test:identity:live`; sus scripts
están en `apps/api/scripts`. No se utilizan datos reales del despacho.

El incremento CU023/CU024 probó identidad real, TOTP, sesión operativa, RPC permitida
y denegada, renovación concurrente, cierre/revocación y vencimiento. Cuenta inactiva,
permisos/contextos, errores transitorios y límites de intentos tienen pruebas HTTP
locales con puertos simulados. La evidencia y los límites están en
[identity.md](../../docs/identity.md). Esto no acredita todos los escenarios de la
tabla ni los casos de uso de negocio pendientes.

El paso 3A añade `records.sql` (`npm run test:records:schema`) para comprobar
metadatos, RLS y ausencia de privilegios directos. `npm run test:records:live` pasó
37 comprobaciones reales de cliente/expediente: duplicados normalizados, reintento
concurrente sin dobles altas, alcance entre identidades, asignación, revocación y
auditoría. También se comprobó el recorrido en Chromium local. Los escenarios de
archivos, recuperación y ampliaciones de la tabla siguen pendientes; ver
[clients-and-cases.md](../../docs/clients-and-cases.md).

Las pruebas deben ejecutar los puntos de entrada reales, con identidades y sesiones de Supabase Auth, y verificar el estado persistido mediante una conexión de inspección exclusiva del entorno de pruebas. Los clientes de usuario y de servicio conservan los mismos privilegios que tendrán en operación.

| Área / referencia            | Caso y resultado esperado                                                                                                                                                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instalación                  | Instalar en Supabase nuevo y comprobar 37 tablas, restricciones, funciones, catálogos y buckets privados. Repetir la instalación debe rechazar el esquema previo sin alterar datos.                                                                                          |
| Bootstrap                    | Rechazar identidades iguales, inexistentes o sin correo confirmado. Admitir dos responsables confirmados y aprobación identificable una sola vez. La segunda llamada no debe crear perfiles ni permisos duplicados.                                                          |
| Privilegios                  | `anon`, `authenticated` y `service_role` no pueden leer/escribir tablas ni ejecutar funciones internas directamente. `authenticated` puede llamar a `kvg_operar`; solo `service_role` puede llamar a `kvg_trabajar`. Ninguno de esos roles puede ejecutar `kvg_inicializar`. |
| CU023 / CU024                | Rechazar token AAL1, sesión Auth ajena/inexistente, cuenta inactiva y sesión operativa vencida/revocada. Iniciar con AAL2 válido y comprobar cierre e inactividad. Un token previo no permite continuar tras la revocación.                                                  |
| CU019 / VD09                 | Revocar una capacidad o concesión con el token aún vigente y comprobar que consultas, búsquedas, conteos y descargas dejan de revelar el recurso. El administrador técnico no obtiene lectura jurídica por su rol.                                                           |
| CU001–CU003 / VD01           | Registrar y buscar un cliente dentro del alcance autorizado; rechazar identificación normalizada duplicada cuando el catálogo exija unicidad. Comprobar que nombres iguales no se convierten por sí solos en una clave única.                                                |
| CU003 / CU031                | Editar el mismo recurso desde dos solicitudes con igual revisión; una confirma y la otra recibe `40001`, sin sobrescritura silenciosa ni historial parcial.                                                                                                                  |
| CU004 / CU007 / CU025 / VD02 | Crear expediente con folio único y estado `NUEVO`. Al asignar o reasignar, conservar historial y garantizar un único principal vigente incluso con solicitudes concurrentes.                                                                                                 |
| CU018 / CU019 / VD03         | Desactivar al principal activo o retirar la última capacidad administrativa exige relevo autorizado; no puede dejar el asunto o la instalación sin responsable.                                                                                                              |
| CU006                        | Rechazar transiciones de estado no permitidas, cambios sin motivo y decisiones jurídicas sin facultad vigente. Resumen e historial deben quedar consistentes en la misma transacción.                                                                                        |
| CU008 / CU014 / VD06         | Una carga insegura, excedida o con verificación fallida permanece bloqueada. No puede publicarse una versión, consultarse contenido ni descargarse el original hasta completar los controles externos.                                                                       |
| CU014 / VD07                 | Reintentar publicación tras perder la respuesta no duplica versión ni original. Las versiones anteriores se conservan y existe una sola vigente.                                                                                                                             |
| CU014 / CU029 / VD04         | Rechazar una versión vigente perteneciente a otro documento; la relación compuesta debe conservar la identidad de documento y versión.                                                                                                                                       |
| CU016 / CU026 / VD05         | Una revisión jurídica de una versión anterior no valida la vigente. El estado `VALIDADO` exige la revisión y facultad correctas de la versión exacta.                                                                                                                        |
| CU010 / VD08                 | Corregir la asociación documental exige acceso a origen y destino. Una denegación conserva la asociación original y su evento de rechazo.                                                                                                                                    |
| CU013 / VD13                 | Registrar la autorización de entrega sin afirmar una descarga efectiva si falta evidencia de transferencia. No devolver localizadores privados ni credenciales en resultados ajenos al flujo autorizado.                                                                     |
| CU027 / CU028 / VD10         | El retiro conserva originales e historial. Recuperar un documento sin original verificable mantiene su indisponibilidad y conduce al procedimiento de restauración.                                                                                                          |
| CU020                        | Intentos rechazados dejan auditoría sin escrituras parciales del caso de uso. Comprobar actor/sesión, inmutabilidad y metadatos acotados sin tokens, contraseñas o archivos.                                                                                                 |
| CU021 / VD12 / VD14          | Rechazar parámetros que pretendan omitir controles. La baja de usuarios o catálogos conserva autorías y referencias históricas.                                                                                                                                              |
| CU022 / CU030 / VD11         | Una copia incluye datos y objetos con manifiesto y hashes verificables. Restaurar una copia anterior a una revocación aplica primero las restricciones actuales; no reactiva accesos ni documentos bloqueados. Medir RPO y RTO durante el ensayo.                            |

Los identificadores CU y VD proceden del RUP de Elaboración 2.0 y del modelo lógico/diccionario 1.1. Los casos se implementarán junto al incremento funcional correspondiente. Los procesos externos necesitan adaptadores reales o entornos controlados que permitan comprobar sus efectos, sin sustituir una verificación antimalware o una restauración completa por un resultado simulado satisfactorio.

En cada prueba RPC se deben distinguir un fallo de transporte y un rechazo funcional `{ "correcto": false }`. El código HTTP por sí solo no demuestra que una operación se haya confirmado.

`documents.sql` verifica helpers privados, separación de RPC, ausencia de CRUD
directo, buckets y política restrictiva de Storage, en una transacción de solo
lectura que revierte. `recovery-platform-fixture.sql` es exclusivo del contenedor
efímero del ensayo; no se debe ejecutar contra Supabase.

`client-edit-local.sql` comprueba CU002/CU003 con identidades de prueba en
PostgreSQL efímero. Para repetirlo en un contenedor aislado sin puertos, cargar
en orden `recovery-platform-fixture.sql`, la baseline, las migraciones y finalmente
`records.sql` y `client-edit-local.sql`. La prueba revierte los datos y las
funciones del fixture que usa para representar la sesión. La integración real
con Supabase se comprueba por separado mediante `npm run test:records:live`.

`case-assignments-local.sql` verifica CU007/CU015/CU025 con cinco identidades
ficticias. Requiere PostgreSQL efímero sin red, el fixture de plataforma, baseline
y migraciones. Ejecuta el RPC con roles y contexto de la prueba, comprueba
separación administrativa, revocación, motivo e historial y revierte los datos.

`case-tracking-local.sql` verifica estados y avances de CU006/CU017 en
PostgreSQL aislado. Usa el fixture de plataforma, baseline y migraciones.
Prueba los permisos y la revisión, y representa una versión documental
ficticia con metadatos de Storage. Revierte la prueba completa.

`document-organization-local.sql` cubre CU009–CU011 en PostgreSQL aislado,
con el fixture de plataforma, baseline y migraciones. Comprueba alcance antes
de mostrar resultados, categorías, revisión, traslado, historial y hash.
Revierte sus datos y usa metadatos Storage ficticios.

`document-versions-local.sql` verifica CU014/CU029 después del mismo fixture,
baseline y migraciones. Comprueba edición auditada, reserva idempotente, dos
intentos con la misma revisión, rechazo, historial con permiso independiente
de descarga y conservación de la revisión jurídica de la primera versión.
Revierte la transacción y representa Storage con referencias ficticias.
