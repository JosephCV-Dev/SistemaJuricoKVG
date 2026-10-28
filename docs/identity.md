# CU023 y CU024: identidad y sesión

Este incremento corresponde a **CU023 / SCRUM-149** (iniciar sesión) y **CU024 / SCRUM-150** (cerrar sesión), con las bases de permisos y auditoría necesarias para los siguientes casos de uso. Sigue RN01–RN03, RN17–RN18 y los valores de sesión sujetos a PT02. El catálogo y sus límites están en [requirements.md](requirements.md).

## Estado y alcance de la evidencia

Están implementados el frontend, el cliente HTTP y el backend de acceso: correo y contraseña, alta/verificación TOTP real, consulta y renovación de sesión y cierre de sesión. La interfaz usa controles HTML semánticos, mensajes de carga y error y cancelación de solicitudes. Por petición posterior del usuario, incorpora estilos mínimos para legibilidad y formularios; no incluye animaciones y el diseño definitivo sigue pendiente.

El **28 de octubre de 2026** se aplicaron las dos migraciones de identidad en desarrollo, se prepararon dos cuentas ficticias confirmadas sin enviar correos y se ejecutó el recorrido HTTP con Supabase Auth, MFA, sesión operativa KVG y RPC reales. Se comprobó el registro público deshabilitado, el acceso propio permitido, rechazos sin autorización, renovación, cierre/revocación y vencimiento. También se comprobaron el cifrado de la carga y el acceso restringido del rol de sesiones. La baseline permanece intacta.

Las pruebas locales de API y cliente HTTP usan puertos o respuestas simuladas y complementan esa evidencia real. La última ejecución real pasó 39 comprobaciones, incluidas renovación concurrente, respuesta antigua sin sobrescritura del token nuevo y registro público deshabilitado. **No se ha probado el recorrido en navegador ni el entorno de producción.** La revisión previa del catálogo está documentada por separado en [supabase-verification.md](supabase-verification.md).

CU018/CU019 completos —administrar usuarios y roles/permisos— no forman parte de esta entrega. El aprovisionamiento de prueba y la consulta de capacidades actuales son las bases necesarias para CU023/CU024, no una interfaz administrativa terminada. El siguiente avance es el paso 3: cliente y expediente mínimos, con permiso, alcance y auditoría.

## Identidades que deben distinguirse

| Identidad                       | Propósito                                                                                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Usuario Supabase Auth           | Credenciales, correo confirmado, factores MFA y sesión del proveedor. Su identificador es `auth.users.id`.                                                                               |
| Usuario operativo KVG           | Perfil del integrante, cuenta activa, roles y permisos. Tiene `kvg.usuario.usuario_id`, relacionado con Auth mediante `auth_usuario_id`. Su identificador no es el mismo que el de Auth. |
| Rol técnico `kvg_session_store` | Acceso limitado a la tabla técnica de sesiones web. No representa al integrante ni tiene acceso de negocio a KVG, Auth o Storage.                                                        |

Tener una cuenta Auth o superar contraseña/MFA no concede por sí solo una sesión operativa KVG. La API debe comprobar también cuenta, sesión, capacidades actuales y, en cada caso de uso, alcance sobre el recurso. Los roles devueltos a la interfaz son informativos; el navegador no decide permisos.

Las cuentas ordinarias se incorporan por invitación y se comprobó que el registro público de Auth está deshabilitado. En desarrollo ya se prepararon dos identidades ficticias distintas, con correo confirmado mediante el SDK administrativo y sin enviar correos: un responsable técnico y un responsable jurídico. Esto es preparación de pruebas, no el procedimiento de altas de producción.

Antes de ejecutar `public.kvg_inicializar`, comprobar si el bootstrap ya existe. La función requiere dos identidades Auth distintas confirmadas, una referencia de aprobación y el estado inicial previsto por el SQL. Sólo se ejecuta como propietario cuando corresponde; no se repite sobre cuentas operativas existentes. El procedimiento está en [database/README.md](../database/README.md). La aplicación no inicializa ni migra la base al arrancar.

Las credenciales y claves TOTP de las dos cuentas se conservan en `apps/api/.local/identity-development-accounts.json`, ignorado por Git y con permisos `0600`; el directorio local se restringe a `0700`. No incluir sus valores en esta guía, commits, capturas, respuestas HTTP o logs. Las claves administrativas utilizadas para preparar las cuentas no pertenecen a las variables del frontend ni a la sesión ordinaria del usuario.

## Configuración del servidor

