# Copias y restauración aislada de desarrollo

El incremento local del paso 6C amplía el ensayo de RUP 16.6 para CU022
(SCRUM-196) y CU030 (SCRUM-197). Usa el Supabase de desarrollo con datos
ficticios y PostgreSQL 16 en Docker para la restauración.

## Comandos

Ejecutar desde la raíz del repositorio, con la configuración de desarrollo
existente y Docker disponible para restaurar.

```bash
npm run backup:dev -- create
npm run backup:dev -- list
npm run backup:dev -- restore ID_DE_LA_COPIA --confirmar
```

`create` genera un ID, captura la copia y registra fecha UTC, punto de
recuperación, tamaño, huella del archivo cifrado, cobertura y estado. `list`
muestra la copia y los intentos por fecha, incluidos los fallidos. `restore`
selecciona por ID, pide confirmación explícita y registra un nuevo intento.
Se puede repetir sobre la misma copia. `npm run rehearse:recovery:dev`
mantiene el recorrido combinado y guarda también el último informe exitoso en
`apps/api/.local/recovery-verification.json`.

La captura abre PostgreSQL remoto con `REPEATABLE READ READ ONLY`, verifica las
identidades ficticias conocidas y exporta el esquema `kvg`, la secuencia de
folios y las tablas privadas de solicitudes, decisiones de personal y cambios
de catálogo. El manifiesto asocia un original publicado a cada versión por
identificador, ruta privada, tamaño y SHA-256. Se comprueba esa relación antes
de almacenar la copia. Los archivos sin publicar siguen sujetos al flujo
documental. Auth, secretos MFA y el almacén de sesiones web quedan a cargo de
sus respectivos mecanismos de operación.

La copia se cifra con AES-256-GCM y una clave por copia. El ID queda vinculado
al archivo mediante datos autenticados. Por defecto, los archivos y los
informes quedan en `apps/api/.local/recovery-copies` y las claves en
`apps/api/.local/recovery-keys`. Los directorios requieren permisos `0700` y
los archivos se crean con `0600`. Para ubicarlos en rutas absolutas distintas
usar `KVG_DEV_BACKUP_DIR` y `KVG_DEV_BACKUP_KEY_DIR`. La ubicación por defecto
corresponde a un ensayo local en el mismo equipo. El operador accede con los
permisos del sistema operativo.

## Restauración y resultado

1. Autentica y descifra la copia. Verifica la baseline, el contenido y orden de
   las migraciones registradas, y la correspondencia del manifiesto con las
   versiones incluidas.
2. Reconstruye el esquema usando la baseline y esas migraciones en un
   contenedor efímero sin red ni puertos, con almacenamiento temporal.
3. Importa el snapshot histórico, restituye la secuencia de folios y valida las
   claves foráneas de negocio y de las tablas privadas incluidas. Compara la
   cobertura, los recuentos y el contenido de las tablas.
4. Restaura cada original en el almacenamiento temporal y verifica su SHA-256.
   Comprueba que el acceso ordinario permanece cerrado. Auth y Storage se
   representan con referencias de prueba para validar las relaciones.
5. Guarda el resultado y elimina el contenedor del intento. Una copia capturada
   y releída se registra como `COPIA_LOCAL_COMPROBADA`. Una restauración que
   supera todas las verificaciones se registra como `ENSAYO_LOCAL_SUPERADO`.
   Los errores registran `FALLIDO` y la etapa.

El informe mide el tiempo de restauración local y la antigüedad del punto de
recuperación al iniciar. PT04 propone un RPO de una hora y un RTO de cuatro
horas. El RPO de un incidente exige conocer su momento y la pérdida efectiva.
El RTO completo incluye el tiempo hasta reanudar el servicio.

## Evidencia

El 18 de noviembre de 2026 se capturaron 41 tablas y 19 originales ficticios.
La restauración de la copia por ID en una ejecución posterior pasó 183
comprobaciones. Tardó 13 segundos y el punto de recuperación tenía 88 segundos
de antigüedad al iniciar. Una segunda restauración pasó con las direcciones
del proyecto de origen deshabilitadas para ese proceso. También se rechazaron
una copia corrupta, una copia con esquema incompatible y una restauración
solicitada sin confirmación.
Pasaron las comprobaciones del repositorio mediante `npm run check`.

## Alcance operativo pendiente

Cerrar CU022 y CU030 requiere almacenamiento independiente del equipo con
custodia separada, programación y alertas operativas, y gestión mediante la
cuenta autorizada con MFA. También requiere verificar la restauración del
proveedor de identidad y Storage en un entorno de destino, conservar el
estado previo y aplicar revocaciones y restricciones posteriores a la copia
antes de autorizar la reapertura. Los estados de este procedimiento pertenecen
al historial local de desarrollo. La operación de producción usa las
entidades y los permisos de respaldo del modelo.
