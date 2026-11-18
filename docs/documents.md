# Paso 3B: carga privada, consulta y descarga

## Beta documental de desarrollo

Por petición del usuario, las cargas ficticias pueden habilitarse sin antivirus
en el mismo Supabase de desarrollo. El trabajador sigue validando formato y
tamaño y comprobando SHA-256. La ficha indica que el original beta carece de
análisis antimalware. Consulta y descarga exigen sesión, permiso, alcance e
integridad del objeto. La entrega se mantiene como adjunto.
Véase [modo beta y comandos](document-beta.md).

## Recorrido y límites de capas

En un expediente autorizado, abrir **Documentos → Subir documento**. Seleccionar
archivo, nombre, categoría real y motivo. La recepción permanece bloqueada hasta
que el trabajador verifique el archivo. **Actualizar documentos** consulta el
estado y el listado; seleccionar un documento muestra categoría, autor y versión.
**Descargar original** entrega el adjunto cuando existe una versión habilitada y
el usuario conserva permiso. No hay vista previa activa dentro del navegador.

`documents` conserva dominio, puertos/aplicación, adaptadores e interfaz HTTP.
`operations/application/DocumentWorker` depende de puertos estructurales, sin
importar Nest ni Supabase. El proceso `src/worker.ts` conecta los adaptadores de
RPC/Storage y análisis, sin iniciar HTTP ni migraciones. El frontend documental
está en `features/documents` y se compone dentro del detalle del expediente.

| Endpoint `/api/v1/documents` | Operación y control                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `POST /uploads`              | `documento.cargar` con JWT real, permiso/contexto y CSRF; solicitud UUID estable.                        |
| `GET /categories`            | Catálogo activo reducido; requiere capacidad de carga.                                                   |
| `PUT /uploads/:id/content`   | Binario acotado; CSRF/origen y autor/alcance antes de consumir bytes; transferencia privada técnica.     |
| `GET /uploads/:id`           | Estado accesible únicamente al autor con alcance vigente; no localizadores.                              |
| `GET ?caseId=&offset=`       | Búsqueda SQL restringida al expediente, páginas de 20 y sin total global.                                |
| `GET /:id`                   | Detalle autorizado/auditado y versión vigente; sin ruta de Storage.                                      |
| `GET /versions/:id/download` | Autorización ordinaria y comprobación técnica antes y después de leer; hash/tamaño y adjunto `no-store`. |

No se permite elegir operaciones RPC, actor, resultados antimalware, hash, estado,
versión ni localizador desde el navegador. No hay CRUD directo de negocio ni
clave privilegiada en `VITE_*`. El broker técnico de archivos de la API necesita
`SUPABASE_SECRET_KEY` para `kvg_trabajar` y Storage **después** de autorización
ordinaria. Esto amplía su uso previo en herramientas: no reemplaza el JWT del
usuario ni concede lectura jurídica al administrador. El trabajador usa la misma
clase técnica, con otra entrada y proceso. Ninguno necesita `DATABASE_URL` de
propietario para funcionar. La preparación/inspección/ensayo sí usa esa conexión
con el alcance explícito de cada herramienta.

## Recepción, análisis y fallos

- Límite de 20 000 000 bytes, validado contando bytes del flujo; rechazo de vacío,
  metadatos extra, nombres con separadores y extensiones fuera de PDF/DOCX/JPG/PNG.
  Dos recepciones y dos descargas simultáneas por instancia; transferencia acotada
  por tiempo. La configuración distribuida sigue pendiente de producción.
- Solo Storage privado, bajo claves generadas por SQL. No se emiten URL públicas
  ni firmadas al navegador. El objeto se crea sin sobrescritura. Tras respuesta
  perdida se compara el hash del objeto existente; bytes distintos dan conflicto.
- El estado y la recepción revalidan autor/permiso/alcance. El reintento conserva
  la solicitud; el usuario debe conservar el mismo archivo. Una carga recibida
  tiene un trabajo persistente y publica como máximo una versión.