Usar el Supabase existente de desarrollo y las variables de [supabase-setup.md](supabase-setup.md). La configuración de sesión debe mantenerse en `apps/api/.env` u otro canal de secretos del servidor, nunca en variables `VITE_*`.

| Variable                   | Uso y condición                                                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`             | URL del mismo proyecto cuya instalación se verificó.                                                                                                                                                                 |
| `SUPABASE_PUBLISHABLE_KEY` | Clave publicable del proyecto; el acceso ordinario se realiza con la identidad real del usuario.                                                                                                                     |
| `SESSION_DATABASE_URL`     | Conexión PostgreSQL del rol limitado `kvg_session_store`, con el sufijo de proyecto que exija el pooler si se usa. Exige TLS `verify-full` fuera de loopback. No sustituirla por una conexión de propietario.        |
| `SESSION_SECRET`           | Secreto aleatorio del servidor para proteger la cookie firmada. Al menos 32 caracteres, sin espacios adicionales y distinto de otras claves.                                                                         |
| `SESSION_ENCRYPTION_KEY`   | Clave de 32 bytes codificada en base64 canónica para cifrar la carga de sesión con AES-256-GCM. Es distinta de `SESSION_SECRET` y no se guarda en la tabla de sesiones.                                              |
| `APP_ORIGIN`               | Origen visible de la web: por ejemplo, `http://127.0.0.1:5173` en desarrollo, sin ruta. Debe coincidir con el origen del navegador; el puerto interno de Nest no es el origen de la web cuando se usa el proxy Vite. |
| `TRUST_PROXY`              | Configuración explícita de confianza en el proxy. Desactivada para acceso local directo. Sólo activarla cuando el alojamiento use un proxy confiable que permita reconocer HTTPS correctamente.                      |

Las herramientas de preparación y prueba también requieren `DATABASE_URL` de propietario para el proyecto de desarrollo. `setup:identity:dev` necesita además `SUPABASE_SECRET_KEY` para crear las identidades ficticias sin correos. Estas variables se reservan a esas herramientas; no sustituyen el rol restringido del almacén ni la identidad del usuario en RPC.

`SESSION_DATABASE_URL`, `SESSION_SECRET` y `SESSION_ENCRYPTION_KEY` se configuran juntas. La comprobación pública de salud puede utilizarse sin la integración de identidad; eso no vuelve operativos los endpoints de sesión.

La migración [202610280001_server_sessions.sql](../database/migrations/202610280001_server_sessions.sql) prepara `kvg_servidor.sesion_web` y el rol técnico sin contraseña inicial; su credencial se aprovisiona por un canal local separado. La carga queda cifrada y el identificador de sesión se conserva como hash, con marcas de revocación para impedir que una respuesta tardía restaure una sesión cerrada.

La migración [202610280002_identity_session_context.sql](../database/migrations/202610280002_identity_session_context.sql) incorpora la operación fija `sesion.consultar` al contrato RPC. Devuelve contexto operativo actual, sin conceder alcance adicional sobre expedientes. Ambas migraciones ya se aplicaron explícitamente en desarrollo y se registran con su checksum; no modifican el archivo de baseline.

## Preparación explícita del entorno de desarrollo

Desde la raíz del repositorio:

```sh
npm run setup:identity:dev
```

Este comando requiere `NODE_ENV=development` y comprueba que SQL y API correspondan al mismo proyecto. Tiene efectos de aprovisionamiento: aplica las migraciones pendientes y registra sus checksums, prepara el rol limitado y sus credenciales, genera las claves de sesión que falten y actualiza el archivo local de configuración. Crea las dos cuentas ficticias mediante Auth Admin sin enviar correos y ejecuta `kvg_inicializar` únicamente si no hay perfiles operativos.

La preparación ya se realizó en el entorno actual; no hace falta repetirla para arrancar la web. Si hay bootstrap y no se conserva el archivo de cuentas correspondiente, el script se detiene en lugar de sustituir perfiles. Si una migración aplicada cambia de checksum, también se detiene. No es un despliegue de producción ni un paso automático del arranque.

## Flujo de sesión implementado

