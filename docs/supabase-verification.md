# Verificación de Supabase — 28 de octubre de 2026

## Resultado actual

La instalación consultada directamente por PostgreSQL **coincide con el modelo
físico en las comprobaciones realizadas**. Las tablas, funciones y buckets KVG
sí existen. La inspección se ejecutó dentro de una transacción de solo lectura,
con TLS y validación del certificado mediante la CA de Supabase.

La configuración HTTP restaurada también se verificó: su referencia de proyecto
coincide con la conexión SQL. El paso 1 de conectividad y catálogo está completado.
Después se implementó y probó CU023/CU024 con Auth, MFA TOTP, sesión operativa KVG y
persistencia cifrada del servidor. Los resultados de cada alcance se separan abajo.

## Inspección inicial del catálogo

| Comprobación        | Resultado                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| API y SQL           | Referencias del mismo proyecto confirmadas sin mostrar la URL ni las credenciales                                                                  |
| Auth                | GET `/auth/v1/settings`: HTTP 200 con la publishable key restaurada                                                                                |
| Data API            | GET `/rest/v1/`: HTTP 401 sin sesión; no acredita acceso autenticado                                                                               |
| Registro público    | Inicialmente habilitado; después el usuario lo desactivó y se verificó `disable_signup: true` en la prueba funcional                               |
| PostgreSQL          | Versión 17.11; compatible con el requisito 15 o superior                                                                                           |
| Esquemas y roles    | Presentes los cinco esquemas y los tres roles de aplicación esperados                                                                              |
| Tablas              | 37 esperadas, sin nombres faltantes ni adicionales en `kvg`                                                                                        |
| Columnas            | 338 comparadas; coinciden nombres, tipos, orden y nulabilidad con el SQL físico                                                                    |
| Funciones           | 43 comparadas; coinciden cuerpos, lenguaje, retorno, `SECURITY DEFINER` y `search_path` vacío                                                      |
| Entradas públicas   | Existen las tres firmas exactas de `kvg_operar`, `kvg_trabajar` y `kvg_inicializar`                                                                |
| Privilegios RPC     | Las nueve comprobaciones rol/función coinciden con la baseline                                                                                     |
| Acceso directo      | No se detectaron permisos inesperados sobre tablas, secuencias o funciones internas para los tres roles de aplicación                              |
| RLS                 | Activa en las 37 tablas, con las 37 políticas de lectura previstas                                                                                 |
| Storage             | Existen `kvg-cuarentena` y `kvg-originales`; ambos privados, con 20 000 000 bytes y los cuatro MIME esperados                                      |
| Política de objetos | `kvg_bloqueo_directo` es restrictiva, cubre todas las operaciones para `anon` y `authenticated`, y excluye ambos buckets en `USING` y `WITH CHECK` |
| SQL original        | Conserva el checksum; no se reescribió ni se volvió a instalar                                                                                     |

La comparación de cuerpos normalizó únicamente saltos de línea CRLF/LF. Las 338
columnas corresponden al SQL físico suministrado; no se modificó el modelo lógico.

En esa inspección inicial no se ejecutaron migraciones, bootstrap ni operaciones de negocio. No se crearon
cuentas o datos ficticios, no se leyeron filas KVG ni cuentas Auth y no se listaron
objetos o documentos. Se consultaron catálogos PostgreSQL y configuración de buckets.

## Corrección del diagnóstico anterior

Las consultas HTTP iniciales, realizadas con las claves de API que estaban
configuradas entonces, habían devuelto `Bucket not found` y no mostraban las RPC
KVG en OpenAPI. **Esas respuestas no acreditaban que faltaran elementos en la base
que ahora se verificó por PostgreSQL.** El diagnóstico directo confirma su presencia.

No se ha demostrado la causa exacta de esa diferencia inicial. Tras restaurar la
URL y la publishable key, se confirmó que la configuración HTTP actual corresponde
al mismo proyecto que la conexión SQL. Esta comparación no atribuye una causa a
las respuestas anteriores. La desactivación posterior del registro público por el
usuario sí quedó comprobada; la aplicación no ofrece registro abierto.

## Configuración local corregida

La cadena se había pegado como una línea suelta. Se añadió `DATABASE_URL=` y se
corrigieron los corchetes conservados del marcador de contraseña. Tras confirmar
la conexión, se guardó la contraseña con codificación URI. No se cambió la
contraseña remota.