- ClamAV real por INSTREAM; exige resultado OK y versión/fecha de firmas no mayor
  de siete días. Caída, error, firmas antiguas o tiempo agotado dejan el trabajo
  para reintento, sin publicar. EICAR verifica el camino de rechazo real.
- Contenido real: PDF con páginas y estructura legible, sin cifrado; PNG/JPG
  decodificados con límite de 40 millones de píxeles; DOCX con ZIP acotado, OOXML/XML
  válidos, sin macros, objetos incrustados, entidades ni referencias externas.
  Un DOCX con enlaces externos también se rechaza en este recorrido conservador.
  Son restricciones técnicas de este incremento; PT03 aún requiere validación.
- El verificador corre como proceso hijo con memoria V8 limitada y tiempo máximo
  de 90 segundos. No recibe secretos de Supabase, sesión ni propietario. ClamAV
  vive en un contenedor separado, enlazado solo a loopback en desarrollo.
- Se calcula SHA-256 sobre los bytes recibidos, se copia a un objeto original
  nuevo, se relee y verifica. SQL revalida alcance, conservación, revisión,
  expediente editable y lease antes de publicar. El estado jurídico inicial es
  `RECIBIDO`: el análisis técnico no equivale a validación jurídica.
- El trabajador reclama exclusivamente `VERIFICAR_CARGA`/`CONCILIAR_CARGA`, con
  lease renovable. No toma invitaciones, respaldos o restauraciones. Conserva el
  reintento/backoff persistente original; agotarlo se presenta como error de análisis.
- La cuarentena y originales huérfanos nunca se ofrecen por ruta directa. Se
  conservan para conciliación; no hay borrado automático ni política de purga nueva.
  Tras una interrupción antes de confirmar recepción se reintenta el mismo archivo.
  El barrido automático de cargas abandonadas/objetos huérfanos queda pendiente.
- La descarga verifica el hash y vuelve a autorizar antes de enviar. La bitácora
  registra la autorización; no se declara recepción efectiva por el cliente sin
  evidencia adicional. Se entrega como adjunto genérico para evitar ejecución en
  la aplicación. No se ejecutan macros ni se renderizan documentos activos.

La consulta de estado es manual mediante **Actualizar documentos**; no se anuncia
una notificación push. Salir de la sección descarta el archivo/borrador del navegador,
pero no borra los registros ni objetos ya recibidos. El listado permanece disponible
según alcance; no existe todavía un panel global de incidencias o reanudación.

## Migraciones y preparación

Se aplicaron explícitamente en desarrollo:

- `202611040005_document_upload_workflow.sql`: estado del autor bajo identidad
  real y reclamo de trabajos limitado a cargas. Privilegios existentes intactos.
- `202611040006_document_detail_and_failed_jobs.sql`: nombres de autor/categoría
  después de autorizar el detalle y presentación del agotamiento de trabajos.

Los checksums se registran con el flujo existente. La baseline y migraciones ya
aplicadas no se reescriben y la API no ejecuta instalación al arrancar.

```sh
npm run setup:documents:dev
npm run test:documents:schema
```

Solo al retomar el análisis, con `DOCUMENT_UPLOAD_MODE=verified`, preparar ClamAV y mantener tres procesos:

```sh
docker compose -p kvg-development -f infrastructure/development/compose.yml up -d
npm run dev
# Otra terminal, desde la raíz:
npm run worker:documents
```

El contenedor usa una imagen oficial fijada por digest y conserva las firmas en un
volumen. Comprobar su salud antes de probar. FreshClam mantiene actualizaciones;
la disponibilidad/edad de firmas se comprueba de nuevo al analizar. No montar
carpetas de expedientes ni publicar el puerto 3310 en Internet. El apagado local
se hace con `docker compose ... stop`; no eliminar el volumen de firmas para
reiniciar. El tamaño/formato del SQL y el contrato HTTP deben cambiar juntos si
PT03 se modifica en el futuro.