1. El navegador recibe una cookie con un identificador opaco de sesión. Los tokens de Supabase permanecen en la carga cifrada del servidor; no se devuelven a React ni se guardan en `localStorage`.
2. La contraseña válida inicia el estado pendiente de MFA. El usuario verifica un factor TOTP existente o configura uno nuevo y presenta el código de seis dígitos. No se reemplaza la verificación del proveedor por un código fijo de prueba.
3. Con MFA real `aal2`, la API inicia la sesión operativa mediante `kvg_operar` / `sesion.iniciar`. La cookie cambia conforme a la política de sesión para no conservar una identidad previa al acceso.
4. El guard de cada petición privada recupera y valida la sesión del servidor, comprueba el proveedor y consulta el contexto KVG mediante `sesion.consultar`. Cuenta y capacidades vigentes prevalecen sobre información anterior. Las rutas sin política explícita se deniegan. Los futuros endpoints de negocio deben comprobar también permiso y alcance exacto mediante el contrato RPC.
5. La renovación y el cierre coordinan la sesión del proveedor, la sesión operativa KVG y la persistencia web. Cerrar incluye `sesion.cerrar`, revocación y limpieza del navegador; una cookie anterior no debe volver a dar acceso.

La cookie usa `HttpOnly`, `SameSite=Lax`, ruta `/` y `Secure` en producción. El origen HTTPS y la confianza en el proxy deben configurarse juntos al desplegar. Las mutaciones comprueban `Origin` y el token CSRF. Las cookies protegidas no sustituyen esos controles ni la autorización de negocio.

Estos controles básicos ya forman parte del incremento. La configuración definitiva de hosting, TLS, proxy y secretos de producción, su verificación operativa y la revisión de seguridad de la entrega se abordarán al cierre; todavía no se acredita un entorno productivo.

Las renovaciones se serializan y se guardan antes de consultar de nuevo Auth o la
sesión KVG. Un fallo transitorio del proveedor informa indisponibilidad y conserva
la sesión para reintentar; una identidad inválida o una sesión revocada se deniega.
La limitación de intentos es local a cada instancia. Antes de producción se revisarán
su coordinación entre instancias, los límites de Auth y la limpieza periódica de
sesiones expiradas; todavía no hay un programador para esta limpieza.

La baseline propone ocho horas de duración máxima y treinta minutos de inactividad, sujetos a PT02. La respuesta de sesión informa los límites efectivos. Consultar o renovar una sesión puede actualizar actividad y auditoría: estos endpoints no pertenecen al diagnóstico de metadatos sin mutaciones.

## Contrato HTTP del frontend

Todos los endpoints comparten el prefijo `/api/v1/auth`. El cliente usa `credentials: 'same-origin'`. Antes de cada `POST`, obtiene un token nuevo de `GET csrf` y lo envía en `X-CSRF-Token`, porque login y MFA pueden rotarlo. Las respuestas de acceso no se almacenan en caché por el cliente.

| Método y ruta      | Entrada               | Resultado                                                |
| ------------------ | --------------------- | -------------------------------------------------------- |
| `GET /csrf`        | Sin cuerpo            | `{ csrfToken }`                                          |
| `POST /login`      | `{ email, password }` | `AuthState`                                              |
| `POST /mfa/enroll` | `{}`                  | `{ factorId, qrCode, secret }`                           |
| `POST /mfa/verify` | `{ factorId, code }`  | `AuthState`; código TOTP de seis dígitos                 |
| `GET /session`     | Sin cuerpo            | `AuthState`                                              |
| `GET /me`          | Cookie autenticada    | `{ id, name, roles }`; rechaza ausencia de sesión válida |
| `POST /refresh`    | `{}`                  | `AuthState`                                              |
| `POST /logout`     | `{}`                  | HTTP `204`, sin cuerpo                                   |

El contrato público se define en [identity.ts](../packages/contracts/src/identity.ts). `AuthState` distingue:

- `anonymous`: no hay sesión autenticada para presentar.
- `mfa_required`: factores `{ id, friendlyName }` y `enrollmentRequired`; todavía falta completar el segundo factor.
- `authenticated`: usuario `{ id, name, roles }`, `expiresAt` e `idleTimeoutSeconds`. El identificador público corresponde al usuario operativo KVG.

Un `401` elimina el estado de acceso del frontend. Las respuestas inválidas se rechazan y los errores se presentan mediante un aviso accesible. El cliente no registra contraseñas ni tokens y descarta campos no previstos del estado de acceso.

La clave de alta TOTP se conserva únicamente mientras se completa el alta en la pantalla. El QR se muestra como imagen validada y codificada; no se inserta SVG como HTML. Si no puede mostrarse, existe una clave manual. Contraseña, código y secreto temporal se limpian al iniciar otro login, al cerrar sesión o al descartar la sesión; tras verificar correctamente también se ocultan.

## Comprobar el recorrido en la interfaz

El entorno de desarrollo ya tiene las migraciones y cuentas. Para realizar la comprobación manual pendiente:

