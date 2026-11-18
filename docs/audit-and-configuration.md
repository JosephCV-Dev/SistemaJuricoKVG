# Bitácora y configuración

El paso 6B implementa CU020 (SCRUM-168) y CU021 (SCRUM-169). En el menú
**Administración** aparecen **Bitácora** y **Configuración** según el permiso
vigente de la sesión. La API y el RPC exigen el permiso de cada operación en
alcance `GLOBAL_OPERATIVO`, con la identidad y el MFA del usuario. Las
escrituras HTTP requieren además origen autorizado y token CSRF.

## Bitácora

`GET /api/v1/audit` consulta los eventos de PostgreSQL por fechas UTC, actor
(nombre, tipo o ID), acción, recurso (tipo o ID) y resultado. Ordena del más
reciente al más antiguo y usa el instante y el ID del último evento para
continuar entre páginas. El filtro «Hasta» incluye el día indicado. El nombre
del actor es el nombre operativo actual.

`GET /api/v1/audit/:id` devuelve el detalle de un evento y su correlación.
Tanto la lista como el detalle registran su propia consulta. La respuesta
excluye identificadores de sesión, cargas completas de metadatos y contenido
documental. Los eventos de diagnóstico exclusivos de los logs de NestJS
quedan fuera de esta consulta.

`AUTORIZACION_DESCARGA` registra la autorización para entregar el original.
`TRANSFERENCIA_VERIFICADA` requiere evidencia de la transferencia en el flujo
documental.

## Configuración

`GET /api/v1/configuration` carga parámetros y catálogos, incluidos los
inactivos. Para guardar, el usuario debe ingresar un motivo y confirmar
el cambio. Una edición con una revisión obsoleta se rechaza y la pantalla
permite recargar la configuración.

- `PATCH /api/v1/configuration/parameters/:code` permite 5–30 minutos de
  inactividad y 1–8 horas de duración máxima. La duración absoluta se aplica
  a nuevas sesiones. Elevar el límite de inactividad conserva la caducidad
  de las sesiones que habían superado el umbral anterior.
- `POST /api/v1/configuration/categories` crea una categoría documental.
  `PATCH /api/v1/configuration/categories/:id` modifica nombre, descripción y
  estado.
- `POST /api/v1/configuration/identification-types` crea un tipo de identificación.
  `PATCH /api/v1/configuration/identification-types/:code` modifica su nombre y
  estado. El código, la regla de normalización y la unicidad se fijan al crear.

Desactivar una entrada la retira del catálogo para nuevas referencias y
conserva las asociaciones históricas. Los motivos de parámetros se guardan
en `kvg.historial_parametro`. La migración añade un historial privado e
inmutable para motivos de catálogos por revisión y conserva los eventos
existentes. El bloqueo operativo se muestra en solo lectura. MFA, controles
documentales y estados o transiciones jurídicas quedan fuera de esta
configuración.

## Preparación y verificación

Desde la raíz del repositorio, aplicar la migración al mismo Supabase de
desarrollo con las identidades ficticias.

```bash
npm run setup:audit-configuration:dev
npm run check
```

La migración `202611180017_audit_configuration.sql` conserva la baseline y no
se ejecuta al arrancar NestJS. Las pruebas HTTP cubren JWT de usuario, permiso
y alcance, filtros y proyección, CSRF, confirmación y validación de escrituras.
`database/tests/audit-configuration-local.sql` comprueba filtros, detalle,
paginación y denegaciones, historial, desactivación y vigencia de sesiones
en PostgreSQL aislado con el fixture de la plataforma.

El 18 de noviembre de 2026 se aplicó la migración al Supabase de desarrollo.
Pasaron `npm run check` (80 pruebas de API y 18 de web), los SQL de regresión en
PostgreSQL aislado y las comprobaciones remotas de los esquemas de identidad y
documentos. En Chromium, con MFA de Supabase, Administración creó y desactivó una
categoría y un tipo de identificación ficticios, consultó filtros, paginación
y detalle. Se confirmó HTTP 403 para lectura de bitácora y lectura y escritura de
configuración con Secretaría, y para una escritura administrativa sin CSRF.
Las entradas ficticias de verificación quedaron inactivas. Los cambios de
parámetros de sesión se probaron en PostgreSQL aislado.
