# Archivos en la beta de desarrollo y en la demo de Render

La beta permite cargar y descargar archivos ficticios en el Supabase actual.
La API y el trabajador admiten `DOCUMENT_UPLOAD_MODE=beta` en desarrollo.
La migración `202611170008_document_beta.sql` mantiene el modo desactivado en
SQL hasta que se habilite explícitamente.

La [demo de Render](render-demo.md) usa el mismo contrato beta y arranca su
trabajador en el Web Service. La aplicación conserva `NODE_ENV=production`
para las cookies y el origen HTTPS. La excepción de carga en ese entorno
requiere el arranque de la demo y la activación SQL.

El flujo conserva sesión, permiso y alcance, cuarentena privada, tamaño máximo,
validación estructural y formato, SHA-256, reintentos y auditoría. La publicación
beta usa un RPC técnico separado y guarda `BETA_SIN_ANTIMALWARE`, con fecha de
análisis y motor nulos. Las descargas son adjuntos privados. La ficha distingue
estos originales de los que pasaron antimalware. El requisito RN10 del RUP
permanece pendiente para producción.

El trabajador procesa las nuevas cargas recibidas y las que ya esperaban
análisis. Concede un intento adicional a trabajos agotados elegibles. Los
rechazos anteriores conservan su estado. Una carga sin recepción confirmada
requiere reenviar el archivo desde la interfaz.

```sh
npm run setup:documents:beta -- --enable
npm run dev:beta
```

El primer comando aplica la migración, verifica el proyecto de desarrollo con
las cuentas ficticias conocidas y habilita la beta. El segundo inicia web, API
y trabajador sin ClamAV. Si la web y API ya están activas con el modo beta,
iniciar solo `npm run worker:documents` en otra terminal. En el expediente,
usar **Actualizar documentos** para ver las versiones que el trabajador ya
publicó.

Cuando se indique terminar la beta, detener los procesos y ejecutar
`npm run setup:documents:beta -- --disable`. El comando vuelve a modo pausado y
bloquea la descarga de originales beta desde SQL. Conserva sus objetos e
historial. Para retomar esos documentos con antimalware, deberán cargarse y
analizarse como nuevas versiones autorizadas. No se convierte una publicación
beta en `SEGURO` cambiando una bandera.

La migración se aplicó en el Supabase de desarrollo. El trabajador publicó tres
cargas que aguardaban análisis. Se verificó con Auth y MFA reales la descarga
de dos originales previos disponibles para la cuenta de prueba, una carga nueva
seguida de descarga byte por byte y la denegación al administrador sin alcance.
Una carga incompleta carecía de objeto en Storage. Se conservaron los rechazos
previos.

Pasaron `npm run check` (83 pruebas), la comprobación de permisos y buckets y el
ensayo aislado de recuperación (107 comprobaciones, ocho originales). Una
transacción revertida confirmó que apagar la beta bloquea sus originales y
mantiene disponibles los que sí pasaron análisis.
