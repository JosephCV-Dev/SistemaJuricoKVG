# Sistema Jurídico KVG

Aplicación web interna para gestionar clientes, expedientes y documentos del despacho.
Esta entrega prepara la arquitectura inicial y una comprobación de comunicación entre
la interfaz y la API. El desarrollo de los casos de uso se hará por incrementos; el
diseño visual queda para una etapa posterior.

## Arquitectura elegida

Monolito modular por capas con **React + TypeScript + Vite**, **Node + NestJS** y
**PostgreSQL con Supabase Auth y Storage privado**. La revisión RUP de Elaboración
v2.0 incluida en el PDF de Construcción sustituye la propuesta anterior PHP/MySQL.

```text
apps/
  api/                  API NestJS; módulos de negocio y configuración HTTP
    src/modules/
      identity/         Identidad, sesiones, usuarios y permisos
      clients/          Clientes
      cases/            Expedientes, asignaciones y avances
      documents/        Documentos, versiones y revisión
      audit/            Bitácora
      configuration/    Catálogos y parámetros
      operations/       Procesamiento y recuperación
    test/               Pruebas HTTP de la base inicial
  web/                  Interfaz React sin estilos
    src/app/            Composición de la aplicación
    src/features/       Funcionalidades futuras
    src/shared/api/     Comunicación HTTP
packages/contracts/     Tipos públicos compartidos de la API
database/               SQL original, futuras migraciones y pruebas previstas
docs/                   Arquitectura, análisis y siguientes avances
.github/workflows/      Comprobaciones automáticas
```

Los módulos de negocio están registrados, con responsabilidades definidas. Sus
controladores, casos de uso y adaptadores se añadirán al desarrollar cada función.
El trabajador de archivos y respaldos tendrá una entrada independiente dentro del
mismo backend cuando se implemente el procesamiento persistente.

## Ejecutar en desarrollo

Requisitos: **Node 24 LTS** y **npm 11 o superior**. `.nvmrc` y `.node-version`
seleccionan Node 24. También se admite Node 26 para desarrollo. Si usas nvm,
ejecuta `nvm install` y `nvm use` desde la raíz.

```sh
npm ci
npm run dev
```

Abre `http://127.0.0.1:5173` y pulsa **Comprobar API**. La API escucha en
`http://127.0.0.1:3000`; su endpoint es `GET /api/v1/health`.
Vite reenvía `/api` al backend durante desarrollo.

No necesitas cuenta Supabase ni credenciales para esta comprobación inicial.
La salud confirma que responde el proceso HTTP; no comprueba base de datos,
autenticación, almacenamiento ni preparación para producción.

La configuración predeterminada permite arrancar sin archivos `.env`. Para
cambiarla, copia `apps/api/.env.example` a `apps/api/.env` y
`apps/web/.env.example` a `apps/web/.env`. Si cambias el puerto de la API, ajusta
también `API_PROXY_TARGET` en el archivo de la web. Reinicia los procesos después
de cambiar la configuración.

## Comprobaciones

```sh
npm run check
```

Comprueba formato, tipos estrictos, compilación y pruebas HTTP. La CI ejecuta el
mismo comando con Node 24. También están disponibles `npm run typecheck`,
`npm run build`, `npm test`, `npm run format`, `npm run dev:api` y
`npm run dev:web`.

Después de compilar, `npm run start:api` inicia la API compilada. El resultado de
la web queda en `apps/web/dist`. El alojamiento final deberá servir web y `/api`
bajo el mismo origen HTTPS; el despliegue todavía no está configurado.

## Base de datos

Se conserva una copia exacta del SQL entregado. **No se ha ejecutado** ni se aplica
automáticamente al arrancar. Requiere Supabase completo y un proyecto de desarrollo
nuevo, con un procedimiento de inicialización de identidades.

El SQL expone operaciones RPC: el acceso ordinario conserva el JWT real del usuario;
el trabajador técnico utiliza otra identidad. No se añade un ORM ni CRUD directo
porque el modelo suministrado restringe ese acceso. Consulta el
[procedimiento y contrato de datos](database/README.md).

## Documentación y siguientes avances

- [Arquitectura y decisiones](docs/architecture.md).
- [Actores, reglas y trazabilidad de los 31 casos de uso con Jira](docs/requirements.md).
- [Orden de implementación y ejemplos de futuras peticiones](docs/roadmap.md).

El siguiente avance recomendado es **preparar y verificar Supabase en desarrollo**;
después, implementar CU023/CU024 (inicio/cierre de sesión) y las bases de permisos y
auditoría antes de los clientes. Puedes pedirlo así:

> Prepara y verifica la integración con Supabase en desarrollo usando datos ficticios.
> Revisa el SQL existente, comprueba Auth, Storage y permisos, y documenta lo ejecutado.
> Después abordaremos CU023 y CU024. Mantén la arquitectura actual y no trabajes el
> diseño visual.

Commit sugerido para esta preparación:

```text
chore: inicializar arquitectura modular del sistema juridico KVG
```
