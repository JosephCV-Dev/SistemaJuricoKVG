# Demo de KVG en Render sin Docker

La demo se ejecuta en un **Web Service** con runtime **Node**. NestJS sirve el
React compilado y la API `/api/v1` bajo el mismo origen HTTPS. Supabase conserva
PostgreSQL, Auth y Storage privado. Usa solo el proyecto de datos ficticios
preparado para la demo.

## Configuración del Web Service

Conecta el repositorio y usa la raíz del monorepo. El proyecto usa Node 24 LTS.

| Campo             | Valor                                   |
| ----------------- | --------------------------------------- |
| Runtime           | Node                                    |
| Build Command     | `npm ci --include=dev && npm run build` |
| Start Command     | `npm run start:render`                  |
| Health Check Path | `/api/v1/health`                        |

Render asigna `PORT` y termina HTTPS. Configura `API_HOST=0.0.0.0`,
`NODE_ENV=production`, `TRUST_PROXY=true` y `DOCUMENT_UPLOAD_MODE=paused`.
Para el subdominio `onrender.com`, la aplicación toma el origen desde
`RENDER_EXTERNAL_URL`. Si usas un dominio propio, define `APP_ORIGIN` con
el origen HTTPS exacto, sin ruta.
Se usan las cookies seguras de producción aun en la demo.
[Web Services de Render](https://render.com/docs/web-services).

Configura `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y los valores privados
`SESSION_DATABASE_URL`, `SESSION_SECRET` y `SESSION_ENCRYPTION_KEY` en Render.
El almacén de sesiones usa el rol restringido `kvg_session_store` con
`sslmode=verify-full`. Si la URI incluye `sslrootcert`, sube la CA pública
como Secret File y apunta la URI a su ruta en Render. Genera claves de sesión
propias para el despliegue. La clave técnica `SUPABASE_SECRET_KEY` se requiere
para operaciones como la entrega de originales habilitados. Guárdala como
secreto del servicio. [Variables y archivos secretos](https://render.com/docs/configure-environment-variables).

El proyecto Supabase asociado debe tener la baseline, las migraciones y las
cuentas ficticias preparadas. El arranque solo inicia NestJS y sirve el
resultado de la compilación.

## Alcance de prueba

Se pueden probar inicio de sesión con MFA, clientes, expedientes,
administración y consulta documental según los permisos de cada cuenta.
Las cargas nuevas y el modo documental beta local quedan fuera de esta demo.
Se pueden descargar originales previamente habilitados en modo verificado
cuando el permiso y la configuración técnica lo permiten. El trabajador y
ClamAV corresponden al paquete de despliegue completo.
