# Ensayo acotado de recuperación de desarrollo

`npm run rehearse:recovery:dev` prepara y ejecuta la evidencia de copia/restauración
acotada de RUP 16.6. **No restaura producción ni constituye CU022/CU030 completos.**
Se ejecuta explícitamente con la configuración del proyecto de desarrollo y sus
identidades ficticias conocidas; no usa datos reales.

## Qué hace

1. Abre PostgreSQL remoto en una transacción `REPEATABLE READ READ ONLY` y captura
   las 37 tablas de `kvg` y la secuencia de folios. No exporta `auth.users`, secretos
   MFA, JWT, contraseñas ni la tabla técnica de cookies del servidor.
2. Lee originales publicados de ese snapshot mediante el canal técnico de Storage
   y comprueba tamaño y SHA-256 contra sus versiones. Su inmutabilidad permite
   copiarlos sin exigir una transacción conjunta PostgreSQL/Storage.
3. Serializa datos/objetos con manifiesto y checksum de baseline. Cifra la copia
   con AES-256-GCM y AAD; guarda archivo, clave y manifiesto con permisos `0600` en
   `.local`, ignorado por Git. La clave es exclusiva del ensayo, sin usar la de
   sesiones. Prueba que una copia alterada no puede descifrarse.
4. Descifra la copia guardada y reconstruye la baseline en PostgreSQL 16 efímero
   dentro de Docker, sin red ni puertos publicados, usando memoria temporal.
   `database/tests/recovery-platform-fixture.sql` crea referencias mínimas Auth y
   Storage para verificar el modelo. **No representa el servicio Supabase real.**
5. Importa el snapshot histórico exclusivamente en ese contenedor. Desactiva
   triggers durante la importación histórica para no inventar autoría/auditoría;
   después los reactiva y recrea/valida todas las claves foráneas. Compara el
   contenido completo y recuento de cada tabla, conserva la secuencia y las
   restricciones capturadas en el snapshot.
6. Recupera cada original al almacenamiento temporal del contenedor y vuelve a
   calcular su hash. El manifiesto relaciona la versión y la ruta original con su
   copia. El RPC ordinario sin identidad permanece denegado. No se reabren accesos,
   no se importan sesiones Auth y no se ofrece un servicio accesible por red.
7. Escribe un informe sin credenciales y elimina únicamente su contenedor efímero.
   Conserva la copia cifrada local para revisión; no elimina objetos del origen.

La evidencia repetida pasó 92 verificaciones sobre 37 tablas y tres originales, incluida
corrupción deliberada de la copia, FK, comparación de datos, hash recuperado y
bloqueo del entorno aislado. Una repetición puede contener más originales ficticios.
El resultado actualizado se guarda en `apps/api/.local/recovery-verification.json`.

## Límites que deben resolverse antes de recuperación operativa

- Es un snapshot **de negocio** para el prototipo; no incluye proveedor Auth,
  objetos de cuarentena pendientes, componentes del servidor ni configuración
  completa de Supabase. Las cargas no publicadas seguirían bloqueadas y requerirían
  conciliación, no publicación automática desde este ensayo.
- Los archivos se restauran a almacenamiento temporal aislado con verificación;
  todavía no se importan mediante el API de un segundo Supabase Storage ni se
  verifica allí una identidad autenticada del proveedor restaurado.
- La custodia de clave al lado de la copia solo corresponde al entorno ficticio;
  producción necesita clave separada, almacenamiento independiente, responsables,
  retención, supervisión y un procedimiento verificado de acceso de emergencia.
- No se ejecuta la restauración operativa SQL ni se marca un respaldo del sistema
  como VERIFICADO por este ensayo. No se sustituyen producción ni sus restricciones
  actuales; tampoco se mide/promete un RPO/RTO de producción a partir del tiempo local.
- Antes de reabrir un servicio restaurado hay que aplicar restricciones y
  revocaciones posteriores al snapshot, verificar proveedor y permisos actuales y
  exigir la autorización operativa prevista por CU030/RN23.

La etapa 3C deberá repetir y ampliar la evidencia en el entorno de prueba separado
con HTTPS. La etapa 6 completará políticas, programación, historial, errores,
restauración de datos/objetos/proveedor, conciliación y apertura autorizada.
