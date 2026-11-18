# Adaptación del diseño KVG

El 4 de noviembre de 2026 el usuario autorizó adelantar el diseño con
`KVG · Vistas del sistema.html` y el logo JPEG entregados. La maqueta sirve como
referencia visual; sus datos, selector de roles, scripts y acciones simuladas no
se incorporan como comportamiento ni alteran los requisitos RUP/Jira.

La aplicación mantiene React/TypeScript, CSS propio y los contratos HTTP existentes.
La adaptación inicial se centró en la presentación de los recorridos existentes. El logo original se conserva en `apps/web/public/kvg-logo.jpg` y se
presenta sin deformación. Se emplean fuentes del sistema, sin conexiones externas
para tipografía, scripts o imágenes.

## Organización disponible

- Acceso: correo y contraseña, seguido del MFA real; no registro público ni selector
  de roles. El logo se presenta también en esta pantalla.
- Inicio: bienvenida y acciones disponibles según capacidades reales, sin cifras,
  alertas de documentos ni estados de respaldos inventados.
- Clientes: tabla paginada y búsqueda por nombre, registro con revisión y
  confirmación, detalle de identificaciones/contactos. CU001/CU002 — SCRUM-13/14.
- Expedientes: tabla paginada y búsqueda por folio/descripción y estado; detalle
  con secciones Resumen, Historial y Avances. La creación parte de seleccionar un
  cliente autorizado. CU004/CU005 — SCRUM-41/42.
- Mi sesión: identidad, roles, vigencia, renovación y cierre reales.
  CU023/CU024 — SCRUM-149/150.

El menú responde a capacidades y no sustituye los controles de autorización del
servidor y SQL. El administrador no obtiene enlaces de lectura jurídica por ser
administrador. El detalle del expediente incorpora Documentos con carga privada, estado de
análisis, detalle y descarga autorizada (paso 3B). El menú Administración
agrupa Usuarios y permisos, Bitácora y Configuración para las cuentas con
la capacidad correspondiente. [Contrato de Bitácora y Configuración](audit-and-configuration.md).

Se conserva el folio generado por SQL, identificaciones opcionales y catálogo real,
el par número externo/autoridad y los reintentos idempotentes durante la confirmación.
La maqueta no añade un campo Materia al contrato vigente ni obliga a introducir
identificaciones que el caso de uso permite omitir. Tampoco se presentan columnas
como contactos, cliente o abogado en las listas si su respuesta HTTP no las incluye;
esos datos se consultan en el detalle autorizado.

La navegación está en memoria: al recargar vuelve a Inicio y restaura la sesión
mediante el servidor. Salir de un formulario descarta su borrador local; no se
persisten fichas ni tokens en almacenamiento del navegador. El layout adapta el
menú a pantallas pequeñas y conserva etiquetas, foco de teclado, salto al contenido,
mensajes de estado/error y tablas con desplazamiento horizontal propio.

## Paso 7

En escritorio el menú lateral permanece visible. En móvil, un botón abre
el menú y expone su estado. La tecla Escape lo cierra y devuelve el foco
al botón. Al abrir una vista, el foco pasa a su encabezado. Las regiones de
tablas tienen nombre accesible y desplazamiento horizontal mediante teclado;
el resto de la pantalla se ajusta al ancho disponible.

El inicio muestra acciones rápidas según la capacidad vigente. Los formularios
de acceso y activación comparten el marco de la marca. Se ajustaron la jerarquía,
el contraste de los controles, las casillas de confirmación, la indicación de la
vista activa y los avisos de resultado. Se conserva la variante clara de la maqueta.
Las pantallas de operación de respaldos se implementarán junto con el cierre de
CU022/CU030.

La verificación específica usa dos cuentas ficticias en Chromium con MFA real.
Comprueba activación, menú y foco, confirmación por teclado, desplazamiento de
bitácora, visibilidad según permisos, cierre de sesión y anchuras de 320, 390 y
1280 px. Se abren vistas y formularios sin guardar datos del negocio.

```sh
PLAYWRIGHT_MODULE_PATH=/ruta/externa/playwright/index.mjs node apps/api/scripts/test-interface-browser.mjs
```

La ejecución del 18 de noviembre de 2026 pasó con las dos cuentas y las tres
anchuras, sin errores de JavaScript.

