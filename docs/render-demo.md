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
`NODE_ENV=production` y `TRUST_PROXY=true`.
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
propias para el despliegue. Añade `SUPABASE_SECRET_KEY` del mismo proyecto como
secreto del servicio para recibir, procesar y entregar archivos privados.
[Variables y archivos secretos](https://render.com/docs/configure-environment-variables).

## Cargas temporales sin antimalware

`npm run start:render` inicia NestJS y supervisa un trabajador hijo en el mismo
Web Service. La API habilita cargas cuando el trabajador confirma el acceso a
la cola beta en Supabase. El proyecto de datos ficticios debe tener la baseline,
las migraciones, las cuentas y [la beta SQL activa](document-beta.md).
Si el trabajador se detiene, las cargas se pausan hasta que vuelva a responder.
La cola y los objetos privados permanecen en Supabase durante los reinicios.

Si el servicio ya usa este Start Command, tiene la clave técnica y apunta al
Supabase con beta activa, un push a la rama con Auto-Deploy aplica el cambio.
El perfil de demo reconoce el `DOCUMENT_UPLOAD_MODE=paused` de la configuración
anterior. Para pausar las cargas de esta demo desde Render, guarda
`RENDER_DEMO_UPLOADS=paused` y vuelve a desplegar. Para reanudarlas, retira esa
variable o configúrala en `beta`. El modo explícito `verified` conserva el
contrato de análisis completo con un trabajador y ClamAV configurados por
separado. [Despliegues automáticos](https://render.com/docs/deploys#automatic-deploys).

La recepción exige MFA, permiso de carga, alcance del expediente y CSRF.
Los archivos pasan por cuarentena privada y comprobaciones de formato, tamaño
y SHA-256. Se publican como `BETA_SIN_ANTIMALWARE` y se entregan como adjuntos
privados con autorización. Usa solo documentos ficticios. Esta demo conserva
el mismo origen HTTPS y la cookie segura de producción.

## Alcance de prueba

Se pueden probar inicio de sesión con MFA, clientes, expedientes,
administración y el recorrido documental según los permisos de cada cuenta.
En un expediente editable, usa **Documentos → Subir documento** con un PDF,
DOCX, JPG o PNG ficticio. Pulsa **Actualizar documentos** hasta ver el archivo
disponible y abre su ficha para **Descargar original**. En los logs, el
mensaje «El trabajador de Render tiene acceso a la cola beta» confirma que
la configuración permitió iniciar el procesamiento. `/api/v1/health` comprueba
que la API responde.

Se comprobó con Node 24 desde una instalación limpia y el comando de arranque
de Render. El ensayo usó PostgreSQL efímero con las migraciones del repositorio
y servicios HTTP de prueba para Auth y Storage. Verificó la pausa y reactivación
de la cola, la carga inicial, una nueva versión, la descarga byte por byte y las
denegaciones por origen, sesión, alcance y contenido inválido. En el Supabase
de desarrollo se verificaron la beta activa, los permisos y los buckets privados,
y se aplicó la migración de la marca beta en el detalle. La validación en la
URL pública de Render se realiza después del despliegue.