## Evidencia y alcance pendiente

`npm run test:documents:live` requiere modo `verified` explícito y usa Auth/MFA, cookie, API, RPC, Storage, ClamAV y
verificador reales, con identidades y archivos ficticios. Crea registros de prueba
con auditoría y no los borra. La evidencia privada queda en
`apps/api/.local/documents-live-verification.json`. No ejecutar esta herramienta
simultáneamente con otro ensayo que reclame trabajos de carga.

La última verificación pasó 43 comprobaciones reales, incluidas denegación directa
de Storage al propio autor y revocación con cookie vigente. Chromium pasó 21
comprobaciones del recorrido integrado. `npm run check` pasó 70 pruebas locales
(54 de API y 16 de cliente HTTP), además de formato, tipos y compilación.

Las pruebas locales adicionales cubren revocación durante recepción/descarga,
contenido alterado, fallo del analizador, puertos del trabajador, DTO/CSRF y los
cuatro formatos. Esos puertos simulados no se atribuyen a la evidencia antimalware
real. El recorrido Chromium de clientes/expedientes se amplía con carga, análisis,
consulta, descarga original y vista móvil del panel documental.

El ensayo acotado de copia y recuperación está en [recovery-rehearsal.md](recovery-rehearsal.md).
La preparación local no completa el despliegue HTTPS separado (3C), administración
de trabajos, gestión integral de respaldos, retiro ni recuperación de un
documento desde la interfaz. No acredita una garantía RPO/RTO,
seguridad absoluta de archivos o restauración completa de Supabase Auth/Storage.