`apps/api/.env` sigue ignorado por Git. `DATABASE_URL` se reserva a las herramientas
administrativas autorizadas de desarrollo; el acceso ordinario de la aplicación conserva la
identidad del usuario mediante RPC. Se restauraron `SUPABASE_URL` y
`SUPABASE_PUBLISHABLE_KEY`, se validó su formato y se comprobó su conectividad.
La fábrica ordinaria no requiere una clave administrativa ni una URL JWKS
configurada para este diagnóstico.

Durante una validación inicial de URI, un error local mostró un valor sensible.
Las comprobaciones posteriores ocultaron los detalles de error. Ese valor no se
guarda en este informe; se recomienda cambiar la contraseña de la base y actualizar
la URI local después de esta inspección.

## Incremento CU023/CU024: ejecución autorizada en desarrollo

La comprobación previa encontró cero perfiles KVG y cero identidades Auth. Se
aplicaron explícitamente las migraciones `202610280001_server_sessions.sql` y
`202610280002_identity_session_context.sql`, con registro de checksum. La primera
añade un almacén técnico de sesiones con rol restringido; la segunda incorpora la
operación fija `sesion.consultar`. El SQL original conserva su checksum y las
migraciones no se ejecutan al arrancar Nest.

Se crearon dos identidades ficticias (administración y abogado) mediante la
herramienta de preparación de desarrollo y se ejecutó `kvg_inicializar` para
vincularlas con sus perfiles. No se enviaron correos ni se usaron datos reales.
Las credenciales y los secretos TOTP de estas cuentas quedan únicamente en un
archivo local ignorado, descrito en [identity.md](identity.md).

Comandos ejecutados:

```sh
npm run setup:identity:dev
npm run test:identity:schema
npm run test:identity:live
```

El contrato SQL y la denegación sin identidad pasaron dentro de una transacción
revertida. La última ejecución funcional pasó **39 comprobaciones** contra el
proyecto real de desarrollo. La inscripción TOTP también se probó en la primera
ejecución; las siguientes reutilizan esos factores ya verificados.

| Comportamiento real verificado | Evidencia                                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Cuentas por invitación         | `disable_signup: true` confirmado por Auth                                                                                         |
| Acceso y MFA                   | Contraseña válida exige TOTP; ambos actores alcanzan sesión KVG `aal2`; primer factor solo recibe denegación en `/auth/me`         |
| Identidad y permisos           | `sesion.consultar` devuelve el actor KVG correcto; administración recibe 403 al intentar `cliente.registrar` sin facultad jurídica |
| Cookie y CSRF                  | Cookie opaca HttpOnly/Lax, rotación tras contraseña y MFA, respuestas sin caché, rechazo sin CSRF y desde otro origen              |
| Persistencia                   | Payload cifrado sin token en claro, expiración absoluta conservada y rol de sesiones sin acceso a tablas de negocio                |
| Concurrencia                   | Dos renovaciones simultáneas funcionan; un `touch` con snapshot antiguo conserva el token renovado                                 |
| Cierre y vigencia              | Logout completo; cookie anterior rechazada; sesión KVG revocada y sesión web vencida denegadas                                     |

Estas pruebas abren/cierran sesiones y producen auditoría de desarrollo: no son
diagnósticos de solo lectura. El script conserva únicamente un informe sin secretos
en `.local/identity-live-verification.json` y cierra las sesiones de prueba.

## Límites y siguiente paso

La revisión de catálogo está completada con el alcance descrito. No sustituye las
pruebas funcionales de todos los triggers, estados, permisos sobre recursos o
recuperación. Tampoco se compararon exhaustivamente las
definiciones de todos los índices y restricciones.

Las pruebas HTTP locales complementan el recorrido real con cuenta inactiva,
permisos/contextos revocados, rutas sin política, DTO inválidos, límites de intentos
y fallos transitorios del proveedor. Usan dobles de prueba y no sustituyen ensayos
de todos esos escenarios contra Supabase. No se ha probado el formulario en un
navegador ni la cookie `Secure` detrás del proxy HTTPS de producción.

El siguiente avance es cliente y expediente mínimos (CU001/CU002 y CU004/CU005),
seguido del prototipo de RUP 16.6. La carga privada, análisis, descarga autorizada,
respaldo y recuperación siguen pendientes. Al cierre del proyecto se configurará
y verificará producción, incluidos Auth, permisos/RLS, Storage, secretos, proxy,
monitoreo y restauración, según [roadmap.md](roadmap.md).