### Expedientes y documentos por rol

El expediente se identifica con un solo encabezado y conserva el botón de
regreso a la lista de origen. Secretaría encuentra Documentos y Responsables
al principio. El abogado puede entrar por **Mis expedientes** y consultar
Avances desde el inicio de la ficha. Las asignaciones y los accesos explícitos
se gestionan en Responsables según la facultad vigente.

El listado de Mis expedientes añade el asunto y conserva sus filtros al volver
desde una ficha. Al seleccionar un documento, la ficha ocupa el espacio de trabajo y el botón
**Volver a documentos** recupera la búsqueda. Los filtros de nombre, categoría,
folio y estado se muestran al inicio, con el resto bajo **Más filtros**. La
descarga queda a la vista. **Gestión documental** contiene cambios de nombre,
clasificación, traslados y retiro según los controles existentes. **Versiones**
carga el historial autorizado. Secretaría consulta el estado operativo y las
transiciones disponibles. El abogado encuentra primero **Revisión y estado**.

La ficha muestra estado, categoría, versión, autor y datos del archivo. Las
consultas HTTP de Secretaría omiten SHA-256. El historial ofrece **Datos de
integridad** plegado solo si la sesión tiene facultad jurídica sobre esa versión.
La verificación interna de descargas y originales conserva la huella.
[Contrato documental](documents.md#visualización-documental-por-rol).

La prueba de navegador incluye ahora Administración, Secretaría y Abogado.
Comprueba el regreso a los resultados, la descarga, la ficha resumida y la
consulta de la huella desplegable según el alcance de la versión.

### Ficha del cliente

El nombre encabeza la ficha una sola vez y lleva el icono de persona. El alta
y el tipo de cliente quedan a la vista. Los datos de contacto y las
identificaciones se agrupan cuando existen. Una ficha sin ambos datos muestra
un solo aviso. El UUID interno se usa para cargar la ficha y realizar las
operaciones, y queda fuera de la presentación. Al abrir el cliente desde un
expediente, el botón de regreso vuelve a consultar ese expediente con la
identidad actual. Desde el listado, regresa a la búsqueda de clientes.

### Iconos y listas

Clientes muestra una silueta a la izquierda de cada nombre y una flecha junto
a Consultar. Los mismos iconos de línea identifican las secciones en el menú
y los encabezados, distinguen personas, expedientes y documentos en las listas
y acompañan acciones como buscar, crear, descargar o volver. Las etiquetas
siguen visibles y los iconos decorativos se excluyen del nombre accesible.

Se usa la fuente WOFF2 de Bootstrap Icons 1.13.1 dentro del paquete web. Vite
la sirve desde el mismo origen. El logo y la paleta KVG se conservan.

## Verificación de la adaptación inicial

La prueba de navegador `apps/api/scripts/test-records-browser.mjs` se adapta a las
secciones, comprueba el logo local, historial/avances, vista móvil, MFA y cierre,
y mantiene el recorrido de registro/apertura con datos ficticios y la denegación
real al administrador. El recorrido real pasó 18 comprobaciones en Chromium local: acceso de Secretaría
y administrador, alta/consulta, secciones, logo, móvil, teclado, cierre y denegación
jurídica al administrador. Genera evidencia privada en `apps/api/.local`; nunca captura
la contraseña ni el secreto de configuración MFA.

Ejecutar con API y Vite locales y una instalación externa de Playwright:

```sh
PLAYWRIGHT_MODULE_PATH=/ruta/externa/playwright/index.mjs node apps/api/scripts/test-records-browser.mjs
```

`npm run check` pasó: formato, tipos, compilación y 53 pruebas locales
(40 de API y 13 del cliente HTTP). La baseline SQL permanece intacta; no se
ejecutaron migraciones en este cambio. El recorrido de navegador dejó únicamente
un cliente y expediente ficticios adicionales y su auditoría de desarrollo.

La adaptación visual no cierra el prototipo completo. Después se incorporó el
recorrido documental local y ensayo acotado de recuperación de 3B, documentados
en [documents.md](documents.md). Sigue el despliegue de prueba separado de 3C.

Commit sugerido: `feat(web): aplicar diseño KVG y navegación por secciones`.