1. Ejecutar `npm run dev` desde la raíz y abrir `http://127.0.0.1:5173`. Usar siempre el mismo nombre de host que `APP_ORIGIN`, sin alternar con `localhost`.
2. Comprobar que al entrar se consulta la sesión y, sin sesión previa, aparece el formulario. **Comprobar API** sigue disponible como diagnóstico independiente de salud.
3. Introducir credenciales incorrectas: debe aparecer un error genérico comprensible, sin confirmar cuál dato falló. Con las credenciales ficticias válidas, debe solicitarse MFA.
4. Los factores de las cuentas de prueba ya se verificaron durante la prueba real. Importar de forma local el campo `totpSecret` de la cuenta elegida desde `apps/api/.local/identity-development-accounts.json` a una aplicación de autenticación y usar su código TOTP. No se necesita un alta nueva para esas cuentas. Para una cuenta sin factor, la interfaz permite configurarlo con el QR o la clave manual. Probar también código inválido: no debe habilitar el estado autenticado.
5. Tras MFA válido, comprobar nombre, roles y límites de sesión; recargar y comprobar que la cookie permite recuperar la sesión sin exponer tokens a React. **Actualizar sesión** debe conservar una sesión válida o informar el rechazo y limpiar el estado si corresponde.
6. Cerrar sesión, recargar y comprobar el estado anónimo. Repetir con la segunda identidad, sin mezclar cookies de las cuentas; usar perfiles de navegador separados para pruebas simultáneas.
7. Verificar el formulario por teclado, sus etiquetas, los estados de carga y la lectura de errores. No guardar capturas que contengan QR, claves manuales o credenciales.

Los escenarios permitidos y denegados se verifican en el servidor; la apariencia del formulario no constituye esa evidencia. La prueba real incluye ausencia de MFA, falta de CSRF, otro origen, revocación y vencimiento, además del rechazo al administrador que intenta una operación jurídica sin facultad. Los escenarios adicionales y sus regresiones deben mantenerse en las pruebas relevantes de cada avance.

## Pruebas y pendientes

Pruebas locales del cliente HTTP, sin navegador ni conexión remota:

```sh
npm run test:web
```

Verifican cookies del mismo origen y `AbortSignal`, renovación de CSRF entre mutaciones, bloqueo ante CSRF inválido, conservación del estado HTTP `401`, validación de respuestas y factores, alta/verificación MFA según el contrato, logout sin cuerpo y manejo de errores sin JSON. Las respuestas se simulan exclusivamente en estas pruebas; la aplicación no debe simular éxito de autenticación.

El comando `npm run check` integra formato, tipos, compilación y pruebas locales de API y cliente. No incluye las comprobaciones remotas, que se ejecutan explícitamente:

```sh
npm run test:identity:schema
npm run test:identity:live
```

La comprobación completa pasó el 28 de octubre de 2026: 33 pruebas locales de API
y almacén y 9 del cliente HTTP web, además de formato, tipos y compilación. Incluye
regresiones de límite de intentos, renovación concurrente y conservación del token
renovado ante un fallo temporal de Auth. No equivale a una prueba en navegador.

`test:identity:schema` revisa funciones y privilegios y comprueba rechazo sin identidad dentro de una transacción que termina en `ROLLBACK`, incluida la auditoría generada por ese rechazo. No acredita MFA válido por sí solo.

`test:identity:live` levanta temporalmente la API local y utiliza Auth, MFA TOTP, RPC y PostgreSQL reales del entorno de desarrollo. Inicia, renueva, revoca y vence sesiones de prueba; verifica cifrado, rol restringido y acceso permitido/denegado. Puede registrar el alta inicial de factores TOTP en el archivo privado de cuentas. Conserva un informe local en `apps/api/.local/identity-live-verification.json`, sin publicar credenciales. Estas pruebas tienen efectos sobre las identidades y sesiones ficticias y no deben apuntar a producción.

El aprovisionamiento y la ejecución real tuvieron resultado satisfactorio para el recorrido comprobado. También se repitió la preparación: conservó las dos cuentas y el bootstrap y reconoció ambas migraciones por su checksum, sin duplicarlas. Quedan pendientes la comprobación manual en navegador, el despliegue y las verificaciones de producción. La evidencia debe registrar entorno, fecha, escenarios y resultados, sin secretos ni datos reales.

Nombre sugerido para el commit cuando el incremento esté verificado:

```text
feat(identity): implementar inicio y cierre de sesion con MFA
```