Referencias técnicas consultadas: [ClamAV Docker](https://docs.clamav.net/manual/Installing/Docker.html),
[Storage privado](https://supabase.com/docs/guides/storage/serving/downloads),
[PDF-lib](https://github.com/Hopding/pdf-lib),
[Sharp](https://sharp.pixelplumbing.com/api-constructor/) y
[Yauzl](https://github.com/thejoshwolfe/yauzl).

Se conservan para más adelante las imágenes y la configuración del
[despliegue de prueba 3C](staging-deployment.md). Su ensayo HTTPS local no sustituye
la aceptación documental real en el alojamiento y Supabase separados pendientes.

## Paso 5A: organización y búsqueda

CU009–CU011 (SCRUM-128/129/130) añaden **Documentos** al menú y acciones de
organización dentro de la ficha. La búsqueda general combina nombre,
categoría, folio, cliente, fechas de registro (UTC) y estado documental.
Puede ordenarse por fecha o nombre. Por defecto devuelve 20 resultados por
página. Solo incluye versiones publicadas accesibles para la sesión. La
pestaña del expediente conserva también sus registros sin versión publicada.
El filtro de cliente requiere permiso de cliente y el de folio requiere
permiso de expediente. El listado devuelve si hay otra página dentro del
alcance autorizado.

**Clasificar documento** selecciona una categoría activa. El motivo de
clasificación es opcional y se elige de un catálogo reducido. La bitácora
conserva las categorías anterior y nueva, actor, fecha y revisión.
**Cambiar expediente** busca destinos por folio y exige un motivo. Se admite
en estado documental Recibido o En revisión, con origen y destino editables y
autorizados. La clasificación queda bloqueada para un documento archivado.
Ambas acciones requieren una versión publicada y una revisión vigente. Las
cargas en curso deben terminar antes de modificar su documento.

El traslado conserva la versión exacta y su hash. Se registra una asociación
nueva y se aplica el alcance del destino a la ficha y a la descarga. El historial
oculta folios y motivo de las asociaciones cuyos expedientes la sesión ya no
puede consultar. Los avances previos se conservan como historial. Las versiones
vinculadas a esos avances se siguen mostrando según el expediente y alcance
vigentes.

| Ruta                                      | Control                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/documents`                   | Filtros `text`, `categoryId`, `caseId`, `folio`, `client`, `from`, `to`, `status`, `order`, `limit` y `offset`. |
| `GET /api/v1/documents/search-categories` | Catálogo activo para identidades con permiso de consulta documental.                                            |
| `GET /api/v1/documents/:id/destinations`  | Folios de destinos editables y autorizados, paginados.                                                          |
| `PATCH /api/v1/documents/:id/category`    | CSRF, revisión, permiso y alcance de clasificación, categoría activa.                                           |
| `PATCH /api/v1/documents/:id/association` | CSRF, revisión, motivo y alcance de origen y destino.                                                           |

La migración `202611170012_document_organization.sql` se aplicó al Supabase de
desarrollo con `npm run setup:document-organization:dev`. Pasaron 87 pruebas
de `npm run check` y la comprobación de privilegios y buckets privados.
El [ensayo SQL aislado](../database/tests/document-organization-local.sql)
comprobó filtros, exclusión de documentos sin publicar, revisión obsoleta,
categoría inactiva, traslado permitido y denegado, historial filtrado y
conservación del original. Queda pendiente medir NFR-0006 con un volumen de
datos representativo del despacho.

En Chromium a 390 px con MFA real, Secretaría buscó un documento ficticio
por nombre, categoría, folio y cliente, lo reclasificó y lo trasladó a otro
expediente autorizado. Se verificaron ambos historiales y la igualdad byte
por byte de la descarga. El abogado con acceso solamente al expediente de
origen recibió 403 al consultar y descargar el documento trasladado.

## Paso 5B de metadatos y versiones

CU014/CU029 (SCRUM-133/137) se usan desde la ficha de un documento, en la
búsqueda general o en el expediente. **Editar metadatos** cambia el nombre
con un motivo obligatorio y revisión vigente. Aplica a documentos en Recibido
o En revisión dentro de expedientes editables. La categoría conserva
**Clasificar documento** y el expediente conserva **Cambiar expediente**.
El motivo y los nombres anterior y nuevo quedan en un historial SQL privado
e inmutable. La bitácora registra actor, campo y revisión.

**Cargar nueva versión** exige motivo, revisión y alcance vigentes de consulta,
edición y carga. Usa el flujo privado de CU008, con la marca por archivo si se
publica en beta. El botón **Consultar estado de la nueva versión** informa si
se publicó, fue rechazada o se canceló, entre otros estados de la carga. En
caso de rechazo permanece el original vigente. Si la revisión cambió antes
de publicar, el trabajo se cancela y la ficha debe actualizarse para intentar de
nuevo. Cada publicación confirmada inicia en `RECIBIDO` y conserva los originales
previos con sus propias revisiones. Si se quiere volver a unos bytes anteriores,
se puede descargar ese original autorizado y enviarlo como una versión nueva.

**Ver historial de versiones** identifica la secuencia, la vigente y el hash
SHA-256, autor, motivo y fecha de cada publicación. Muestra el resultado, autor y
fecha de las revisiones jurídicas registradas en la versión correspondiente.
Cada descarga requiere el permiso específico y vuelve a verificar alcance e
integridad. Los archivos beta restringidos se filtran del historial cuando la
beta está apagada. Sus documentos siguen admitiendo una nueva versión bajo
identidad autorizada cuando se abre su ficha desde el expediente.

| Ruta                                   | Control                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `PATCH /api/v1/documents/:id/metadata` | Edición de nombre con revisión, motivo, permiso, alcance y CSRF.              |
| `POST /api/v1/documents/:id/versions`  | Reserva idempotente por documento y revisión. La recepción usa la ruta CU008. |
| `GET /api/v1/documents/:id/versions`   | Historial paginado con consulta y permiso de versiones; sin rutas privadas.   |

Se aplicó `202611170013_document_versions.sql` al Supabase de desarrollo con
`npm run setup:document-versions:dev`. Pasaron `npm run check` (89 pruebas)
y la comprobación de permisos y buckets privados. El
[ensayo SQL aislado](../database/tests/document-versions-local.sql) verificó
revisión obsoleta, reintento, conflicto de publicación, rechazo, revocación
antes de publicar, consulta sin permiso de descarga y conservación de la
revisión jurídica de una versión previa ya validada. Usa referencias ficticias
de Storage.

En Chromium a 390 px con MFA real, Secretaría renombró un documento ficticio,
cargó una nueva versión y descargó ambos originales sin cambios en sus bytes.
El trabajador rechazó una carga inválida y canceló un intento con revisión
obsoleta. El abogado sin alcance recibió 403 al consultar el historial, editar
y descargar la primera versión. Las publicaciones de este ensayo usaron la
beta de desarrollo.

## Paso 5C de revisión jurídica y estados

CU016/CU026 (SCRUM-134/135) se usan desde **Revisión y estado** en la ficha
del documento. El historial de versiones permite consultar la misma sección
para una versión anterior autorizada. Las entradas se paginan y registran
autor y fecha de servidor, presentada en hora de Mérida.

Un abogado autorizado registra observaciones de una versión técnicamente
habilitada con uno de tres resultados, Observaciones, Apto para validar o
Requiere corrección. La captura conserva la versión examinada si se publica
otra durante la revisión y muestra un aviso. Una corrección agrega una entrada
vinculada a la anterior. La revisión corregida permanece en el historial y
deja de servir como evidencia para una validación nueva. Un reintento conserva
la misma solicitud cuando el contenido coincide.

La matriz de transiciones se aplica a la versión vigente y a un expediente
editable. El servidor comprueba la revisión de esa versión, el permiso y el
motivo justo antes de guardar el cambio y su evento de historial juntos.

| Origen      | Destino     | Condición                                                               |
| ----------- | ----------- | ----------------------------------------------------------------------- |
| Recibido    | En revisión | Permiso de iniciar revisión.                                            |
| En revisión | Recibido    | Permiso de solicitar corrección y su motivo.                            |
| En revisión | Validado    | Abogado con permiso de validar y revisión apta de la versión.           |
| Validado    | Archivado   | Permiso de archivar.                                                    |
| Archivado   | Validado    | Abogado con permiso de reactivar y conservación de la evidencia previa. |

Las observaciones jurídicas se muestran a abogados con alcance de expediente
y permiso de revisar o validar la versión. Otras cuentas autorizadas pueden
consultar sus cambios de estado según alcance. La bitácora guarda identidad,
fecha y referencia de operación con metadatos acotados. El estado y el último
resultado de análisis técnico son independientes.

| Ruta                                                    | Control                                            |
| ------------------------------------------------------- | -------------------------------------------------- |
| `GET /api/v1/documents/:id/versions/:versionId/review`  | Historial paginado y acciones por alcance.         |
| `POST /api/v1/documents/:id/versions/:versionId/review` | Captura jurídica con solicitud idempotente y CSRF. |
| `PATCH /api/v1/documents/:id/versions/:versionId/state` | Transición con revisión, motivo, permiso y CSRF.   |

Se aplicó `202611170014_document_legal_review.sql` al Supabase de desarrollo
con `npm run setup:document-review:dev`. El
[ensayo SQL aislado](../database/tests/document-review-local.sql) comprobó
las cinco transiciones, idempotencia, corrección, revocación en sesión
vigente, privacidad de observaciones, bloqueo técnico y denegaciones por
revisión obsoleta o evidencia de otra versión.

Pasaron 90 pruebas de `npm run check` y la comprobación de privilegios y
buckets privados. En Chromium a 390 px con MFA real, Secretaría cambió un
documento ficticio a En revisión y Abogacía registró su observación y validó
esa versión. Secretaría recibió 403 al intentar validarla y el resultado de
su consulta omitió la observación jurídica. La publicación de otra versión
mientras se redactaba una revisión conservó la observación en la versión
examinada y mostró un aviso. El servidor denegó cambiar el estado de esa
versión anterior y usar su evidencia para validar la nueva. Las cargas de
este ensayo usaron la beta de desarrollo.
