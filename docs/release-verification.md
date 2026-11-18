# Verificación previa al lanzamiento de KVG

La verificación del paso 8 usa la demo local y el proyecto Supabase de
desarrollo con cuentas y archivos ficticios. La prueba de HTTPS usa
contenedores locales y PostgreSQL efímero.

## Alojamiento

Render alojará la aplicación. Supabase alojará PostgreSQL, Auth y Storage
privado.

| Servicio de KVG                        | Destino previsto                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| React compilado y Caddy                | Web Service público de Render. Render termina HTTPS y Caddy sirve la web y reenvía `/api` bajo el mismo origen. |
| API NestJS                             | Private Service de Render. Caddy la contacta por la red privada.                                                |
| Trabajador de documentos               | Background Worker de Render. Procesa la cola persistente de KVG en Supabase.                                    |
| ClamAV, cuando se habilite el análisis | Private Service de Render. El trabajador lo contacta por la red privada.                                        |

El proxy público deberá escuchar en `PORT`. Hay que adaptar los nombres internos
de los servicios y verificar los encabezados reenviados, el origen público y las
cookies tras la terminación TLS de Render. Los servicios de la red privada
compartirán región y espacio de trabajo. Los Private Services y Background
Workers requieren cómputo de pago.
[Web Services](https://render.com/docs/web-services) ·
[Red privada](https://render.com/docs/private-network) ·
[Despliegue gratuito](https://render.com/docs/free).

[Paquete Docker verificado localmente](staging-deployment.md). Para probar la
interfaz y la API en un solo servicio Node, véase
[Demo de KVG en Render sin Docker](render-demo.md).

## Evidencia de desarrollo del 18 de noviembre de 2026

- `npm run check` pasó con 82 pruebas de API y 18 de web.
- El recorrido en Chromium pasó con Secretaría, Abogado y Administración,
  MFA real y anchuras de 320, 390 y 1280 px.
- Pasaron `test:identity:schema`, `test:records:schema` y
  `test:documents:schema` contra Supabase. Comprueban los contratos privados,
  privilegios y buckets. La configuración de Auth reportó el registro público
  deshabilitado y el acceso por correo habilitado.
- `npm run test:records:live` pasó 73 comprobaciones de alta, edición,
  concurrencia, auditoría, alcance y revocación con la sesión vigente.
- Secretaría registró un cliente y un expediente ficticios, subió un PNG y
  descargó el original idéntico. El trabajador lo publicó como beta y la cuenta
  de Administración recibió HTTP 403 al pedir el mismo archivo.
- Se construyeron las imágenes y el ensayo HTTPS local pasó 18 verificaciones,
  entre ellas proxy de un solo origen, cookie segura, persistencia de sesión,
  CSRF y rechazo de un origen ajeno. El ensayo usa PostgreSQL efímero y el
  recorrido Chromium comprueba Auth real en el entorno de desarrollo.

- La copia y restauración cifrada en Docker aislado verificó 41 tablas y 20
  originales ficticios. La restauración tomó 11 segundos en el ensayo local.

## Pendientes del entorno de destino

- Adaptar el paquete para Render, configurar el origen HTTPS y verificar la
  comunicación privada y la cadena de proxy en el entorno desplegado.
- Preparar el proyecto Supabase de producción con sus propias credenciales,
  cuentas, permisos y migraciones.
- Verificar en el destino invitaciones, MFA, sesiones, CSRF, permisos y
  acceso a archivos con los roles del despacho.
- Habilitar el análisis de archivos con el trabajador y ClamAV. La demo
  publica archivos ficticios con la marca `BETA_SIN_ANTIMALWARE`.
- Preparar copias independientes, custodia de claves, restauración operativa
  y alertas. La restauración local verifica el ensayo de desarrollo.
