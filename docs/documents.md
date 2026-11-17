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
de trabajos, gestión integral de respaldos, versiones/revisión jurídica, retiro ni
recuperación de un documento desde la interfaz. No acredita una garantía RPO/RTO,
seguridad absoluta de archivos o restauración completa de Supabase Auth/Storage.

Referencias técnicas consultadas: [ClamAV Docker](https://docs.clamav.net/manual/Installing/Docker.html),
[Storage privado](https://supabase.com/docs/guides/storage/serving/downloads),
[PDF-lib](https://github.com/Hopding/pdf-lib),
[Sharp](https://sharp.pixelplumbing.com/api-constructor/) y
[Yauzl](https://github.com/thejoshwolfe/yauzl).

Se conservan para más adelante las imágenes y la configuración del
[despliegue de prueba 3C](staging-deployment.md). Su ensayo HTTPS local no sustituye
la aceptación documental real en el alojamiento y Supabase separados pendientes.
