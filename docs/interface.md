# Adaptación del diseño KVG

El 4 de noviembre de 2026 el usuario autorizó adelantar el diseño con
`KVG · Vistas del sistema.html` y el logo JPEG entregados. La maqueta sirve como
referencia visual; sus datos, selector de roles, scripts y acciones simuladas no
se incorporan como comportamiento ni alteran los requisitos RUP/Jira.

La aplicación mantiene React/TypeScript, CSS propio y los contratos HTTP existentes.
No se añadieron dependencias de ejecución, rutas de negocio, privilegios ni
migraciones. El logo original se conserva en `apps/web/public/kvg-logo.jpg` y se
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
administrador. Documentos, usuarios, permisos, configuración, bitácora, respaldos,
edición, asignación, cambio de estado y captura de avances recibirán sus controles
cuando se implemente cada recorrido del roadmap. No se reutilizan los botones de
maqueta que aparentan guardar sin persistencia.

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

## Verificación

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

La adaptación visual no cierra 3B ni 3C. El siguiente avance funcional sigue siendo
la carga privada verificada y recuperación, y después el despliegue de prueba.

Commit sugerido: `feat(web): aplicar diseño KVG y navegación por secciones`.
